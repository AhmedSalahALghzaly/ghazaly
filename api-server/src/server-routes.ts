import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { query } from "./server-db";
import {
  generateSessionToken,
  hashPassword,
  comparePassword,
  serializeUser,
  getUserRole,
  getCurrentUser,
  requireAuth,
  requireAdminRole,
} from "./server-auth";
import { sendVerificationCode, verifyCode } from "./server-twilio";
import { sendEmailVerificationCode } from "./server-gmail";
import { generateAndUploadExcel } from "./server-excelService";
import { createChatRouter, initChatTables } from "./routes/chat";
import { createKnowledgeBaseRouter } from "./routes/knowledge-base";
import { createAppointmentsRouter } from "./routes/appointments";
import { createAiRouter } from "./routes/ai";
import { ObjectStorageService, ObjectNotFoundError } from "./lib/objectStorage";
import { canAccessObject, ObjectPermission } from "./lib/objectAcl";

const SHIPPING_COST = 150.0;
const SESSION_EXPIRE_DAYS = 30;

function genId() {
  return randomUUID();
}

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// WebSocket client tracking (module-level for access across the function)
const wsClients = new Map<string, Set<WebSocket>>();
const wsAnonClients = new Set<WebSocket>();

export function broadcastToUser(userId: string, message: object) {
  const userClients = wsClients.get(userId);
  if (!userClients) return;
  const payload = JSON.stringify(message);
  for (const ws of userClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

export function broadcastToAll(message: object) {
  const payload = JSON.stringify(message);
  for (const userClients of wsClients.values()) {
    for (const ws of userClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
  for (const ws of wsAnonClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(cookieParser());

  // Run migrations that may not exist yet
  try {
    await query(
      "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'",
    );
  } catch {}
  try {
    await query(
      "ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_last_read_status VARCHAR(50)",
    );
    await query(
      "ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_read_at TIMESTAMPTZ",
    );
  } catch {}

  // Initialize chat & knowledge base tables
  try {
    await initChatTables();
  } catch (e: any) {
    console.error("[Chat] Failed to initialize tables:", e.message);
  }

  // ==================== AUTH ROUTES ====================

  // Register with email/password
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        return res
          .status(400)
          .json({ detail: "Email, password and name are required" });
      }

      const existing = await query("SELECT id FROM users WHERE email = $1", [
        email.toLowerCase(),
      ]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ detail: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const userId = genId();

      await query(
        "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
        [userId, email.toLowerCase(), name, passwordHash],
      );

      const userResult = await query("SELECT * FROM users WHERE id = $1", [
        userId,
      ]);
      const user = userResult.rows[0];
      const role = await getUserRole(user.email);

      const sessionToken = generateSessionToken();
      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), userId, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      const userSerialized = await serializeUser(user);
      userSerialized.role = role;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      console.error("Register error:", err);
      return res.status(500).json({ detail: "Registration failed" });
    }
  });

  // Login with email/password
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res
          .status(400)
          .json({ detail: "Email and password are required" });
      }

      const userResult = await query(
        "SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL",
        [email.toLowerCase()],
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }

      const user = userResult.rows[0];

      if (!user.password_hash) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }

      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }

      const role = await getUserRole(user.email);
      const sessionToken = generateSessionToken();

      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      const userSerialized = await serializeUser(user);
      userSerialized.role = role;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      console.error("Login error:", err);
      return res.status(500).json({ detail: "Login failed" });
    }
  });

  // Change password
  app.post("/api/auth/change-password", async (req: Request, res: Response) => {
    try {
      const { email, old_password, new_password } = req.body;
      if (!email || !old_password || !new_password) {
        return res.status(400).json({ detail: "All fields are required" });
      }
      if (new_password.length < 6) {
        return res
          .status(400)
          .json({ detail: "New password must be at least 6 characters" });
      }
      const userResult = await query(
        "SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL",
        [email.toLowerCase()],
      );
      if (userResult.rows.length === 0) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }
      const user = userResult.rows[0];
      if (!user.password_hash) {
        return res
          .status(401)
          .json({ detail: "This account does not use password login" });
      }
      const valid = await comparePassword(old_password, user.password_hash);
      if (!valid) {
        return res
          .status(401)
          .json({ detail: "Current password is incorrect" });
      }
      const newHash = await hashPassword(new_password);
      await query(
        "UPDATE users SET password_hash = $1, owner_temp_password = NULL, updated_at = NOW() WHERE id = $2",
        [newHash, user.id],
      );
      // Invalidate all existing sessions for security
      await query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
      console.log(`[Auth] Password changed for: ${user.email}`);
      return res.json({
        success: true,
        message: "Password changed successfully. Please sign in again.",
      });
    } catch (err: any) {
      console.error("Change password error:", err);
      return res.status(500).json({ detail: "Failed to change password" });
    }
  });

  // Get current user
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) {
        return res.status(401).json({ detail: "Not authenticated" });
      }
      const role = await getUserRole(user.email);
      const userSerialized = await serializeUser(user);
      userSerialized.role = role;
      return res.json(userSerialized);
    } catch (err: any) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  // Google OAuth - exchange access token for session
  app.post("/api/auth/google", async (req: Request, res: Response) => {
    let step = "init";
    try {
      const { access_token } = req.body;
      if (!access_token)
        return res.status(400).json({ detail: "Access token required" });

      step = "google_userinfo";
      let googleRes: globalThis.Response;
      try {
        googleRes = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          {
            headers: { Authorization: `Bearer ${access_token}` },
          },
        );
      } catch (fetchErr: any) {
        console.error(
          "Google auth: failed to reach userinfo endpoint:",
          fetchErr?.message || fetchErr,
        );
        return res
          .status(502)
          .json({ detail: "Could not reach Google servers" });
      }

      if (!googleRes.ok) {
        const body = await googleRes.text().catch(() => "");
        console.error(
          `Google auth: userinfo returned ${googleRes.status}:`,
          body,
        );
        return res.status(401).json({ detail: "Invalid Google token" });
      }

      step = "parse_google_user";
      const googleUser: any = await googleRes.json();
      const { email, name, picture } = googleUser;
      if (!email)
        return res
          .status(400)
          .json({ detail: "Could not get email from Google" });

      step = "db_lookup";
      let userResult = await query(
        "SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL",
        [email.toLowerCase()],
      );

      let userId: string;
      step = "db_upsert";
      if (userResult.rows.length === 0) {
        userId = genId();
        await query(
          "INSERT INTO users (id, email, name, picture, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())",
          [userId, email.toLowerCase(), name || email, picture || null],
        );
        userResult = await query("SELECT * FROM users WHERE id = $1", [userId]);
      } else {
        userId = userResult.rows[0].id;
        await query(
          "UPDATE users SET picture = COALESCE($1, picture), email_verified = TRUE, name = COALESCE(NULLIF($2,''), name), updated_at = NOW() WHERE id = $3",
          [picture || null, name || "", userId],
        );
        userResult = await query("SELECT * FROM users WHERE id = $1", [userId]);
      }

      step = "session_create";
      const user = userResult.rows[0];
      const role = await getUserRole(user.email);
      const sessionToken = generateSessionToken();
      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      step = "serialize";
      const userSerialized = await serializeUser(user);
      userSerialized.role = role;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      console.error(
        `Google auth error at step [${step}]:`,
        err?.message || err,
      );
      return res
        .status(500)
        .json({ detail: `Google authentication failed (${step})` });
    }
  });

  // Replit Auth - exchange Replit user headers for a session
  app.post("/api/auth/replit-login", async (req: Request, res: Response) => {
    try {
      const replitUserId = req.headers["x-replit-user-id"] as string;
      const replitUserName = req.headers["x-replit-user-name"] as string;
      const replitUserEmail = req.headers["x-replit-user-email"] as string;
      const replitUserImage = req.headers["x-replit-user-image"] as string;
      const replitUserRoles = req.headers["x-replit-user-roles"] as string;

      if (!replitUserId || !replitUserName) {
        return res
          .status(401)
          .json({ detail: "Not authenticated with Replit" });
      }

      const rawName = decodeURIComponent(replitUserName);
      const rawEmail = replitUserEmail
        ? decodeURIComponent(replitUserEmail)
        : null;
      const rawPicture = replitUserImage
        ? decodeURIComponent(replitUserImage)
        : null;
      const email = rawEmail || `${replitUserName.toLowerCase()}@replit.user`;

      // Find existing user by replit_user_id first, then by email
      let userResult = await query(
        "SELECT * FROM users WHERE (replit_user_id = $1 OR email = $2) AND deleted_at IS NULL ORDER BY (replit_user_id = $1) DESC LIMIT 1",
        [replitUserId, email.toLowerCase()],
      );

      let userId: string;
      if (userResult.rows.length === 0) {
        userId = genId();
        await query(
          `INSERT INTO users (id, email, name, picture, email_verified, replit_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
           ON CONFLICT (email) DO UPDATE
             SET replit_user_id = EXCLUDED.replit_user_id,
                 name = COALESCE(NULLIF(EXCLUDED.name,''), users.name),
                 picture = COALESCE(EXCLUDED.picture, users.picture),
                 email_verified = TRUE,
                 updated_at = NOW()`,
          [
            userId,
            email.toLowerCase(),
            rawName || email,
            rawPicture,
            replitUserId,
          ],
        );
        userResult = await query("SELECT * FROM users WHERE email = $1", [
          email.toLowerCase(),
        ]);
        userId = userResult.rows[0].id;
      } else {
        userId = userResult.rows[0].id;
        await query(
          `UPDATE users SET
             replit_user_id = $1,
             name = COALESCE(NULLIF($2,''), name),
             picture = COALESCE($3, picture),
             email_verified = TRUE,
             updated_at = NOW()
           WHERE id = $4`,
          [replitUserId, rawName || "", rawPicture, userId],
        );
        userResult = await query("SELECT * FROM users WHERE id = $1", [userId]);
      }

      const user = userResult.rows[0];
      const role = await getUserRole(user.email);
      const sessionToken = generateSessionToken();

      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      const userSerialized = await serializeUser(user);
      userSerialized.role = role;
      userSerialized.replit_user_id = replitUserId;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      console.log(
        `[Replit Auth] Login: ${user.email} role=${role} replit_id=${replitUserId}`,
      );
      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      console.error("Replit auth error:", err);
      return res
        .status(500)
        .json({ detail: "Replit authentication failed: " + err.message });
    }
  });

  // Check Replit Auth status (GET - for auto-login on page load)
  app.get("/api/auth/replit-status", async (req: Request, res: Response) => {
    try {
      const replitUserId = req.headers["x-replit-user-id"] as string;
      const replitUserName = req.headers["x-replit-user-name"] as string;
      const replitUserEmail = req.headers["x-replit-user-email"] as string;

      // Check existing session first
      const existingUser = await getCurrentUser(req);
      if (existingUser) {
        const role = await getUserRole(existingUser.email);
        const s = await serializeUser(existingUser);
        s.role = role;
        return res.json({ authenticated: true, via: "session", user: s });
      }

      // If Replit headers present, auto-create session
      if (replitUserId && replitUserName) {
        const rawEmail = replitUserEmail
          ? decodeURIComponent(replitUserEmail)
          : null;
        const email = rawEmail || `${replitUserName.toLowerCase()}@replit.user`;

        let userResult = await query(
          "SELECT * FROM users WHERE (replit_user_id = $1 OR email = $2) AND deleted_at IS NULL LIMIT 1",
          [replitUserId, email.toLowerCase()],
        );

        let userId: string;
        if (userResult.rows.length === 0) {
          // Auto-create user on first Replit Auth login
          const rawPicture2 = req.headers["x-replit-user-image"]
            ? decodeURIComponent(req.headers["x-replit-user-image"] as string)
            : null;
          const rawName2 = decodeURIComponent(replitUserName);
          userId = genId();
          await query(
            `INSERT INTO users (id, email, name, picture, email_verified, replit_user_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
             ON CONFLICT (email) DO UPDATE
               SET replit_user_id = EXCLUDED.replit_user_id,
                   name = COALESCE(NULLIF(EXCLUDED.name,''), users.name),
                   picture = COALESCE(EXCLUDED.picture, users.picture),
                   email_verified = TRUE,
                   updated_at = NOW()`,
            [
              userId,
              email.toLowerCase(),
              rawName2 || email,
              rawPicture2,
              replitUserId,
            ],
          );
          userResult = await query("SELECT * FROM users WHERE email = $1", [
            email.toLowerCase(),
          ]);
        }
        userId = userResult.rows[0].id;
        const user = userResult.rows[0];
        const role = await getUserRole(user.email);
        const sessionToken = generateSessionToken();
        await query(
          "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
          [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
        );
        const s = await serializeUser(user);
        s.role = role;
        res.cookie("session_token", sessionToken, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path: "/",
          maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
        });
        console.log(`[Replit Status] Auto-login: ${user.email} role=${role}`);
        return res.json({
          authenticated: true,
          via: "replit_headers",
          user: s,
          session_token: sessionToken,
        });
      }

      return res.json({ authenticated: false, replit_user_present: false });
    } catch (err: any) {
      console.error("Replit status error:", err);
      return res.status(500).json({ detail: "Status check failed" });
    }
  });

  // Validate Replit session token (used after WebBrowser redirect)
  app.post("/api/auth/replit-validate", async (req: Request, res: Response) => {
    try {
      const { session_token } = req.body;
      if (!session_token)
        return res.status(400).json({ detail: "Session token required" });

      const sessionResult = await query(
        "SELECT * FROM sessions WHERE session_token = $1 AND expires_at > NOW()",
        [session_token],
      );
      if (sessionResult.rows.length === 0) {
        return res
          .status(401)
          .json({ detail: "Invalid or expired session token" });
      }
      const session = sessionResult.rows[0];
      const userResult = await query(
        "SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL",
        [session.user_id],
      );
      if (userResult.rows.length === 0) {
        return res.status(401).json({ detail: "User not found" });
      }
      const user = userResult.rows[0];
      const role = await getUserRole(user.email);
      const s = await serializeUser(user);
      s.role = role;

      res.cookie("session_token", session_token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      return res.json({ user: s, session_token });
    } catch (err: any) {
      console.error("Replit validate error:", err);
      return res.status(500).json({ detail: "Validation failed" });
    }
  });

  // Replit Sign-In HTML page - serves a landing page for Replit Auth WebBrowser flow
  app.get("/auth/replit-signin", async (req: Request, res: Response) => {
    const isMobile = req.query.mobile === "1";
    const redirectUrl = (req.query.redirect as string) || "/";

    try {
      // Read Replit user headers (available in deployed Replit apps)
      const replitUserId = req.headers["x-replit-user-id"] as string;
      const replitUserName = req.headers["x-replit-user-name"] as string;
      const replitUserEmail = req.headers["x-replit-user-email"] as string;
      const replitUserImage = req.headers["x-replit-user-image"] as string;

      if (replitUserId && replitUserName) {
        // User is authenticated via Replit - create/find user and session
        const rawName = decodeURIComponent(replitUserName);
        const rawEmail = replitUserEmail
          ? decodeURIComponent(replitUserEmail)
          : null;
        const rawPicture = replitUserImage
          ? decodeURIComponent(replitUserImage)
          : null;
        const email = rawEmail || `${replitUserName.toLowerCase()}@replit.user`;

        let userResult = await query(
          "SELECT * FROM users WHERE (replit_user_id = $1 OR email = $2) AND deleted_at IS NULL ORDER BY (replit_user_id = $1) DESC LIMIT 1",
          [replitUserId, email.toLowerCase()],
        );

        let userId: string;
        if (userResult.rows.length === 0) {
          userId = genId();
          await query(
            `INSERT INTO users (id, email, name, picture, email_verified, replit_user_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
             ON CONFLICT (email) DO UPDATE
               SET replit_user_id = EXCLUDED.replit_user_id,
                   updated_at = NOW()`,
            [
              userId,
              email.toLowerCase(),
              rawName || email,
              rawPicture,
              replitUserId,
            ],
          );
          userResult = await query("SELECT * FROM users WHERE email = $1", [
            email.toLowerCase(),
          ]);
        }

        const user = userResult.rows[0];
        const sessionToken = generateSessionToken();
        await query(
          "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
          [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
        );

        console.log(
          `[Replit SignIn Page] Login: ${user.email} mobile=${isMobile}`,
        );

        if (isMobile) {
          // For mobile: redirect back to app with token
          const mobileRedirect = decodeURIComponent(redirectUrl);
          const separator = mobileRedirect.includes("?") ? "&" : "?";
          return res.redirect(
            `${mobileRedirect}${separator}token=${sessionToken}`,
          );
        } else {
          // For web: redirect to original page with token
          const webRedirect = new URL(
            redirectUrl.startsWith("http")
              ? redirectUrl
              : `${req.protocol}://${req.get("host")}`,
          );
          webRedirect.searchParams.set("replit_token", sessionToken);
          return res.redirect(webRedirect.toString());
        }
      } else {
        // Not authenticated via headers — redirect to Replit's official auth flow
        // After the user authenticates with Replit, they return to the app and
        // checkReplitStatus() on the login page auto-detects the session
        const host = req.get("host") || "";
        const hostname = host.split(":")[0]; // strip port
        const replitAuthUrl = `https://replit.com/auth_with_repl_site?domain=${encodeURIComponent(hostname)}`;
        console.log(
          `[Replit SignIn] No headers — redirecting to Replit auth: ${replitAuthUrl}`,
        );
        return res.redirect(replitAuthUrl);
      }
    } catch (err: any) {
      console.error("Replit signin page error:", err);
      return res.status(500).send("Server error");
    }
  });

  // Send email verification code
  app.post(
    "/api/auth/send-email-verification",
    async (req: Request, res: Response) => {
      try {
        const { email, language } = req.body;
        if (!email) return res.status(400).json({ detail: "Email required" });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await query("DELETE FROM email_verification_codes WHERE email = $1", [
          email.toLowerCase(),
        ]);
        await query(
          "INSERT INTO email_verification_codes (email, code, expires_at) VALUES ($1, $2, $3)",
          [email.toLowerCase(), code, expiresAt],
        );

        await sendEmailVerificationCode(email, code, language || "ar");
        return res.json({ message: "Verification code sent" });
      } catch (err: any) {
        console.error("Send email verification error:", err);
        return res
          .status(500)
          .json({ detail: err.message || "Failed to send verification email" });
      }
    },
  );

  // Verify email code
  app.post(
    "/api/auth/verify-email-code",
    async (req: Request, res: Response) => {
      try {
        const { email, code } = req.body;
        if (!email || !code)
          return res.status(400).json({ detail: "Email and code required" });

        const result = await query(
          "SELECT * FROM email_verification_codes WHERE email = $1 AND code = $2 AND expires_at > NOW() AND used = FALSE",
          [email.toLowerCase(), code.trim()],
        );

        if (result.rows.length === 0) {
          return res.status(400).json({ detail: "Invalid or expired code" });
        }

        await query(
          "UPDATE email_verification_codes SET used = TRUE WHERE email = $1",
          [email.toLowerCase()],
        );
        await query("UPDATE users SET email_verified = TRUE WHERE email = $1", [
          email.toLowerCase(),
        ]);

        return res.json({ message: "Email verified successfully" });
      } catch (err: any) {
        console.error("Verify email error:", err);
        return res.status(500).json({ detail: "Verification failed" });
      }
    },
  );

  // Logout
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      const token =
        req.cookies?.session_token ||
        req.headers?.authorization?.replace("Bearer ", "");
      if (token) {
        await query("DELETE FROM sessions WHERE session_token = $1", [token]);
      }
      res.clearCookie("session_token", { path: "/" });
      return res.json({ message: "Logged out" });
    } catch {
      return res.json({ message: "Logged out" });
    }
  });

  // ==================== CAR BRANDS ====================

  app.get("/api/car-brands", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT cb.*, d.name as distributor_name 
         FROM car_brands cb 
         LEFT JOIN distributors d ON cb.distributor_id = d.id 
         WHERE cb.deleted_at IS NULL 
         ORDER BY cb.name`,
      );
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/car-brands",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, logo, distributor_id } = req.body;
        if (!name || !name_ar)
          return res.status(400).json({ detail: "name and name_ar required" });

        const result = await query(
          "INSERT INTO car_brands (id, name, name_ar, logo, distributor_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
          [genId(), name, name_ar, logo || null, distributor_id || null],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/car-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, logo, distributor_id } = req.body;
        const result = await query(
          "UPDATE car_brands SET name=$1, name_ar=$2, logo=$3, distributor_id=$4, updated_at=NOW() WHERE id=$5 AND deleted_at IS NULL RETURNING *",
          [name, name_ar, logo || null, distributor_id || null, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/car-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE car_brands SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CAR MODELS ====================

  app.get("/api/car-models", async (req: Request, res: Response) => {
    try {
      const { brand_id } = req.query;
      let q = `SELECT cm.*, cb.name as brand_name, cb.name_ar as brand_name_ar, cb.logo as brand_logo
               FROM car_models cm
               LEFT JOIN car_brands cb ON cm.brand_id = cb.id
               WHERE cm.deleted_at IS NULL`;
      const params: any[] = [];
      if (brand_id) {
        params.push(brand_id);
        q += ` AND cm.brand_id = $${params.length}`;
      }
      q += " ORDER BY cm.name";
      const result = await query(q, params);
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.get("/api/car-models/:id", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT cm.*, cb.id as brand_obj_id, cb.name as brand_name, cb.name_ar as brand_name_ar, cb.logo as brand_logo,
                cb.distributor_id as brand_distributor_id,
                d.id as dist_id, d.name as dist_name, d.name_ar as dist_name_ar,
                d.profile_image as dist_profile_image, d.phone as dist_phone,
                d.email as dist_email, d.contact_email as dist_contact_email,
                d.website_url as dist_website_url, d.phone_numbers as dist_phone_numbers,
                d.address as dist_address, d.description as dist_description,
                d.description_ar as dist_description_ar
         FROM car_models cm
         LEFT JOIN car_brands cb ON cm.brand_id = cb.id
         LEFT JOIN distributors d ON cb.distributor_id = d.id
         WHERE cm.id = $1 AND cm.deleted_at IS NULL`,
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      const carModel = result.rows[0];
      // Build brand as nested object for frontend compatibility
      carModel.brand = carModel.brand_obj_id
        ? {
            id: carModel.brand_obj_id,
            name: carModel.brand_name,
            name_ar: carModel.brand_name_ar,
            logo: carModel.brand_logo,
          }
        : null;
      carModel.distributor = carModel.dist_id
        ? {
            id: carModel.dist_id,
            name: carModel.dist_name,
            name_ar: carModel.dist_name_ar,
            profile_image: carModel.dist_profile_image || null,
            phone: carModel.dist_phone || null,
            email: carModel.dist_email || carModel.dist_contact_email || null,
            contact_email:
              carModel.dist_contact_email || carModel.dist_email || null,
            website_url: carModel.dist_website_url || null,
            phone_numbers: carModel.dist_phone_numbers || [],
            address: carModel.dist_address || null,
            description: carModel.dist_description || null,
            description_ar: carModel.dist_description_ar || null,
          }
        : null;
      delete carModel.brand_obj_id;
      delete carModel.brand_name;
      delete carModel.brand_name_ar;
      delete carModel.brand_logo;
      delete carModel.brand_distributor_id;
      delete carModel.dist_id;
      delete carModel.dist_name;
      delete carModel.dist_name_ar;
      delete carModel.dist_profile_image;
      delete carModel.dist_phone;
      delete carModel.dist_email;
      delete carModel.dist_contact_email;
      delete carModel.dist_website_url;
      delete carModel.dist_phone_numbers;
      delete carModel.dist_address;
      delete carModel.dist_description;
      delete carModel.dist_description_ar;

      // Fetch compatible products (car_model_ids is stored as JSONB array)
      const productsResult = await query(
        `SELECT p.id, p.name, p.name_ar, p.sku, p.price::float as price, p.image_url, p.images,
                c.id as category_id, c.name as category_name, c.name_ar as category_name_ar,
                pb.id as product_brand_id, pb.name as brand_name, pb.name_ar as brand_name_ar
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         WHERE p.car_model_ids @> $1::jsonb AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC
         LIMIT 50`,
        [JSON.stringify([req.params.id])],
      );

      const compatibleProducts = productsResult.rows.map((p: Record<string, any>) => ({
        ...p,
        price: parseFloat(p.price) || 0,
        category: p.category_name
          ? {
              id: p.category_id,
              name: p.category_name,
              name_ar: p.category_name_ar,
            }
          : null,
        product_brand: p.brand_name
          ? {
              id: p.product_brand_id,
              name: p.brand_name,
              name_ar: p.brand_name_ar,
            }
          : null,
      }));

      return res.json({
        ...carModel,
        compatible_products: compatibleProducts,
        compatible_products_count: compatibleProducts.length,
      });
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/car-models",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          brand_id,
          name,
          name_ar,
          year_start,
          year_end,
          image_url,
          images,
          description,
          description_ar,
          variants,
          chassis_number,
          catalog_pdf,
          fuel_type,
        } = req.body;
        if (!brand_id || !name || !name_ar)
          return res
            .status(400)
            .json({ detail: "brand_id, name, name_ar required" });

        const result = await query(
          `INSERT INTO car_models (id, brand_id, name, name_ar, year_start, year_end, image_url, images, description, description_ar, variants, chassis_number, catalog_pdf, fuel_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            genId(),
            brand_id,
            name,
            name_ar,
            year_start || null,
            year_end || null,
            image_url || null,
            JSON.stringify(images || []),
            description || null,
            description_ar || null,
            JSON.stringify(variants || []),
            chassis_number || null,
            catalog_pdf || null,
            fuel_type || "petrol",
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/car-models/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          brand_id,
          name,
          name_ar,
          year_start,
          year_end,
          image_url,
          images,
          description,
          description_ar,
          variants,
          chassis_number,
          catalog_pdf,
          fuel_type,
        } = req.body;
        const result = await query(
          `UPDATE car_models SET brand_id=$1,name=$2,name_ar=$3,year_start=$4,year_end=$5,image_url=$6,images=$7,description=$8,description_ar=$9,variants=$10,chassis_number=$11,catalog_pdf=$12,fuel_type=$13,updated_at=NOW()
         WHERE id=$14 AND deleted_at IS NULL RETURNING *`,
          [
            brand_id,
            name,
            name_ar,
            year_start || null,
            year_end || null,
            image_url || null,
            JSON.stringify(images || []),
            description || null,
            description_ar || null,
            JSON.stringify(variants || []),
            chassis_number || null,
            catalog_pdf || null,
            fuel_type || "petrol",
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/car-models/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE car_models SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PRODUCT BRANDS ====================

  app.get("/api/product-brands", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT pb.*, s.name as supplier_name 
         FROM product_brands pb 
         LEFT JOIN suppliers s ON pb.supplier_id = s.id 
         WHERE pb.deleted_at IS NULL ORDER BY pb.name`,
      );
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/product-brands",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          logo,
          country_of_origin,
          country_of_origin_ar,
          supplier_id,
        } = req.body;
        if (!name) return res.status(400).json({ detail: "name required" });

        const result = await query(
          "INSERT INTO product_brands (id, name, name_ar, logo, country_of_origin, country_of_origin_ar, supplier_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            genId(),
            name,
            name_ar || null,
            logo || null,
            country_of_origin || null,
            country_of_origin_ar || null,
            supplier_id || null,
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/product-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          logo,
          country_of_origin,
          country_of_origin_ar,
          supplier_id,
        } = req.body;
        const result = await query(
          "UPDATE product_brands SET name=$1,name_ar=$2,logo=$3,country_of_origin=$4,country_of_origin_ar=$5,supplier_id=$6,updated_at=NOW() WHERE id=$7 AND deleted_at IS NULL RETURNING *",
          [
            name,
            name_ar || null,
            logo || null,
            country_of_origin || null,
            country_of_origin_ar || null,
            supplier_id || null,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/product-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE product_brands SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CATEGORIES ====================

  app.get("/api/categories/all", async (req: Request, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name",
      );
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.get("/api/categories/tree", async (req: Request, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name",
      );
      const cats = result.rows;

      const map: Record<string, any> = {};
      cats.forEach((c: any) => {
        map[c.id] = { ...c, children: [] };
      });

      const roots: any[] = [];
      cats.forEach((c: any) => {
        if (c.parent_id && map[c.parent_id]) {
          map[c.parent_id].children.push(map[c.id]);
        } else {
          roots.push(map[c.id]);
        }
      });

      return res.json(roots);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/categories",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, parent_id, icon, image_data } = req.body;
        if (!name || !name_ar)
          return res.status(400).json({ detail: "name and name_ar required" });

        const result = await query(
          "INSERT INTO categories (id, name, name_ar, parent_id, icon, image_data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            genId(),
            name,
            name_ar,
            parent_id || null,
            icon || null,
            image_data || null,
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/categories/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, parent_id, icon, image_data } = req.body;
        const result = await query(
          "UPDATE categories SET name=$1,name_ar=$2,parent_id=$3,icon=$4,image_data=$5,updated_at=NOW() WHERE id=$6 AND deleted_at IS NULL RETURNING *",
          [
            name,
            name_ar,
            parent_id || null,
            icon || null,
            image_data || null,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/categories/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE categories SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PRODUCTS ====================

  async function enrichProduct(p: any): Promise<any> {
    const product = { ...p };
    if (!product.car_model_ids) product.car_model_ids = [];
    if (!product.images) product.images = [];
    return product;
  }

  app.get("/api/products", async (req: Request, res: Response) => {
    try {
      const {
        category_id,
        product_brand_id,
        car_model_id,
        car_brand_id,
        min_price,
        max_price,
        skip = 0,
        limit = 50,
        include_hidden,
      } = req.query;

      let conditions = ["p.deleted_at IS NULL"];
      const params: any[] = [];
      let paramIdx = 1;

      if (!include_hidden || include_hidden === "false") {
        conditions.push(`(p.hidden_status = FALSE OR p.hidden_status IS NULL)`);
      }

      if (category_id) {
        // Include subcategories
        const subCats = await query(
          "SELECT id FROM categories WHERE parent_id = $1 AND deleted_at IS NULL",
          [category_id],
        );
        const catIds = [category_id, ...subCats.rows.map((r: any) => r.id)];
        conditions.push(`p.category_id = ANY($${paramIdx})`);
        params.push(catIds);
        paramIdx++;
      }

      if (product_brand_id) {
        conditions.push(`p.product_brand_id = $${paramIdx}`);
        params.push(product_brand_id);
        paramIdx++;
      }

      if (car_model_id) {
        conditions.push(`p.car_model_ids @> $${paramIdx}::jsonb`);
        params.push(JSON.stringify([car_model_id]));
        paramIdx++;
      }

      if (car_brand_id) {
        const models = await query(
          "SELECT id FROM car_models WHERE brand_id = $1 AND deleted_at IS NULL",
          [car_brand_id],
        );
        if (models.rows.length > 0) {
          const modelIds = models.rows.map((m: any) => m.id);
          const carModelConditions = modelIds.map(
            (id: string) => `p.car_model_ids @> '["${id}"]'::jsonb`,
          );
          conditions.push(`(${carModelConditions.join(" OR ")})`);
        }
      }

      if (min_price) {
        conditions.push(`p.price >= $${paramIdx}`);
        params.push(Number(min_price));
        paramIdx++;
      }

      if (max_price) {
        conditions.push(`p.price <= $${paramIdx}`);
        params.push(Number(max_price));
        paramIdx++;
      }

      const whereClause = conditions.join(" AND ");

      const countResult = await query(
        `SELECT COUNT(*) FROM products p WHERE ${whereClause}`,
        params,
      );
      const total = parseInt(countResult.rows[0].count);

      const productsResult = await query(
        `SELECT p.*,
                pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                pb.country_of_origin as manufacturer_country, pb.country_of_origin_ar as manufacturer_country_ar,
                c.name as category_name, c.name_ar as category_name_ar,
                first_cm.name as compatible_car_model, first_cm.name_ar as compatible_car_model_ar,
                first_cm.year_start as compatible_car_year_from, first_cm.year_end as compatible_car_year_to,
                cb.name as compatible_car_brand, cb.name_ar as compatible_car_brand_ar,
                jsonb_array_length(COALESCE(p.car_model_ids, '[]'::jsonb)) as compatible_car_models_count
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT cm.id, cm.name, cm.name_ar, cm.year_start, cm.year_end, cm.brand_id
           FROM car_models cm
           WHERE p.car_model_ids IS NOT NULL
             AND jsonb_array_length(p.car_model_ids) > 0
             AND cm.id = (p.car_model_ids->>0)::uuid
             AND cm.deleted_at IS NULL
           LIMIT 1
         ) first_cm ON TRUE
         LEFT JOIN car_brands cb ON first_cm.brand_id = cb.id
         WHERE ${whereClause}
         ORDER BY p.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, Number(limit), Number(skip)],
      );

      const products = productsResult.rows.map((p: any) => ({
        ...p,
        car_model_ids: p.car_model_ids || [],
        images: p.images || [],
      }));

      return res.json({ products, total });
    } catch (err: any) {
      console.error("Products error:", err);
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get(
    "/api/products/all",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT p.*,
                pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                c.name as category_name, c.name_ar as category_name_ar
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.deleted_at IS NULL
         ORDER BY p.created_at DESC`,
        );
        return res.json({
          products: result.rows.map((p: any) => ({
            ...p,
            car_model_ids: p.car_model_ids || [],
            images: p.images || [],
          })),
          total: result.rows.length,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get("/api/products/search", async (req: Request, res: Response) => {
    try {
      const { q } = req.query;
      if (!q) return res.json({ products: [] });

      const searchTerm = `%${q}%`;
      const result = await query(
        `SELECT p.*,
                pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                pb.country_of_origin as manufacturer_country, pb.country_of_origin_ar as manufacturer_country_ar,
                c.name as category_name, c.name_ar as category_name_ar,
                first_cm.name as compatible_car_model, first_cm.name_ar as compatible_car_model_ar,
                first_cm.year_start as compatible_car_year_from, first_cm.year_end as compatible_car_year_to,
                cb.name as compatible_car_brand, cb.name_ar as compatible_car_brand_ar,
                jsonb_array_length(COALESCE(p.car_model_ids, '[]'::jsonb)) as compatible_car_models_count
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT cm.id, cm.name, cm.name_ar, cm.year_start, cm.year_end, cm.brand_id
           FROM car_models cm
           WHERE p.car_model_ids IS NOT NULL
             AND jsonb_array_length(p.car_model_ids) > 0
             AND cm.id = (p.car_model_ids->>0)::uuid
             AND cm.deleted_at IS NULL
           LIMIT 1
         ) first_cm ON TRUE
         LEFT JOIN car_brands cb ON first_cm.brand_id = cb.id
         WHERE p.deleted_at IS NULL
         AND (p.name ILIKE $1 OR p.name_ar ILIKE $1 OR p.sku ILIKE $1 OR p.description ILIKE $1 OR p.description_ar ILIKE $1)
         ORDER BY p.created_at DESC LIMIT 50`,
        [searchTerm],
      );
      return res.json({
        products: result.rows.map((p: any) => ({
          ...p,
          car_model_ids: p.car_model_ids || [],
          images: p.images || [],
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT p.*,
                pb.id as pb_id, pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                pb.logo as product_brand_logo, pb.country_of_origin as manufacturer_country,
                pb.country_of_origin_ar as manufacturer_country_ar,
                c.id as cat_id, c.name as category_name, c.name_ar as category_name_ar, c.icon as category_icon,
                s.id as supplier_id_ref, s.name as supplier_name, s.name_ar as supplier_name_ar,
                s.profile_image as supplier_profile_image, s.phone as supplier_phone,
                s.email as supplier_email, s.contact_email as supplier_contact_email,
                s.website_url as supplier_website_url, s.phone_numbers as supplier_phone_numbers,
                s.address as supplier_address, s.description as supplier_description,
                s.description_ar as supplier_description_ar
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN suppliers s ON pb.supplier_id = s.id
         WHERE p.id = $1`,
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      const p = result.rows[0];
      p.car_model_ids = p.car_model_ids || [];
      p.images = p.images || [];
      p.price = parseFloat(p.price) || 0;
      p.sale_price = p.sale_price ? parseFloat(p.sale_price) : null;

      // Build nested objects
      p.product_brand = p.pb_id
        ? {
            id: p.pb_id,
            name: p.product_brand_name,
            name_ar: p.product_brand_name_ar,
            logo: p.product_brand_logo,
            country_of_origin: p.manufacturer_country,
            country_of_origin_ar: p.manufacturer_country_ar,
            supplier: p.supplier_id_ref
              ? {
                  id: p.supplier_id_ref,
                  name: p.supplier_name,
                  name_ar: p.supplier_name_ar,
                  profile_image: p.supplier_profile_image || null,
                  phone: p.supplier_phone || null,
                  email: p.supplier_email || p.supplier_contact_email || null,
                  contact_email:
                    p.supplier_contact_email || p.supplier_email || null,
                  website_url: p.supplier_website_url || null,
                  phone_numbers: p.supplier_phone_numbers || [],
                  address: p.supplier_address || null,
                  description: p.supplier_description || null,
                  description_ar: p.supplier_description_ar || null,
                }
              : null,
          }
        : null;
      p.supplier = p.product_brand?.supplier || null;

      p.category = p.cat_id
        ? {
            id: p.cat_id,
            name: p.category_name,
            name_ar: p.category_name_ar,
            icon: p.category_icon,
          }
        : null;

      // Fetch car models for compatible cars display
      let car_models: any[] = [];
      if (p.car_model_ids && p.car_model_ids.length > 0) {
        const cmResult = await query(
          `SELECT cm.id, cm.name, cm.name_ar, cm.image_url, cm.year_start, cm.year_end,
                  cb.id as brand_id, cb.name as brand_name, cb.name_ar as brand_name_ar, cb.logo as brand_logo
           FROM car_models cm
           LEFT JOIN car_brands cb ON cm.brand_id = cb.id
           WHERE cm.id::text IN (SELECT jsonb_array_elements_text($1::jsonb)) AND cm.deleted_at IS NULL`,
          [JSON.stringify(p.car_model_ids)],
        ).catch(() => ({ rows: [] }));
        car_models = cmResult.rows.map((m: any) => ({
          id: m.id,
          name: m.name,
          name_ar: m.name_ar,
          image_url: m.image_url,
          year_start: m.year_start,
          year_end: m.year_end,
          brand: m.brand_id
            ? {
                id: m.brand_id,
                name: m.brand_name,
                name_ar: m.brand_name_ar,
                logo: m.brand_logo,
              }
            : null,
        }));
      }
      p.car_models = car_models;

      // Clean up flat fields
      delete p.pb_id;
      delete p.cat_id;
      delete p.product_brand_name;
      delete p.product_brand_name_ar;
      delete p.product_brand_logo;
      delete p.category_name;
      delete p.category_name_ar;
      delete p.category_icon;
      delete p.supplier_id_ref;
      delete p.supplier_name;
      delete p.supplier_name_ar;
      delete p.supplier_profile_image;
      delete p.supplier_phone;
      delete p.supplier_email;
      delete p.supplier_contact_email;
      delete p.supplier_website_url;
      delete p.supplier_phone_numbers;
      delete p.supplier_address;
      delete p.supplier_description;
      delete p.supplier_description_ar;
      delete p.manufacturer_country;
      delete p.manufacturer_country_ar;

      return res.json(p);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/products",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          description,
          description_ar,
          price,
          sku,
          product_brand_id,
          category_id,
          image_url,
          images,
          car_model_ids,
          stock_quantity,
          hidden_status,
        } = req.body;
        if (!name || !name_ar || price === undefined || !sku) {
          return res
            .status(400)
            .json({ detail: "name, name_ar, price, sku are required" });
        }

        const result = await query(
          `INSERT INTO products (id, name, name_ar, description, description_ar, price, sku, product_brand_id, category_id, image_url, images, car_model_ids, stock_quantity, hidden_status, added_by_admin_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            genId(),
            name,
            name_ar,
            description || null,
            description_ar || null,
            price,
            sku,
            product_brand_id || null,
            category_id || null,
            image_url || null,
            JSON.stringify(images || []),
            JSON.stringify(car_model_ids || []),
            stock_quantity || 0,
            hidden_status || false,
            (req as any).user?.id || null,
          ],
        );
        const product = result.rows[0];
        // Broadcast new product to all clients
        broadcastToAll({ type: "product_created", data: product });
        return res.json(product);
      } catch (err: any) {
        if (err.code === "23505")
          return res.status(400).json({ detail: "SKU already exists" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/products/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          description,
          description_ar,
          price,
          sku,
          product_brand_id,
          category_id,
          image_url,
          images,
          car_model_ids,
          stock_quantity,
          hidden_status,
        } = req.body;

        // Get old product to detect stock changes
        const oldProduct = await query(
          "SELECT stock_quantity FROM products WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        const oldStock = oldProduct.rows[0]?.stock_quantity ?? null;

        const result = await query(
          `UPDATE products SET name=$1,name_ar=$2,description=$3,description_ar=$4,price=$5,sku=$6,product_brand_id=$7,category_id=$8,image_url=$9,images=$10,car_model_ids=$11,stock_quantity=$12,hidden_status=$13,updated_at=NOW()
         WHERE id=$14 AND deleted_at IS NULL RETURNING *`,
          [
            name,
            name_ar,
            description || null,
            description_ar || null,
            price,
            sku,
            product_brand_id || null,
            category_id || null,
            image_url || null,
            JSON.stringify(images || []),
            JSON.stringify(car_model_ids || []),
            stock_quantity || 0,
            hidden_status || false,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const product = result.rows[0];

        // Broadcast product_updated to all clients
        broadcastToAll({ type: "product_updated", data: product });

        // If stock just ran out, notify all admins
        try {
          const newStock = parseInt(stock_quantity ?? 0);
          const wasInStock = oldStock === null || parseInt(oldStock) > 0;
          if (newStock === 0 && wasInStock) {
            const admins = await query(
              "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
            );
            for (const admin of admins.rows) {
              const notifId = genId();
              await query(
                "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type) VALUES ($1,$2,$3,$4,$5,$6,'warning')",
                [
                  notifId,
                  admin.id,
                  "Out of Stock",
                  "نفاد المخزون",
                  `"${name}" is out of stock`,
                  `نفد مخزون المنتج "${name_ar || name}"`,
                ],
              );
              broadcastToUser(admin.id, {
                type: "notification",
                data: {
                  id: notifId,
                  title: "نفاد المخزون",
                  message: `نفد مخزون المنتج "${name_ar || name}"`,
                  type: "warning",
                  read: false,
                  created_at: new Date().toISOString(),
                },
              });
            }
            broadcastToAll({
              type: "product_stock_updated",
              data: { id: product.id, stock_quantity: 0, name, name_ar },
            });
          } else if (
            newStock > 0 &&
            oldStock !== null &&
            parseInt(oldStock) === 0
          ) {
            // Stock restocked — notify admins
            const admins = await query(
              "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
            );
            for (const admin of admins.rows) {
              const notifId = genId();
              await query(
                "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type) VALUES ($1,$2,$3,$4,$5,$6,'success')",
                [
                  notifId,
                  admin.id,
                  "Stock Restocked",
                  "تم تجديد المخزون",
                  `"${name}" is back in stock (${newStock} units)`,
                  `تم تجديد مخزون "${name_ar || name}" (${newStock} وحدة)`,
                ],
              );
              broadcastToUser(admin.id, {
                type: "notification",
                data: {
                  id: notifId,
                  title: "تم تجديد المخزون",
                  message: `تم تجديد مخزون "${name_ar || name}" (${newStock} وحدة)`,
                  type: "success",
                  read: false,
                  created_at: new Date().toISOString(),
                },
              });
            }
            broadcastToAll({
              type: "product_stock_updated",
              data: { id: product.id, stock_quantity: newStock, name, name_ar },
            });
          }
        } catch {}

        return res.json(product);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/products/:id/price",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { price } = req.body;
        const result = await query(
          "UPDATE products SET price=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [price, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const product = result.rows[0];
        broadcastToAll({
          type: "price_changed",
          data: {
            id: product.id,
            price,
            name: product.name,
            name_ar: product.name_ar,
          },
        });
        return res.json(product);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/products/:id/hidden",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { hidden_status } = req.body;
        const result = await query(
          "UPDATE products SET hidden_status=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [hidden_status, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/products/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE products SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CART ====================

  app.get(
    "/api/cart",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          `SELECT ci.*, p.name, p.name_ar, p.price, p.image_url, p.sku, p.stock_quantity,
                pb.name as product_brand_name
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         WHERE ci.user_id = $1
         ORDER BY ci.created_at`,
          [userId],
        );

        const items = result.rows.map((item: any) => ({
          ...item,
          product: {
            id: item.product_id,
            name: item.name,
            name_ar: item.name_ar,
            price: item.price,
            image_url: item.image_url,
            sku: item.sku,
            stock_quantity: item.stock_quantity,
            product_brand_name: item.product_brand_name,
          },
        }));

        const total = items.reduce((sum: number, item: any) => {
          const price = item.final_unit_price || item.product.price;
          return sum + price * item.quantity;
        }, 0);

        return res.json({ items, total, shipping_cost: SHIPPING_COST });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/cart/add",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const {
          product_id,
          quantity = 1,
          bundle_group_id,
          bundle_offer_id,
          bundle_discount_percentage,
        } = req.body;

        const productResult = await query(
          "SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL",
          [product_id],
        );
        if (productResult.rows.length === 0)
          return res.status(404).json({ detail: "Product not found" });

        const existing = await query(
          "SELECT * FROM cart_items WHERE user_id=$1 AND product_id=$2 AND (bundle_group_id IS NULL OR bundle_group_id=$3)",
          [userId, product_id, bundle_group_id || null],
        );

        if (existing.rows.length > 0 && !bundle_group_id) {
          const newQty = existing.rows[0].quantity + quantity;
          await query(
            "UPDATE cart_items SET quantity=$1,updated_at=NOW() WHERE id=$2",
            [newQty, existing.rows[0].id],
          );
        } else {
          await query(
            "INSERT INTO cart_items (id,user_id,product_id,quantity,bundle_group_id,bundle_offer_id,bundle_discount_percentage) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [
              genId(),
              userId,
              product_id,
              quantity,
              bundle_group_id || null,
              bundle_offer_id || null,
              bundle_discount_percentage || null,
            ],
          );
        }

        return res.json({ message: "Added to cart" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/cart/add-enhanced",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const {
          product_id,
          quantity = 1,
          original_unit_price,
          final_unit_price,
          discount_details,
          bundle_group_id,
          added_by_admin_id,
        } = req.body;

        await query(
          `INSERT INTO cart_items (id,user_id,product_id,quantity,original_unit_price,final_unit_price,discount_details,bundle_group_id,added_by_admin_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            genId(),
            userId,
            product_id,
            quantity,
            original_unit_price || null,
            final_unit_price || null,
            discount_details ? JSON.stringify(discount_details) : null,
            bundle_group_id || null,
            added_by_admin_id || null,
          ],
        );

        return res.json({ message: "Added to cart" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/cart/update",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id, quantity } = req.body;

        if (quantity <= 0) {
          await query(
            "DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2",
            [userId, product_id],
          );
        } else {
          await query(
            "UPDATE cart_items SET quantity=$1,updated_at=NOW() WHERE user_id=$2 AND product_id=$3",
            [quantity, userId, product_id],
          );
        }

        return res.json({ message: "Cart updated" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/cart/remove/:productId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query(
          "DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2",
          [userId, req.params.productId],
        );
        return res.json({ message: "Removed from cart" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/cart/void-bundle/:bundleGroupId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query(
          "DELETE FROM cart_items WHERE user_id=$1 AND bundle_group_id=$2",
          [userId, req.params.bundleGroupId],
        );
        return res.json({ message: "Bundle voided" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/cart/clear",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query("DELETE FROM cart_items WHERE user_id=$1", [userId]);
        return res.json({ message: "Cart cleared" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/cart/validate-stock",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const cartResult = await query(
          `SELECT ci.quantity, p.stock_quantity, p.name, p.name_ar FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         WHERE ci.user_id=$1`,
          [userId],
        );

        const invalid = cartResult.rows.filter(
          (item: any) => item.quantity > item.stock_quantity,
        );
        if (invalid.length > 0) {
          return res.status(400).json({ valid: false, invalid_items: invalid });
        }
        return res.json({ valid: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ORDERS ====================

  app.get(
    "/api/orders",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT * FROM orders WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
          [userId],
        );
        return res.json(
          result.rows.map((o: any) => ({ ...o, items: o.items || [] })),
        );
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/admin",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT o.*, o.total_amount::float as total, o.discount_amount::float as discount,
                u.name as user_name, u.email as user_email, u.phone as customer_phone
         FROM orders o
         LEFT JOIN users u ON o.user_id = u.id
         WHERE o.deleted_at IS NULL
         ORDER BY o.created_at DESC`,
        );
        const orders = result.rows.map((o: any) => ({
          ...o,
          items: o.items || [],
        }));
        return res.json({ orders });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/admin/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT o.*, u.name as user_name, u.email as user_email
         FROM orders o LEFT JOIN users u ON o.user_id = u.id
         WHERE o.id=$1`,
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const o = result.rows[0];
        o.items = o.items || [];
        return res.json(o);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/my/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT * FROM orders WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
          [req.params.id, userId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Order not found" });
        }
        const order = result.rows[0];
        order.items = order.items || [];
        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/orders/my/:id/cancel",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT * FROM orders WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
          [req.params.id, userId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Order not found" });
        }
        const order = result.rows[0];
        const nonCancelableStatuses = ["shipped", "delivered", "cancelled"];
        if (nonCancelableStatuses.includes(order.status)) {
          return res
            .status(400)
            .json({ detail: "Cannot cancel order in current status" });
        }
        await query(
          "UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1 AND user_id=$2",
          [req.params.id, userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/pending-count/:userId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT COUNT(*) FROM orders WHERE user_id=$1 AND status='pending' AND deleted_at IS NULL",
          [req.params.userId],
        );
        return res.json({ count: parseInt(result.rows[0].count) });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/orders",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const {
          first_name,
          last_name,
          email,
          phone,
          street_address,
          city,
          state,
          country = "Egypt",
          delivery_instructions,
          payment_method = "cash_on_delivery",
          notes,
        } = req.body;

        // Get cart items
        const cartResult = await query(
          `SELECT ci.*, p.name, p.name_ar, p.price, p.image_url, p.sku
         FROM cart_items ci JOIN products p ON ci.product_id = p.id
         WHERE ci.user_id=$1`,
          [userId],
        );

        if (cartResult.rows.length === 0) {
          return res.status(400).json({ detail: "Cart is empty" });
        }

        const items = cartResult.rows.map((item: any) => ({
          product_id: item.product_id,
          name: item.name,
          name_ar: item.name_ar,
          sku: item.sku,
          image_url: item.image_url,
          quantity: item.quantity,
          unit_price: item.final_unit_price || item.price,
          original_unit_price: item.original_unit_price || item.price,
          discount_details: item.discount_details,
          bundle_group_id: item.bundle_group_id,
          bundle_offer_id: item.bundle_offer_id || null,
          bundle_discount_percentage: item.bundle_discount_percentage || null,
        }));

        const subtotal = items.reduce((sum: number, item: any) => {
          let price = item.unit_price;
          if (!price || price === item.original_unit_price) {
            if (item.bundle_discount_percentage) {
              price =
                item.original_unit_price *
                (1 - item.bundle_discount_percentage / 100);
              item.unit_price = price;
            }
          }
          return sum + price * item.quantity;
        }, 0);
        const total = subtotal + SHIPPING_COST;

        const seqRes = await query(
          "SELECT LPAD(nextval('order_number_seq')::text, 7, '0') as num",
        );
        const orderNum = seqRes.rows[0].num;

        const result = await query(
          `INSERT INTO orders (id,user_id,order_number,first_name,last_name,email,phone,street_address,city,state,country,delivery_instructions,payment_method,notes,status,total_amount,shipping_cost,items)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$16,$17) RETURNING *`,
          [
            genId(),
            userId,
            orderNum,
            first_name,
            last_name,
            email || (req as any).user.email,
            phone,
            street_address,
            city,
            state,
            country,
            delivery_instructions || null,
            payment_method,
            notes || null,
            total,
            SHIPPING_COST,
            JSON.stringify(items),
          ],
        );

        // Decrease stock
        for (const item of items) {
          await query(
            "UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2 AND stock_quantity >= $1",
            [item.quantity, item.product_id],
          );
        }

        // Clear cart
        await query("DELETE FROM cart_items WHERE user_id=$1", [userId]);

        const order = result.rows[0];
        order.items = order.items || [];

        // Notify admins via DB and WebSocket
        try {
          // Fetch customer avatar
          const userRow = await query("SELECT picture FROM users WHERE id=$1", [
            userId,
          ]);
          const avatarUrl = userRow.rows[0]?.picture || null;
          const customerMeta = {
            kind: "new_order",
            order_id: order.id,
            order_number: orderNum,
            customer_name: `${first_name} ${last_name}`,
            customer_email: email || (req as any).user.email,
            customer_phone: phone,
            customer_avatar: avatarUrl,
          };

          const adminUsers = await query(
            "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
          );
          for (const adminUser of adminUsers.rows) {
            const notifId = genId();
            await query(
              "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'success',$7)",
              [
                notifId,
                adminUser.id,
                "New Order",
                "طلب جديد",
                `New order #${orderNum} received`,
                `تم استلام طلب جديد #${orderNum}`,
                JSON.stringify(customerMeta),
              ],
            );
            broadcastToUser(adminUser.id, {
              type: "notification",
              data: {
                id: notifId,
                title: "طلب جديد",
                message: `تم استلام طلب جديد #${orderNum}`,
                type: "success",
                read: false,
                created_at: new Date().toISOString(),
                metadata: customerMeta,
              },
            });
          }
          broadcastToAll({
            type: "order_created",
            data: { id: order.id, order_number: orderNum },
          });
        } catch {}

        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/orders/admin-assisted",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { customer_id, items, shipping_address, phone, notes } = req.body;

        const subtotal = items.reduce(
          (sum: number, item: any) =>
            sum +
            (item.final_unit_price || item.original_unit_price || 0) *
              item.quantity,
          0,
        );
        const total = subtotal + SHIPPING_COST;
        const seqRes2 = await query(
          "SELECT LPAD(nextval('order_number_seq')::text, 7, '0') as num",
        );
        const orderNum = seqRes2.rows[0].num;

        const result = await query(
          `INSERT INTO orders (id,user_id,order_number,street_address,phone,notes,status,total_amount,shipping_cost,items)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9) RETURNING *`,
          [
            genId(),
            customer_id,
            orderNum,
            shipping_address,
            phone,
            notes || null,
            total,
            SHIPPING_COST,
            JSON.stringify(items),
          ],
        );

        const order = result.rows[0];
        order.items = order.items || [];
        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/orders/:id/status",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { status } = req.query as { status: string };
        const result = await query(
          "UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [status, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const order = result.rows[0];

        // Notify the order owner via DB + WebSocket
        try {
          const statusLabels: Record<string, { en: string; ar: string }> = {
            pending: { en: "Order received", ar: "تم استلام طلبك" },
            preparing: { en: "Order being prepared", ar: "جاري تحضير طلبك" },
            shipped: { en: "Order shipped", ar: "تم شحن طلبك" },
            out_for_delivery: {
              en: "Out for delivery",
              ar: "الطلب في الطريق إليك",
            },
            delivered: { en: "Order delivered", ar: "تم توصيل طلبك" },
            cancelled: { en: "Order cancelled", ar: "تم إلغاء طلبك" },
          };
          const label = statusLabels[status] || {
            en: `Status: ${status}`,
            ar: `الحالة: ${status}`,
          };
          const orderNum = order.order_number || order.id?.slice(-8);

          // Fetch customer avatar for rich notification
          const userRow = await query("SELECT picture FROM users WHERE id=$1", [
            order.user_id,
          ]);
          const customerAvatar = userRow.rows[0]?.picture || null;
          const adminUser = (req as any).user;
          const adminName = adminUser?.name || adminUser?.email || "Admin";

          const orderMeta = {
            kind: "order_updated",
            order_id: order.id,
            order_number: orderNum,
            new_status: status,
            customer_name:
              `${order.first_name || ""} ${order.last_name || ""}`.trim(),
            customer_email: order.email,
            customer_phone: order.phone,
            customer_avatar: customerAvatar,
            admin_name: adminName,
          };

          const notifId = genId();
          await query(
            "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
            [
              notifId,
              order.user_id,
              `Order #${orderNum}`,
              `طلب #${orderNum}`,
              label.en,
              label.ar,
              JSON.stringify(orderMeta),
            ],
          );
          broadcastToUser(order.user_id, {
            type: "notification",
            data: {
              id: notifId,
              title: `طلب #${orderNum}`,
              message: label.ar,
              type: "info",
              read: false,
              created_at: new Date().toISOString(),
              metadata: orderMeta,
            },
          });
          broadcastToAll({ type: "order_updated", data: order });
        } catch {}

        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/orders/:id/discount",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { discount } = req.body;
        const result = await query(
          "UPDATE orders SET discount_amount=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [discount, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/orders/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const orderRes = await query(
          "SELECT id, items, status FROM orders WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        if (orderRes.rows.length === 0) {
          return res.status(404).json({ detail: "Order not found" });
        }
        const order = orderRes.rows[0];
        const items: Array<{ product_id: string; quantity: number }> =
          typeof order.items === "string"
            ? JSON.parse(order.items)
            : order.items || [];

        await query("UPDATE orders SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);

        if (items.length > 0 && order.status !== "cancelled") {
          for (const item of items) {
            if (item.product_id && item.quantity > 0) {
              await query(
                "UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id=$2 AND deleted_at IS NULL",
                [item.quantity, item.product_id],
              );
            }
          }
        }

        return res.json({
          message: "Deleted",
          stock_restored: items.length > 0,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== FAVORITES ====================

  app.get(
    "/api/favorites",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          `SELECT f.*, p.name, p.name_ar, p.price, p.image_url, p.sku,
                pb.name as product_brand_name
         FROM favorites f
         JOIN products p ON f.product_id = p.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         WHERE f.user_id=$1 ORDER BY f.created_at DESC`,
          [userId],
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/favorites/check/:productId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT id FROM favorites WHERE user_id=$1 AND product_id=$2",
          [userId, req.params.productId],
        );
        return res.json({ is_favorite: result.rows.length > 0 });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/favorites/toggle",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id } = req.body;
        const existing = await query(
          "SELECT id FROM favorites WHERE user_id=$1 AND product_id=$2",
          [userId, product_id],
        );
        if (existing.rows.length > 0) {
          await query(
            "DELETE FROM favorites WHERE user_id=$1 AND product_id=$2",
            [userId, product_id],
          );
          return res.json({ is_favorite: false });
        } else {
          await query(
            "INSERT INTO favorites (id,user_id,product_id) VALUES ($1,$2,$3)",
            [genId(), userId, product_id],
          );
          return res.json({ is_favorite: true });
        }
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/favorites",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id } = req.body;

        try {
          await query(
            "INSERT INTO favorites (id,user_id,product_id) VALUES ($1,$2,$3)",
            [genId(), userId, product_id],
          );
        } catch (e: any) {
          if (e.code !== "23505") throw e;
        }

        return res.json({ is_favorite: true, message: "Added to favorites" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/favorites/:productId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query(
          "DELETE FROM favorites WHERE user_id=$1 AND product_id=$2",
          [userId, req.params.productId],
        );
        return res.json({
          is_favorite: false,
          message: "Removed from favorites",
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ============================================================
  // SUBSCRIPTION REQUESTS ROUTES
  // ============================================================

  // GET /api/subscription-requests — Admin/Owner: list all (optionally filter by ?email=); User: list own
  app.get(
    "/api/subscription-requests",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        let rows;
        if (["owner", "admin"].includes(role)) {
          const filterEmail = req.query.email as string | undefined;
          if (filterEmail) {
            rows = await query(
              `SELECT * FROM subscription_requests WHERE email=$1 ORDER BY created_at DESC`,
              [filterEmail],
            );
          } else {
            rows = await query(
              `SELECT * FROM subscription_requests ORDER BY created_at DESC`,
            );
          }
        } else {
          rows = await query(
            `SELECT * FROM subscription_requests WHERE email=$1 ORDER BY created_at DESC`,
            [user.email],
          );
        }
        return res.json(rows.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /api/subscription-requests — Any authenticated user submits a request
  app.post(
    "/api/subscription-requests",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const {
          customer_name,
          email,
          phone,
          governorate,
          village,
          address,
          car_model,
          business_type,
          request_type,
          notes,
        } = req.body;
        const result = await query(
          `INSERT INTO subscription_requests
          (id, customer_name, email, phone, governorate, village, detailed_address, car_model_name, business_type, request_type, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
         RETURNING *`,
          [
            genId(),
            customer_name || user.name || user.username || "",
            email || user.email || "",
            phone || "",
            governorate || "",
            village || "",
            address || "",
            car_model || "",
            business_type || "",
            request_type || "subscription",
            notes || "",
          ],
        );
        return res.status(201).json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PATCH /api/subscription-requests/:id — Admin/Owner: approve or reject
  app.patch(
    "/api/subscription-requests/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const { status } = req.body;
        if (!["approved", "rejected", "pending"].includes(status)) {
          return res.status(400).json({ detail: "Invalid status" });
        }
        const result = await query(
          `UPDATE subscription_requests
         SET status=$1, reviewed_by=$2, reviewed_at=NOW()
         WHERE id=$3
         RETURNING *`,
          [status, user.id, req.params.id],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Not found" });
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/subscription-requests/:id/approve",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const reqResult = await query(
          `UPDATE subscription_requests SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2 RETURNING *`,
          [user.id, req.params.id],
        );
        if (reqResult.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const subscriptionReq = reqResult.rows[0];
        if (subscriptionReq.email) {
          await query(
            `INSERT INTO subscribers (id, email, name, phone, subscription_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, subscription_type=EXCLUDED.subscription_type, updated_at=NOW(), deleted_at=NULL`,
            [
              genId(),
              subscriptionReq.email,
              subscriptionReq.customer_name || subscriptionReq.email,
              subscriptionReq.phone || null,
              subscriptionReq.request_type || "monthly",
            ],
          ).catch(() => {});
          // Copy subscription form data to user profile (name + phone)
          await query(
            `UPDATE users SET
             name = CASE WHEN $1 != '' THEN $1 ELSE name END,
             phone = CASE WHEN $2 != '' THEN $2 ELSE phone END,
             updated_at = NOW()
           WHERE email = $3`,
            [
              subscriptionReq.customer_name || "",
              subscriptionReq.phone || "",
              subscriptionReq.email,
            ],
          ).catch(() => {});
        }
        return res.json(subscriptionReq);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/subscription-requests/:id/reject",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          `UPDATE subscription_requests SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2 RETURNING *`,
          [user.id, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // DELETE /api/subscription-requests/:id — Admin/Owner: delete a request + revoke subscriber
  app.delete(
    "/api/subscription-requests/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const reqRes = await query(
          `SELECT * FROM subscription_requests WHERE id=$1`,
          [req.params.id],
        );
        const subReq = reqRes.rows[0];
        let revokedUserId: string | null = null;
        if (subReq) {
          if (subReq.email) {
            await query(
              `UPDATE subscribers SET deleted_at=NOW() WHERE email=$1 AND deleted_at IS NULL`,
              [subReq.email],
            );
            // Find the user account associated with this email
            const uRes = await query(
              `SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL LIMIT 1`,
              [subReq.email],
            );
            if (uRes.rows[0]) revokedUserId = uRes.rows[0].id;
          }
          if (subReq.phone && !revokedUserId) {
            await query(
              `UPDATE subscribers SET deleted_at=NOW() WHERE phone=$1 AND deleted_at IS NULL`,
              [subReq.phone],
            );
            const uRes = await query(
              `SELECT id FROM users WHERE phone=$1 AND deleted_at IS NULL LIMIT 1`,
              [subReq.phone],
            );
            if (uRes.rows[0]) revokedUserId = uRes.rows[0].id;
          }
        }
        await query(`DELETE FROM subscription_requests WHERE id=$1`, [
          req.params.id,
        ]);
        // Broadcast to the customer's device so it resets subscription status immediately
        if (revokedUserId) {
          broadcastToUser(revokedUserId, {
            type: "subscription_revoked",
            data: { status: "none" },
          });
        }
        return res.json({
          success: true,
          was_approved: subReq?.status === "approved",
          revoked_user_id: revokedUserId,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== OWNERS ====================

  app.get(
    "/api/owners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM owners WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/owners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone } = req.body;
        if (!email || !name)
          return res.status(400).json({ detail: "email and name required" });
        const result = await query(
          "INSERT INTO owners (id,email,name,phone) VALUES ($1,$2,$3,$4) RETURNING *",
          [genId(), email.toLowerCase(), name, phone || null],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        if (err.code === "23505")
          return res.status(400).json({ detail: "Owner already exists" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/owners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone } = req.body;
        const result = await query(
          "UPDATE owners SET email=$1,name=$2,phone=$3,updated_at=NOW() WHERE id=$4 AND deleted_at IS NULL RETURNING *",
          [email?.toLowerCase(), name, phone || null, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/owners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE owners SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ADMINS ====================

  app.get(
    "/api/admins",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM admins WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get("/api/admins/check-access", async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.json([]);

      const role = await getUserRole(user.email);
      if (!["owner", "partner", "admin"].includes(role)) return res.json([]);

      if (role === "admin") {
        const adminResult = await query(
          "SELECT * FROM admins WHERE email=$1 AND deleted_at IS NULL",
          [user.email],
        );
        return res.json(adminResult.rows);
      }

      const result = await query(
        "SELECT * FROM admins WHERE deleted_at IS NULL ORDER BY created_at DESC",
      );
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/admins",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, address, permissions } = req.body;
        if (!email || !name)
          return res.status(400).json({ detail: "email and name required" });

        const result = await query(
          "INSERT INTO admins (id,email,name,phone,address,permissions) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            genId(),
            email.toLowerCase(),
            name,
            phone || null,
            address || null,
            JSON.stringify(permissions || []),
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        if (err.code === "23505")
          return res.status(400).json({ detail: "Admin already exists" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/admins/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, address, permissions } = req.body;
        const result = await query(
          "UPDATE admins SET email=$1,name=$2,phone=$3,address=$4,permissions=$5,updated_at=NOW() WHERE id=$6 AND deleted_at IS NULL RETURNING *",
          [
            email?.toLowerCase(),
            name,
            phone || null,
            address || null,
            JSON.stringify(permissions || []),
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/admins/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE admins SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PARTNERS ====================

  app.get(
    "/api/partners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM partners WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/partners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, company_name } = req.body;
        if (!email || !name)
          return res.status(400).json({ detail: "email and name required" });

        const result = await query(
          "INSERT INTO partners (id,email,name,phone,company_name) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [
            genId(),
            email.toLowerCase(),
            name,
            phone || null,
            company_name || null,
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        if (err.code === "23505")
          return res.status(400).json({ detail: "Partner already exists" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/partners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, company_name } = req.body;
        const result = await query(
          "UPDATE partners SET email=$1,name=$2,phone=$3,company_name=$4,updated_at=NOW() WHERE id=$5 AND deleted_at IS NULL RETURNING *",
          [
            email?.toLowerCase(),
            name,
            phone || null,
            company_name || null,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/partners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE partners SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== SUBSCRIBERS ====================

  app.get(
    "/api/subscribers",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM subscribers WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post("/api/subscribers", async (req: Request, res: Response) => {
    try {
      const { email, name, phone, subscription_type } = req.body;
      if (!email || !name)
        return res.status(400).json({ detail: "email and name required" });

      const result = await query(
        "INSERT INTO subscribers (id,email,name,phone,subscription_type) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [
          genId(),
          email.toLowerCase(),
          name,
          phone || null,
          subscription_type || "basic",
        ],
      );
      return res.json(result.rows[0]);
    } catch (err: any) {
      if (err.code === "23505")
        return res.status(400).json({ detail: "Already subscribed" });
      return res.status(500).json({ detail: err.message });
    }
  });

  app.delete(
    "/api/subscribers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE subscribers SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== SUPPLIERS ====================

  app.get(
    "/api/suppliers",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          "SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY name",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/suppliers/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          "SELECT * FROM suppliers WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/suppliers",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_product_brand_ids,
        } = req.body;
        if (!name) return res.status(400).json({ detail: "name required" });
        const supplierId = genId();
        const result = await query(
          `INSERT INTO suppliers (id,name,name_ar,phone,email,address,notes,phone_numbers,contact_email,address_ar,website_url,description,description_ar,profile_image,slider_images,linked_product_brand_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [
            supplierId,
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            JSON.stringify(linked_product_brand_ids || []),
          ],
        );
        // Sync: update product_brands.supplier_id for linked brands
        if (linked_product_brand_ids && linked_product_brand_ids.length > 0) {
          await query(
            `UPDATE product_brands SET supplier_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [supplierId, linked_product_brand_ids],
          );
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/suppliers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_product_brand_ids,
        } = req.body;
        const result = await query(
          `UPDATE suppliers SET name=$1,name_ar=$2,phone=$3,email=$4,address=$5,notes=$6,
         phone_numbers=$7,contact_email=$8,address_ar=$9,website_url=$10,description=$11,
         description_ar=$12,profile_image=$13,slider_images=$14,linked_product_brand_ids=$15,updated_at=NOW()
         WHERE id=$16 AND deleted_at IS NULL RETURNING *`,
          [
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            JSON.stringify(linked_product_brand_ids || []),
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        // Sync: clear supplier_id from all brands then re-link
        await query(
          `UPDATE product_brands SET supplier_id=NULL WHERE supplier_id=$1 AND deleted_at IS NULL`,
          [req.params.id],
        );
        if (linked_product_brand_ids && linked_product_brand_ids.length > 0) {
          await query(
            `UPDATE product_brands SET supplier_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [req.params.id, linked_product_brand_ids],
          );
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/suppliers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE suppliers SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== DISTRIBUTORS ====================

  app.get(
    "/api/distributors",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          "SELECT * FROM distributors WHERE deleted_at IS NULL ORDER BY name",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/distributors/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          "SELECT * FROM distributors WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/distributors",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_car_brand_ids,
        } = req.body;
        if (!name) return res.status(400).json({ detail: "name required" });
        const distributorId = genId();
        const result = await query(
          `INSERT INTO distributors (id,name,name_ar,phone,email,address,notes,phone_numbers,contact_email,address_ar,website_url,description,description_ar,profile_image,slider_images,linked_car_brand_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [
            distributorId,
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            JSON.stringify(linked_car_brand_ids || []),
          ],
        );
        // Sync: update car_brands.distributor_id for linked brands
        if (linked_car_brand_ids && linked_car_brand_ids.length > 0) {
          await query(
            `UPDATE car_brands SET distributor_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [distributorId, linked_car_brand_ids],
          );
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/distributors/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_car_brand_ids,
        } = req.body;
        const result = await query(
          `UPDATE distributors SET name=$1,name_ar=$2,phone=$3,email=$4,address=$5,notes=$6,
         phone_numbers=$7,contact_email=$8,address_ar=$9,website_url=$10,description=$11,
         description_ar=$12,profile_image=$13,slider_images=$14,linked_car_brand_ids=$15,updated_at=NOW()
         WHERE id=$16 AND deleted_at IS NULL RETURNING *`,
          [
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            JSON.stringify(linked_car_brand_ids || []),
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        // Sync: clear distributor_id from all brands then re-link
        await query(
          `UPDATE car_brands SET distributor_id=NULL WHERE distributor_id=$1 AND deleted_at IS NULL`,
          [req.params.id],
        );
        if (linked_car_brand_ids && linked_car_brand_ids.length > 0) {
          await query(
            `UPDATE car_brands SET distributor_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [req.params.id, linked_car_brand_ids],
          );
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/distributors/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE distributors SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CUSTOMERS ====================

  app.delete(
    "/api/customers/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        await query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== NOTIFICATIONS ====================

  app.get(
    "/api/notifications",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
          [userId],
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/notifications/:id/read",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2 RETURNING metadata",
          [req.params.id, userId],
        );
        // If this is an order_updated notification, update the order's customer_last_read_status
        const meta = result.rows[0]?.metadata;
        if (
          meta &&
          meta.kind === "order_updated" &&
          meta.order_id &&
          meta.new_status
        ) {
          try {
            await query(
              "UPDATE orders SET customer_last_read_status=$1, customer_read_at=NOW() WHERE id=$2 AND user_id=$3",
              [meta.new_status, meta.order_id, userId],
            );
            // Broadcast to admins so their orders list updates in real-time
            broadcastToAll({
              type: "order_notification_read",
              data: {
                order_id: meta.order_id,
                status: meta.new_status,
                customer_id: userId,
              },
            });
          } catch {}
        }
        return res.json({ message: "Marked as read" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/notifications/read-all",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query("UPDATE notifications SET read=TRUE WHERE user_id=$1", [
          userId,
        ]);
        return res.json({ message: "All marked as read" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PROMOTIONS ====================

  app.get("/api/promotions", async (req: Request, res: Response) => {
    try {
      const { promotion_type, active_only = "true" } = req.query;
      let q = "SELECT * FROM promotions WHERE deleted_at IS NULL";
      const params: any[] = [];
      let paramIdx = 1;

      if (active_only === "true") {
        q += ` AND is_active = TRUE`;
      }
      if (promotion_type) {
        params.push(promotion_type);
        q += ` AND promotion_type = $${paramIdx}`;
        paramIdx++;
      }
      q += " ORDER BY sort_order ASC, created_at DESC";

      const result = await query(q, params);
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get("/api/promotions/:id", async (req: Request, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM promotions WHERE id=$1 AND deleted_at IS NULL",
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      return res.json(result.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/promotions",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          title,
          title_ar,
          image,
          promotion_type = "slider",
          is_active = true,
          target_product_id,
          target_car_model_id,
          sort_order = 0,
        } = req.body;
        if (!title) return res.status(400).json({ detail: "title required" });

        const result = await query(
          "INSERT INTO promotions (id,title,title_ar,image,promotion_type,is_active,target_product_id,target_car_model_id,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            genId(),
            title,
            title_ar || null,
            image || null,
            promotion_type,
            is_active,
            target_product_id || null,
            target_car_model_id || null,
            sort_order,
          ],
        );
        const promo = result.rows[0];

        if (is_active) {
          let product_name: string | null = null;
          let car_model_name: string | null = null;
          let car_model_image: string | null = null;
          if (target_product_id) {
            try {
              const pRow = await query(
                "SELECT name_ar, name FROM products WHERE id=$1 AND deleted_at IS NULL",
                [target_product_id],
              );
              product_name =
                pRow.rows[0]?.name_ar || pRow.rows[0]?.name || null;
            } catch {}
          }
          let car_model_year_start: number | null = null;
          let car_model_year_end: number | null = null;
          if (target_car_model_id) {
            try {
              const cmRow = await query(
                "SELECT name_ar, name, image_url, year_start, year_end FROM car_models WHERE id=$1 AND deleted_at IS NULL",
                [target_car_model_id],
              );
              if (cmRow.rows[0]) {
                car_model_name =
                  cmRow.rows[0].name_ar || cmRow.rows[0].name || null;
                car_model_image = cmRow.rows[0].image_url || null;
                car_model_year_start = cmRow.rows[0].year_start || null;
                car_model_year_end = cmRow.rows[0].year_end || null;
              }
            } catch {}
          }
          const promoMeta = {
            kind: "promotion",
            target_id: promo.id,
            image: image || null,
            title: title_ar || title,
            target_product_id: target_product_id || null,
            target_car_model_id: target_car_model_id || null,
            product_name,
            car_model_name,
            car_model_image,
            car_model_year_start,
            car_model_year_end,
          };
          // Broadcast promotion_started event to refresh product cache + show notification
          broadcastToAll({
            type: "promotion_started",
            data: {
              id: promo.id,
              title: title_ar || title,
              message: `عرض جديد: ${title_ar || title}`,
            },
          });

          // Notify admins via DB + WS (targeted)
          try {
            const admins = await query(
              "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
            );
            for (const admin of admins.rows) {
              const notifId = genId();
              await query(
                "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
                [
                  notifId,
                  admin.id,
                  "New Promotion",
                  "عرض جديد",
                  `New promotion added: ${title}`,
                  `تم إضافة عرض جديد: ${title_ar || title}`,
                  JSON.stringify(promoMeta),
                ],
              );
              broadcastToUser(admin.id, {
                type: "notification",
                data: {
                  id: notifId,
                  title: "عرض جديد",
                  message: `تم إضافة عرض جديد: ${title_ar || title}`,
                  type: "info",
                  read: false,
                  created_at: new Date().toISOString(),
                  metadata: promoMeta,
                },
              });
            }
          } catch {}
        }

        return res.json(promo);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/promotions/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          title,
          title_ar,
          image,
          promotion_type,
          is_active,
          target_product_id,
          target_car_model_id,
          sort_order,
        } = req.body;

        // Get current state to detect activation change
        const oldPromo = await query(
          "SELECT is_active FROM promotions WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        const wasActive = oldPromo.rows[0]?.is_active;

        const result = await query(
          "UPDATE promotions SET title=$1,title_ar=$2,image=$3,promotion_type=$4,is_active=$5,target_product_id=$6,target_car_model_id=$7,sort_order=$8,updated_at=NOW() WHERE id=$9 AND deleted_at IS NULL RETURNING *",
          [
            title,
            title_ar || null,
            image || null,
            promotion_type,
            is_active,
            target_product_id || null,
            target_car_model_id || null,
            sort_order || 0,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const promo = result.rows[0];

        // Broadcast activation/deactivation change
        if (is_active && !wasActive) {
          broadcastToAll({
            type: "promotion_started",
            data: {
              id: promo.id,
              title: title_ar || title,
              message: `عرض جديد: ${title_ar || title}`,
            },
          });
        } else if (!is_active && wasActive) {
          broadcastToAll({ type: "promotion_ended", data: { id: promo.id } });
        }

        return res.json(promo);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/promotions/:id/reorder",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { sort_order } = req.body;
        const result = await query(
          "UPDATE promotions SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [sort_order, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/promotions/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE promotions SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== BUNDLE OFFERS ====================

  app.get("/api/bundle-offers", async (req: Request, res: Response) => {
    try {
      const { active_only = "true" } = req.query;
      let q = "SELECT * FROM bundle_offers WHERE deleted_at IS NULL";
      if (active_only === "true") q += " AND is_active = TRUE";
      q += " ORDER BY created_at DESC";
      const result = await query(q);
      return res.json(
        result.rows.map((b: any) => ({
          ...b,
          product_ids: b.product_ids || [],
        })),
      );
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get("/api/bundle-offers/:id", async (req: Request, res: Response) => {
    try {
      const paramId = String(req.params.id);
      const isValidUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          paramId,
        );
      if (!isValidUUID) return res.status(404).json({ detail: "Not found" });
      const result = await query(
        "SELECT * FROM bundle_offers WHERE id=$1 AND deleted_at IS NULL",
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      const b = result.rows[0];
      b.product_ids = b.product_ids || [];

      // Fetch full product details for each product_id
      let products: any[] = [];
      if (b.product_ids.length > 0) {
        const productIds: string[] = Array.isArray(b.product_ids)
          ? b.product_ids
          : [];
        if (productIds.length > 0) {
          const productsResult = await query(
            `SELECT p.id, p.name, p.name_ar, p.description, p.description_ar,
                    p.price::float as price, p.sku, p.image_url, p.images, p.stock_quantity,
                    c.id as category_id, c.name as category_name, c.name_ar as category_name_ar,
                    pb.id as brand_id, pb.name as brand_name, pb.name_ar as brand_name_ar
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
             WHERE p.id::text IN (SELECT jsonb_array_elements_text($1::jsonb))
             AND p.deleted_at IS NULL`,
            [JSON.stringify(productIds)],
          );
          products = productsResult.rows.map((p: any) => ({
            ...p,
            price: parseFloat(p.price) || 0,
            images: p.images || [],
            category: p.category_id
              ? {
                  id: p.category_id,
                  name: p.category_name,
                  name_ar: p.category_name_ar,
                }
              : null,
            product_brand: p.brand_id
              ? { id: p.brand_id, name: p.brand_name, name_ar: p.brand_name_ar }
              : null,
          }));
        }
      }

      // Calculate totals
      const originalTotal = products.reduce((sum, p) => sum + p.price, 0);
      const discountPct = parseFloat(b.discount_percentage) || 0;
      const discountedTotal = originalTotal * (1 - discountPct / 100);

      // Fetch car model if linked
      let targetCarModel = null;
      if (b.target_car_model_id) {
        const cmResult = await query(
          "SELECT id, name, name_ar, image_url FROM car_models WHERE id=$1 AND deleted_at IS NULL",
          [b.target_car_model_id],
        ).catch(() => ({ rows: [] }));
        if (cmResult.rows.length > 0) targetCarModel = cmResult.rows[0];
      }

      return res.json({
        ...b,
        discount_percentage: discountPct,
        products,
        original_total: originalTotal,
        discounted_total: discountedTotal,
        target_car_model: targetCarModel,
      });
    } catch (err: any) {
      if (err.code === "22P02")
        return res.status(404).json({ detail: "Not found" });
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/bundle-offers",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          description,
          description_ar,
          discount_percentage,
          target_car_model_id,
          product_ids,
          image,
          is_active = true,
        } = req.body;
        if (!name || discount_percentage === undefined)
          return res
            .status(400)
            .json({ detail: "name and discount_percentage required" });

        const result = await query(
          "INSERT INTO bundle_offers (id,name,name_ar,description,description_ar,discount_percentage,target_car_model_id,product_ids,image,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            genId(),
            name,
            name_ar || null,
            description || null,
            description_ar || null,
            discount_percentage,
            target_car_model_id || null,
            JSON.stringify(product_ids || []),
            image || null,
            is_active,
          ],
        );
        const b = result.rows[0];
        b.product_ids = b.product_ids || [];

        if (is_active) {
          let car_model_name: string | null = null;
          let car_model_image: string | null = null;
          let car_model_year_start: number | null = null;
          let car_model_year_end: number | null = null;
          if (target_car_model_id) {
            try {
              const cmRow = await query(
                "SELECT name_ar, name, image_url, year_start, year_end FROM car_models WHERE id=$1 AND deleted_at IS NULL",
                [target_car_model_id],
              );
              if (cmRow.rows[0]) {
                car_model_name =
                  cmRow.rows[0].name_ar || cmRow.rows[0].name || null;
                car_model_image = cmRow.rows[0].image_url || null;
                car_model_year_start = cmRow.rows[0].year_start || null;
                car_model_year_end = cmRow.rows[0].year_end || null;
              }
            } catch {}
          }
          const bundleMeta = {
            kind: "bundle_offer",
            target_id: b.id,
            image: image || null,
            discount_percentage,
            title: name_ar || name,
            product_count: (product_ids || []).length,
            car_model_id: target_car_model_id || null,
            car_model_name,
            car_model_image,
            car_model_year_start,
            car_model_year_end,
          };
          broadcastToAll({
            type: "promotion_started",
            data: {
              id: b.id,
              title: name_ar || name,
              message: `عرض مجمع جديد: ${name_ar || name} - خصم ${discount_percentage}%`,
            },
          });

          try {
            const admins = await query(
              "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
            );
            for (const admin of admins.rows) {
              const notifId = genId();
              await query(
                "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
                [
                  notifId,
                  admin.id,
                  "New Bundle Offer",
                  "عرض مجمع جديد",
                  `New bundle offer: ${name} - ${discount_percentage}% off`,
                  `عرض مجمع جديد: ${name_ar || name} - خصم ${discount_percentage}%`,
                  JSON.stringify(bundleMeta),
                ],
              );
              broadcastToUser(admin.id, {
                type: "notification",
                data: {
                  id: notifId,
                  title: "عرض مجمع جديد",
                  message: `عرض مجمع جديد: ${name_ar || name} - خصم ${discount_percentage}%`,
                  type: "info",
                  read: false,
                  created_at: new Date().toISOString(),
                  metadata: bundleMeta,
                },
              });
            }
          } catch {}
        }

        return res.json(b);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/bundle-offers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          description,
          description_ar,
          discount_percentage,
          target_car_model_id,
          product_ids,
          image,
          is_active,
        } = req.body;

        const oldBundle = await query(
          "SELECT is_active FROM bundle_offers WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        const wasActive = oldBundle.rows[0]?.is_active;

        const result = await query(
          "UPDATE bundle_offers SET name=$1,name_ar=$2,description=$3,description_ar=$4,discount_percentage=$5,target_car_model_id=$6,product_ids=$7,image=$8,is_active=$9,updated_at=NOW() WHERE id=$10 AND deleted_at IS NULL RETURNING *",
          [
            name,
            name_ar || null,
            description || null,
            description_ar || null,
            discount_percentage,
            target_car_model_id || null,
            JSON.stringify(product_ids || []),
            image || null,
            is_active,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const b = result.rows[0];

        if (is_active && !wasActive) {
          broadcastToAll({
            type: "promotion_started",
            data: {
              id: b.id,
              title: name_ar || name,
              message: `عرض مجمع: ${name_ar || name} - خصم ${discount_percentage}%`,
            },
          });
        } else if (!is_active && wasActive) {
          broadcastToAll({ type: "promotion_ended", data: { id: b.id } });
        }

        return res.json(b);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/bundle-offers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE bundle_offers SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== MARKETING ====================

  app.get("/api/marketing/home-slider", async (req: Request, res: Response) => {
    try {
      const [promotionsResult, bundlesResult] = await Promise.all([
        query(
          `SELECT p.*,
                  CASE WHEN p.target_product_id IS NOT NULL THEN
                    (SELECT json_build_object('id', pr.id, 'name', pr.name, 'name_ar', pr.name_ar)
                     FROM products pr WHERE pr.id = p.target_product_id AND pr.deleted_at IS NULL)
                  END as target_product,
                  CASE WHEN p.target_car_model_id IS NOT NULL THEN
                    (SELECT json_build_object('id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar)
                     FROM car_models cm WHERE cm.id = p.target_car_model_id AND cm.deleted_at IS NULL)
                  END as target_car_model
           FROM promotions p
           WHERE p.deleted_at IS NULL AND p.is_active=TRUE AND p.promotion_type='slider'
           ORDER BY p.sort_order ASC`,
        ),
        query(
          `SELECT bo.*,
                  bo.name as title, bo.name_ar as title_ar,
                  bo.description as subtitle, bo.description_ar as subtitle_ar,
                  bo.discount_percentage::float as discount_percentage,
                  (SELECT json_agg(json_build_object('id', pr.id, 'name', pr.name, 'name_ar', pr.name_ar, 'price', pr.price::float, 'image_url', pr.image_url))
                   FROM products pr 
                   WHERE pr.id::text IN (SELECT jsonb_array_elements_text(bo.product_ids))
                   AND pr.deleted_at IS NULL
                  ) as products
           FROM bundle_offers bo
           WHERE bo.deleted_at IS NULL AND bo.is_active=TRUE
           ORDER BY bo.created_at DESC LIMIT 10`,
        ).catch(() => ({ rows: [] })),
      ]);

      const promotions = promotionsResult.rows.map((p: any) => ({
        ...p,
        type: "promotion",
      }));

      const bundles = (bundlesResult as any).rows.map((b: any) => {
        const products = b.products || [];
        const discountPct = parseFloat(b.discount_percentage) || 0;
        const originalTotal = products.reduce(
          (sum: number, p: any) => sum + (parseFloat(p.price) || 0),
          0,
        );
        const discountedTotal = originalTotal * (1 - discountPct / 100);
        return {
          ...b,
          type: "bundle_offer",
          discount_percentage: discountPct,
          original_total: parseFloat(originalTotal.toFixed(2)),
          discounted_total: parseFloat(discountedTotal.toFixed(2)),
          product_count: products.length,
        };
      });

      // Interleave promotions and bundles
      const items = [...promotions, ...bundles].sort((a: any, b: any) => {
        // promotions come first by sort_order, bundles after
        if (a.type === "promotion" && b.type === "bundle_offer") return -1;
        if (a.type === "bundle_offer" && b.type === "promotion") return 1;
        return 0;
      });

      return res.json(items);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== COMMENTS ====================

  app.get("/api/comments/:productId", async (req: Request, res: Response) => {
    try {
      const currentUser = await getCurrentUser(req);
      const currentUserId = currentUser?.id || null;
      const currentUserRole = currentUser
        ? await getUserRole(currentUser.email)
        : null;
      const isOwnerOrAdmin =
        currentUserRole &&
        ["owner", "partner", "admin"].includes(currentUserRole);

      const [commentsResult, statsResult] = await Promise.all([
        query(
          `SELECT c.*, u.name as user_name, u.picture as user_picture
           FROM comments c JOIN users u ON c.user_id = u.id
           WHERE c.product_id=$1 AND c.deleted_at IS NULL
           ORDER BY c.created_at DESC`,
          [req.params.productId],
        ),
        query(
          `SELECT COUNT(*) as rating_count, AVG(rating)::float as avg_rating
           FROM comments
           WHERE product_id=$1 AND deleted_at IS NULL AND rating IS NOT NULL`,
          [req.params.productId],
        ),
      ]);
      const stats = statsResult.rows[0];
      const comments = commentsResult.rows.map((c: any) => ({
        ...c,
        is_owner: isOwnerOrAdmin
          ? true
          : currentUserId
            ? c.user_id === currentUserId
            : false,
      }));
      return res.json({
        comments,
        avg_rating: stats.avg_rating ? parseFloat(stats.avg_rating) : null,
        rating_count: parseInt(stats.rating_count) || 0,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/comments",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id, text, rating } = req.body;
        if (!product_id || !text)
          return res
            .status(400)
            .json({ detail: "product_id and text required" });

        const result = await query(
          "INSERT INTO comments (id,product_id,user_id,text,rating) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [genId(), product_id, userId, text, rating || null],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/comments/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const user = (req as any).user;
        const role = await getUserRole(user.email);

        if (["owner", "partner", "admin"].includes(role)) {
          await query("UPDATE comments SET deleted_at=NOW() WHERE id=$1", [
            req.params.id,
          ]);
        } else {
          await query(
            "UPDATE comments SET deleted_at=NOW() WHERE id=$1 AND user_id=$2",
            [req.params.id, userId],
          );
        }
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ANALYTICS ====================

  app.get(
    "/api/analytics/overview",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const [
          ordersResult,
          usersResult,
          productsResult,
          revenueResult,
          todayResult,
          monthResult,
        ] = await Promise.all([
          query(
            "SELECT COUNT(*) as count, status FROM orders WHERE deleted_at IS NULL GROUP BY status",
          ),
          query("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL"),
          query(
            "SELECT COUNT(*) as count FROM products WHERE deleted_at IS NULL",
          ),
          query(
            "SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE deleted_at IS NULL AND status != 'cancelled'",
          ),
          query(
            "SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count FROM orders WHERE deleted_at IS NULL AND status != 'cancelled' AND DATE(created_at) = CURRENT_DATE",
          ),
          query(
            "SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count FROM orders WHERE deleted_at IS NULL AND status != 'cancelled' AND created_at >= DATE_TRUNC('month', CURRENT_DATE)",
          ),
        ]);

        const ordersByStatus: Record<string, number> = {};
        ordersResult.rows.forEach((r: any) => {
          ordersByStatus[r.status] = parseInt(r.count);
        });

        return res.json({
          total_orders: Object.values(ordersByStatus).reduce(
            (a: number, b: number) => a + b,
            0,
          ),
          orders_by_status: ordersByStatus,
          total_users: parseInt(usersResult.rows[0].count),
          total_products: parseInt(productsResult.rows[0].count),
          total_revenue: parseFloat(revenueResult.rows[0].total),
          today_revenue: parseFloat(todayResult.rows[0].total),
          today_orders: parseInt(todayResult.rows[0].count),
          month_revenue: parseFloat(monthResult.rows[0].total),
          month_orders: parseInt(monthResult.rows[0].count),
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/analytics/sales",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
         FROM orders WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at) ORDER BY date`,
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== SYNC ====================

  app.post("/api/sync/pull", async (req: Request, res: Response) => {
    try {
      const { last_pulled_at, tables = [] } = req.body;
      const since = last_pulled_at ? new Date(last_pulled_at) : new Date(0);

      const syncData: Record<string, any> = {};
      const requestedTables =
        tables.length > 0
          ? tables
          : [
              "products",
              "categories",
              "car_brands",
              "car_models",
              "product_brands",
              "promotions",
              "bundle_offers",
            ];

      const tableQueries: Record<string, string> = {
        products: `SELECT p.*, pb.name as product_brand_name, c.name as category_name FROM products p LEFT JOIN product_brands pb ON p.product_brand_id = pb.id LEFT JOIN categories c ON p.category_id = c.id WHERE p.updated_at > $1`,
        categories: `SELECT * FROM categories WHERE updated_at > $1`,
        car_brands: `SELECT * FROM car_brands WHERE updated_at > $1`,
        car_models: `SELECT * FROM car_models WHERE updated_at > $1`,
        product_brands: `SELECT * FROM product_brands WHERE updated_at > $1`,
        promotions: `SELECT * FROM promotions WHERE updated_at > $1 AND deleted_at IS NULL AND is_active=TRUE`,
        bundle_offers: `SELECT * FROM bundle_offers WHERE updated_at > $1 AND deleted_at IS NULL AND is_active=TRUE`,
      };

      for (const table of requestedTables) {
        if (tableQueries[table]) {
          const result = await query(tableQueries[table], [since]);
          syncData[table] = result.rows;
        }
      }

      return res.json({
        timestamp: Date.now(),
        data: syncData,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== UPLOAD (Image) ====================

  app.post(
    "/api/upload",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        // Simple base64 storage or URL passthrough
        const { image_data, url } = req.body;

        if (url) {
          return res.json({ url, image_url: url });
        }

        if (image_data) {
          // Return as-is (store base64 in DB)
          return res.json({ url: image_data, image_url: image_data });
        }

        return res.status(400).json({ detail: "No image data provided" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION (TWILIO) ====================

  app.post(
    "/api/phone-verification/send",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { phone } = req.body;
        if (!phone)
          return res.status(400).json({ detail: "Phone number is required" });
        const cleanPhone = phone.replace(/\s+/g, "");
        if (!/^\+\d{10,15}$/.test(cleanPhone)) {
          return res.status(400).json({
            detail:
              "Invalid phone number format. Use international format: +201234567890",
          });
        }
        const result = await sendVerificationCode(cleanPhone);
        if (result.success) {
          return res.json({
            message: "Verification code sent",
            phone: cleanPhone,
          });
        }
        return res
          .status(500)
          .json({ detail: result.error || "Failed to send verification code" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/phone-verification/verify",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { phone, code } = req.body;
        if (!phone || !code)
          return res
            .status(400)
            .json({ detail: "Phone and code are required" });
        const result = verifyCode(phone, code);
        if (result.valid) {
          const userId = (req as any).user?.id;
          if (userId) {
            await query(
              "UPDATE users SET phone = $1, phone_verified = true WHERE id = $2",
              [phone, userId],
            );
          }
          return res.json({
            verified: true,
            message: "Phone verified successfully",
          });
        }
        return res
          .status(400)
          .json({ detail: result.error || "Invalid verification code" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== TRUECALLER PHONE VERIFICATION ====================
  // Flow: deep link → opens Truecaller app → user approves → Truecaller POSTs to our callback
  // Reference: https://developer.truecaller.com/

  const truecallerSessions: Record<
    string,
    {
      userId?: number;
      phone: string;
      verified: boolean;
      rejected?: boolean;
      flowInvoked?: boolean;
      error?: string;
      name?: string;
      email?: string;
      avatarUrl?: string;
      createdAt: number;
    }
  > = {};

  setInterval(() => {
    const now = Date.now();
    for (const k of Object.keys(truecallerSessions)) {
      if (now - truecallerSessions[k].createdAt > 10 * 60 * 1000)
        delete truecallerSessions[k];
    }
  }, 60000);

  // Step 1: Generate deep link that opens Truecaller app on mobile
  app.post(
    "/api/phone-verification/truecaller-init",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const appKey = process.env.TRUECALLER_APP_KEY;
        if (!appKey)
          return res.status(503).json({ detail: "Truecaller not configured" });

        const userId = (req as any).user?.id;
        // requestNonce must be 8–64 chars, used to correlate callback
        const requestNonce = `ghazaly_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

        truecallerSessions[requestNonce] = {
          userId,
          phone: "",
          verified: false,
          createdAt: Date.now(),
        };

        const domain =
          req.headers.host || process.env.REPL_SLUG || "localhost:5000";
        const protocol =
          domain.includes("replit.dev") || domain.includes("replit.app")
            ? "https"
            : "http";
        const privacyUrl = encodeURIComponent(
          `${protocol}://${domain}/privacy`,
        );
        const termsUrl = encodeURIComponent(`${protocol}://${domain}/terms`);
        const appName = encodeURIComponent("Al-Ghazaly Auto Parts");

        // Truecaller deep link — opens app's bottom sheet on mobile
        const deep_link =
          `truecallersdk://truesdk/web_verify?type=btmsheet` +
          `&requestNonce=${requestNonce}` +
          `&partnerKey=${appKey}` +
          `&partnerName=${appName}` +
          `&lang=ar` +
          `&privacyUrl=${privacyUrl}` +
          `&termsUrl=${termsUrl}`;

        return res.json({ deep_link, state: requestNonce });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Step 2: Poll for verification status (frontend polls every 3s, up to 5 cycles as per Truecaller docs)
  app.get(
    "/api/phone-verification/truecaller-status/:state",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const state = String(req.params.state);
        const session = truecallerSessions[state];
        if (!session)
          return res
            .status(404)
            .json({ detail: "Session not found or expired" });
        return res.json({
          verified: session.verified,
          rejected: session.rejected || false,
          flow_invoked: session.flowInvoked || false,
          phone: session.verified ? session.phone : undefined,
          name: session.verified ? session.name : undefined,
          error: session.error,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Step 3: Truecaller POSTs here — handles 3 callback types:
  //   A) Handshake:    { requestId, status: "flow_invoked" }
  //   B) User profile: { requestId, accessToken, endpoint }
  //   C) User rejected:{ requestId, status: "user_rejected" }
  app.post(
    "/api/auth/truecaller/callback",
    async (req: Request, res: Response) => {
      try {
        const { requestId, accessToken, endpoint, status } = req.body;
        console.log(
          "[Truecaller] Callback —",
          JSON.stringify({
            requestId,
            status,
            endpoint: endpoint?.slice(0, 50),
          }),
        );

        // Always acknowledge immediately with 200 (Truecaller requires 2XX)
        // A) Handshake: flow invoked — just acknowledge
        if (status === "flow_invoked") {
          console.log(
            "[Truecaller] Handshake received for requestId:",
            requestId,
          );
          const session = truecallerSessions[requestId];
          if (session) session.flowInvoked = true;
          return res.status(200).json({ status: "acknowledged" });
        }

        // C) User rejected
        if (status === "user_rejected") {
          console.log("[Truecaller] User rejected for requestId:", requestId);
          const session = truecallerSessions[requestId];
          if (session) session.rejected = true;
          return res.status(200).json({ status: "acknowledged" });
        }

        // B) Profile callback — fetch and process
        const session = truecallerSessions[requestId];
        if (!session) {
          console.error("[Truecaller] Unknown requestId:", requestId);
          return res.status(200).json({ status: "unknown_request" }); // Still 200 to acknowledge
        }

        if (!accessToken || !endpoint) {
          console.error("[Truecaller] Missing accessToken or endpoint");
          return res.status(200).json({ status: "missing_fields" });
        }

        // Fetch user profile from Truecaller's dynamic profile endpoint
        const profileRes = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Cache-Control": "no-cache",
          },
        });

        if (!profileRes.ok) {
          const errText = await profileRes.text();
          console.error(
            "[Truecaller] Profile fetch failed:",
            profileRes.status,
            errText,
          );
          session.error = `Profile fetch failed: ${profileRes.status}`;
          return res.status(200).json({ status: "profile_fetch_failed" });
        }

        const profile = (await profileRes.json()) as any;
        console.log("[Truecaller] Profile received:", JSON.stringify(profile));

        // phoneNumbers is an array per the docs: ["919999999999"]
        const rawPhone = Array.isArray(profile.phoneNumbers)
          ? profile.phoneNumbers[0]
          : profile.phoneNumber || profile.phone_number || "";

        // Ensure E.164 format (add + if missing)
        const verifiedPhone =
          rawPhone && !rawPhone.startsWith("+") ? `+${rawPhone}` : rawPhone;

        session.verified = true;
        session.phone = verifiedPhone;
        session.name =
          [profile.name?.first, profile.name?.last].filter(Boolean).join(" ") ||
          "";
        session.email = profile.onlineIdentities?.email || "";
        session.avatarUrl = profile.avatarUrl || "";

        // Persist to database
        if (session.userId) {
          const updates: string[] = [];
          const values: any[] = [];
          let idx = 1;
          if (verifiedPhone) {
            updates.push(`phone = $${idx++}`);
            values.push(verifiedPhone);
          }
          updates.push(`phone_verified = $${idx++}`);
          values.push(true);
          if (session.name) {
            updates.push(`name = $${idx++}`);
            values.push(session.name);
          }
          if (session.avatarUrl) {
            updates.push(`avatar_url = $${idx++}`);
            values.push(session.avatarUrl);
          }
          values.push(session.userId);
          await query(
            `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}`,
            values,
          );
          console.log(
            "[Truecaller] DB updated for userId:",
            session.userId,
            "phone:",
            verifiedPhone,
          );
        }

        return res.status(200).json({ success: true });
      } catch (err: any) {
        console.error("[Truecaller] Callback error:", err);
        // Always return 200 to avoid Truecaller retrying
        return res.status(200).json({ error: err.message });
      }
    },
  );

  // ==================== SUBSCRIPTION STATUS ====================

  app.get("/api/subscription-status", async (req: Request, res: Response) => {
    try {
      const { email, phone } = req.query;
      if (!email && !phone) {
        return res.json({
          is_subscriber: false,
          has_pending: false,
          status: "free",
        });
      }

      // Check subscribers table first
      let subResult;
      if (email) {
        subResult = await query(
          "SELECT id, subscription_type FROM subscribers WHERE email = $1 AND deleted_at IS NULL",
          [email],
        );
      } else {
        subResult = await query(
          "SELECT id, subscription_type FROM subscribers WHERE phone = $1 AND deleted_at IS NULL",
          [phone],
        );
      }

      if (subResult.rows.length > 0) {
        const sub = subResult.rows[0];
        return res.json({
          is_subscriber: true,
          has_pending: false,
          status: "subscriber",
          subscription_type: sub.subscription_type,
        });
      }

      // Check subscription_requests table for pending
      let reqResult;
      if (email) {
        reqResult = await query(
          "SELECT id, status FROM subscription_requests WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
          [email],
        );
      } else {
        reqResult = await query(
          "SELECT id, status FROM subscription_requests WHERE phone = $1 ORDER BY created_at DESC LIMIT 1",
          [phone],
        );
      }

      if (reqResult && reqResult.rows.length > 0) {
        const req_ = reqResult.rows[0];
        if (req_.status === "approved") {
          return res.json({
            is_subscriber: true,
            has_pending: false,
            status: "approved",
          });
        } else if (req_.status === "pending") {
          return res.json({
            is_subscriber: false,
            has_pending: true,
            status: "pending",
          });
        }
      }

      return res.json({
        is_subscriber: false,
        has_pending: false,
        status: "free",
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== CUSTOMERS (ADMIN/OWNER) ====================

  app.post(
    "/api/customers/admin/create",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { email, password, name, phone } = req.body;
        if (!email || !password || !name) {
          return res
            .status(400)
            .json({ detail: "Email, password and name are required" });
        }
        const existing = await query("SELECT id FROM users WHERE email = $1", [
          email.toLowerCase(),
        ]);
        if (existing.rows.length > 0) {
          return res.status(400).json({ detail: "Email already registered" });
        }
        const passwordHash = await hashPassword(password);
        const userId = genId();
        await query(
          "INSERT INTO users (id, email, name, password_hash, phone, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
          [
            userId,
            email.toLowerCase(),
            name,
            passwordHash,
            phone || null,
          ],
        );
        const userResult = await query("SELECT * FROM users WHERE id = $1", [
          userId,
        ]);
        const user = userResult.rows[0];
        const userSerialized = await serializeUser(user);
        userSerialized.role = "customer";
        return res.json({ user: userSerialized });
      } catch (err: any) {
        console.error("Admin create customer error:", err);
        return res.status(500).json({ detail: "Failed to create customer" });
      }
    },
  );

  app.get(
    "/api/customers",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT u.id, u.email, u.name, u.picture, u.phone, u.phone_verified, u.pending_phone,
         u.subscription_status, u.created_at, u.replit_user_id, u.owner_temp_password,
         (u.password_hash IS NOT NULL) as has_password,
         (u.replit_user_id IS NOT NULL) as is_replit_user,
         (EXISTS(SELECT 1 FROM owners o2 WHERE LOWER(o2.email) = LOWER(u.email) AND o2.deleted_at IS NULL)) as is_owner,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL)::int as orders_count,
         (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as total_spent,
         (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) as favorites_count,
         (SELECT COUNT(*) FROM cart_items ci WHERE ci.user_id = u.id) as cart_count,
         (SELECT pr.id FROM password_requests pr WHERE pr.user_id = u.id::text AND pr.status = 'pending' ORDER BY pr.created_at DESC LIMIT 1) as password_request_id
         FROM users u
         WHERE u.deleted_at IS NULL
         ORDER BY u.created_at DESC`,
        );
        return res.json({ customers: result.rows, total: result.rows.length });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== FORGOT PASSWORD REQUEST ====================
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { identifier } = req.body;
      if (!identifier)
        return res.status(400).json({ detail: "Email or phone required" });
      const isEmail = identifier.includes("@");
      let userResult;
      if (isEmail) {
        userResult = await query(
          "SELECT id, email, phone, phone_verified FROM users WHERE email = $1 AND deleted_at IS NULL",
          [identifier.toLowerCase()],
        );
      } else {
        userResult = await query(
          "SELECT id, email, phone, phone_verified FROM users WHERE phone = $1 AND deleted_at IS NULL",
          [identifier],
        );
      }
      if (userResult.rows.length === 0) {
        return res
          .status(404)
          .json({ detail: "No account found with this email or phone" });
      }
      const user = userResult.rows[0];
      const reqId = `pr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await query(
        "INSERT INTO password_requests (id, user_id, email, phone, status) VALUES ($1, $2, $3, $4, 'pending')",
        [reqId, user.id, user.email, user.phone || identifier],
      );
      return res.json({ success: true, message: "Password request submitted" });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== ADMIN: DISMISS PASSWORD REQUEST ====================
  app.delete(
    "/api/admin/password-requests/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query(
          "UPDATE password_requests SET status = 'dismissed' WHERE id = $1",
          [req.params.id],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ADMIN: SET USER PASSWORD ====================
  app.post(
    "/api/admin/set-user-password",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId, password } = req.body;
        if (!userId || !password)
          return res
            .status(400)
            .json({ detail: "userId and password required" });
        if (password.length < 6)
          return res
            .status(400)
            .json({ detail: "Password must be at least 6 characters" });
        const newHash = await hashPassword(password);
        await query(
          "UPDATE users SET password_hash = $1, owner_temp_password = NULL, updated_at = NOW() WHERE id = $2",
          [newHash, userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ADMIN: NOTIFY USER ====================
  app.post(
    "/api/admin/notify-user",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId, title, title_ar, message, message_ar, metadata } =
          req.body;
        if (!userId || !title || !message)
          return res
            .status(400)
            .json({ detail: "userId, title, and message required" });
        const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await query(
          "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
          [
            notifId,
            userId,
            title,
            title_ar || title,
            message,
            message_ar || message,
            JSON.stringify(metadata || {}),
          ],
        );
        broadcastToUser(userId, {
          type: "notification",
          data: {
            id: notifId,
            title,
            title_ar: title_ar || title,
            message,
            message_ar: message_ar || message,
            type: "info",
          },
        });
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION: SUBMIT WHATSAPP ====================
  app.post(
    "/api/phone-verification/submit-whatsapp",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { phone } = req.body;
        if (!phone)
          return res.status(400).json({ detail: "Phone number required" });
        const userId = (req as any).user?.id;
        await query(
          "UPDATE users SET pending_phone = $1, updated_at = NOW() WHERE id = $2",
          [phone, userId],
        );
        return res.json({
          success: true,
          whatsapp_number: "+0201011033571",
          message: "قم بالتحقق من رقم الموبيل",
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION: OWNER CONFIRM ====================
  app.post(
    "/api/phone-verification/owner-confirm",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ detail: "userId required" });
        const userRes = await query(
          "SELECT pending_phone FROM users WHERE id = $1",
          [userId],
        );
        if (!userRes.rows[0]?.pending_phone)
          return res.status(400).json({ detail: "No pending phone" });
        await query(
          "UPDATE users SET phone = pending_phone, phone_verified = true, pending_phone = NULL, updated_at = NOW() WHERE id = $1",
          [userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION: OWNER REJECT ====================
  app.post(
    "/api/phone-verification/owner-reject",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ detail: "userId required" });
        await query(
          "UPDATE users SET pending_phone = NULL, updated_at = NOW() WHERE id = $1",
          [userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/customers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const custId = String(req.params.id);
        const isValidUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            custId,
          );
        if (!isValidUUID)
          return res.status(400).json({ detail: "Invalid customer ID" });
        const result = await query(
          `SELECT u.id, u.email, u.name, u.picture, u.phone, u.phone_verified, u.subscription_status, u.created_at,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as orders_count,
         (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as total_spent
         FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Customer not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Get customer favorites
  app.get(
    "/api/customers/admin/customer/:userId/favorites",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.params;
        const result = await query(
          `SELECT f.*, p.name, p.name_ar, p.price::float as price, p.images, p.sku, p.image_url
         FROM favorites f
         JOIN products p ON p.id = f.product_id
         WHERE f.user_id = $1 AND p.deleted_at IS NULL
         ORDER BY f.created_at DESC`,
          [userId],
        );
        return res.json({ favorites: result.rows });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Get customer cart
  app.get(
    "/api/customers/admin/customer/:userId/cart",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.params;
        const result = await query(
          `SELECT ci.*, p.name, p.name_ar, p.price::float as price, p.images, p.sku, p.image_url
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         WHERE ci.user_id = $1 AND p.deleted_at IS NULL
         ORDER BY ci.created_at DESC`,
          [userId],
        );
        return res.json({ cart: result.rows });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Get customer orders
  app.get(
    "/api/customers/admin/customer/:userId/orders",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.params;
        const result = await query(
          `SELECT o.id, o.order_number, o.status, o.total_amount::float as total_amount, 
                o.shipping_cost::float as shipping_cost, o.discount_amount::float as discount_amount,
                o.payment_method, o.notes, o.created_at, o.updated_at, o.admin_viewed,
                o.first_name, o.last_name, o.email, o.phone,
                o.street_address, o.city, o.state, o.country,
                o.items
         FROM orders o
         WHERE o.user_id = $1 AND o.deleted_at IS NULL
         ORDER BY o.created_at DESC`,
          [userId],
        );
        return res.json({
          orders: result.rows.map((o: any) => ({ ...o, items: o.items || [] })),
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Mark customer orders as viewed
  app.patch(
    "/api/customers/admin/customer/:userId/orders/mark-viewed",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.params;
        await query(
          `UPDATE orders SET admin_viewed = true WHERE user_id = $1 AND admin_viewed = false`,
          [userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== VERSION & HEALTH ====================

  app.get("/api/version", (req: Request, res: Response) => {
    return res.json({
      api_version: "4.2.0",
      build_date: new Date().toISOString().split("T")[0],
      min_frontend_version: "1.0.0",
      features: [
        "auth",
        "products",
        "cart",
        "orders",
        "admin",
        "analytics",
        "sync",
      ],
    });
  });

  // Root route — required for Replit port detection
  app.get("/", (_req: Request, res: Response) => {
    res.json({ service: "Al-GhazalyParts API", status: "ok" });
  });

  app.get("/api/health", async (req: Request, res: Response) => {
    try {
      await query("SELECT 1");
      return res.json({
        status: "healthy",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      return res
        .status(500)
        .json({ status: "unhealthy", database: "disconnected" });
    }
  });

  // Alias for production health check path
  app.get("/api/healthz", async (_req: Request, res: Response) => {
    try {
      await query("SELECT 1");
      return res.json({ status: "ok" });
    } catch {
      return res.status(500).json({ status: "error" });
    }
  });

  // ==================== COLLECTIONS ====================

  app.get("/api/collections", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT * FROM car_brands WHERE deleted_at IS NULL ORDER BY name`,
      );
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== DELTA SYNC ====================

  // Helper: parse since timestamp from query param
  function parseSinceDate(since: any): Date {
    if (!since) return new Date(0);
    const ts = Number(since);
    return isNaN(ts) ? new Date(since as string) : new Date(ts);
  }

  // Legacy endpoint - kept for backward compat
  app.get("/api/delta-sync", async (req: Request, res: Response) => {
    try {
      const sinceDate = parseSinceDate(req.query.since);
      const serverTime = new Date().toISOString();

      const [products, categories] = await Promise.all([
        query("SELECT * FROM products WHERE updated_at > $1 AND deleted_at IS NULL ORDER BY updated_at DESC", [sinceDate]),
        query("SELECT * FROM categories WHERE updated_at > $1 AND deleted_at IS NULL ORDER BY updated_at DESC", [sinceDate]),
      ]);

      return res.json({
        products: products.rows,
        categories: categories.rows,
        server_time: serverTime,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // Delta sync — products only (used by useDeltaSync.ts)
  app.get("/api/delta-sync/products", async (req: Request, res: Response) => {
    try {
      const sinceDate = parseSinceDate(req.query.last_sync);
      const serverTime = new Date().toISOString();
      const isDelta = req.query.last_sync !== undefined;

      const [newRows, deletedRows] = await Promise.all([
        query(
          "SELECT * FROM products WHERE updated_at > $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200",
          [sinceDate]
        ),
        query(
          "SELECT id FROM products WHERE deleted_at > $1",
          [sinceDate]
        ),
      ]);

      return res.json({
        products: newRows.rows,
        deleted_ids: deletedRows.rows.map((r: any) => r.id),
        server_time: serverTime,
        is_delta: isDelta,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // Delta sync — multiple tables (used by useFullDeltaSync)
  app.get("/api/delta-sync/full", async (req: Request, res: Response) => {
    try {
      const sinceDate = parseSinceDate(req.query.last_sync);
      const serverTime = new Date().toISOString();
      const isDelta = req.query.last_sync !== undefined;
      const requestedTables = ((req.query.tables as string) || 'products,categories,car_brands,car_models,product_brands').split(',').map(t => t.trim());

      const ALLOWED_TABLES: Record<string, string> = {
        products: 'products',
        categories: 'categories',
        car_brands: 'car_brands',
        car_models: 'car_models',
        product_brands: 'product_brands',
      };

      const tableQueries = requestedTables
        .filter(t => ALLOWED_TABLES[t])
        .map(t => ALLOWED_TABLES[t]);

      const results = await Promise.all(
        tableQueries.map(async (table) => {
          const [newRows, deletedRows] = await Promise.all([
            query(`SELECT * FROM ${table} WHERE updated_at > $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`, [sinceDate]),
            query(`SELECT id FROM ${table} WHERE deleted_at > $1`, [sinceDate]),
          ]);
          return { table, items: newRows.rows, deleted_ids: deletedRows.rows.map((r: any) => r.id) };
        })
      );

      const data: Record<string, any> = {};
      results.forEach(({ table, items, deleted_ids }) => {
        data[table] = { items, deleted_ids };
      });

      return res.json({
        data,
        server_time: serverTime,
        is_delta: isDelta,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  const httpServer = createServer(app);

  // ==================== CHAT & AI AGENT ROUTES ====================
  app.use("/api", createChatRouter(broadcastToUser));
  app.use("/api", createKnowledgeBaseRouter());
  app.use("/api/appointments", createAppointmentsRouter());
  app.use("/api", createAiRouter());

  // ==================== OBJECT STORAGE SERVING ====================
  // Use app.use to capture nested paths like /api/storage/objects/uploads/<uuid>
  app.use(
    "/api/storage/objects",
    requireAuth as any,
    async (req: Request, res: Response, next: any) => {
      if (req.method !== "GET") return next();
      try {
        // req.path will be e.g. /uploads/<uuid>
        const objectPath = `/objects${req.path}`;
        const user = (req as any).user;
        const storage = new ObjectStorageService();
        const objectFile = await storage.getObjectEntityFile(objectPath);

        // Enforce ACL: check if the authenticated user can access this object.
        // Admin and owner roles can access any private object (for KB management).
        // For all others, use canAccessObject which checks ownership and visibility.
        const userRole = user?.email ? await getUserRole(user.email) : null;
        const isPrivileged = userRole === "admin" || userRole === "owner";
        const hasAccess = isPrivileged || (await canAccessObject({
          userId: user?.id,
          objectFile,
          requestedPermission: ObjectPermission.READ,
        }));
        if (!hasAccess) {
          return res.status(403).json({ detail: "Access denied" });
        }

        const response = await storage.downloadObject(objectFile);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.status(response.status);
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      } catch (err: any) {
        if (err instanceof ObjectNotFoundError) {
          return res.status(404).json({ detail: "File not found" });
        }
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==========================================
  // WebSocket Server (Real-time Notifications)
  // ==========================================
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, userId?: string) => {
    if (userId) {
      if (!wsClients.has(userId)) wsClients.set(userId, new Set());
      wsClients.get(userId)!.add(ws);
      console.log(
        `[WS] Client connected: user=${userId}, total=${wsClients.get(userId)!.size}`,
      );
    } else {
      wsAnonClients.add(ws);
      console.log(
        `[WS] Anonymous client connected, total=${wsAnonClients.size}`,
      );
    }

    ws.send(
      JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }),
    );

    ws.on("message", (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === "ping") {
          ws.send(
            JSON.stringify({
              type: "pong",
              timestamp: new Date().toISOString(),
            }),
          );
        }
        // Note: userId is bound from session cookie at connect time (not from client messages)
      } catch {}
    });

    ws.on("close", () => {
      if (userId) {
        const userSet = wsClients.get(userId);
        if (userSet) {
          userSet.delete(ws);
          if (userSet.size === 0) wsClients.delete(userId);
        }
      } else {
        wsAnonClients.delete(ws);
      }
      console.log(`[WS] Client disconnected`);
    });

    ws.on("error", (err) => {
      console.error("[WS] Socket error:", err.message);
    });
  });

  // ── Excel Export → Google Drive ──────────────────────────────────────────
  app.post(
    "/api/orders/export-excel",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { orders, startDate, endDate, statusFilter, language } = req.body;

        if (!Array.isArray(orders)) {
          return res.status(400).json({ error: "orders must be an array" });
        }

        const url = await generateAndUploadExcel(orders, {
          startDate,
          endDate,
          statusFilter,
          language: language || "ar",
        });

        return res.json({ url });
      } catch (err: any) {
        console.error("[ExcelExport] Error:", err.message);
        return res.status(500).json({ error: err.message || "Export failed" });
      }
    },
  );

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "", `http://localhost`);
    if (url.pathname === "/api/ws") {
      // Authenticate the WS connection by validating the session token server-side.
      // Clients (React Native) pass the token as ?token= since WebSocket doesn't support custom headers.
      // We also check the session_token cookie for web clients.
      let authenticatedUserId: string | undefined;
      try {
        // Token from query param (React Native mobile) or Authorization header or session cookie
        const queryToken = url.searchParams.get("token");
        const cookieHeader = req.headers.cookie || "";
        const cookies: Record<string, string> = {};
        cookieHeader.split(";").forEach((c) => {
          const [k, ...v] = c.trim().split("=");
          if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
        });
        const cookieToken = cookies["session_token"];
        const sessionToken = queryToken || cookieToken;
        if (sessionToken) {
          const sessionResult = await query(
            `SELECT s.user_id FROM sessions s
             WHERE s.session_token = $1 AND s.expires_at > NOW()
             LIMIT 1`,
            [sessionToken],
          );
          if (sessionResult.rows.length > 0) {
            authenticatedUserId = sessionResult.rows[0].user_id;
          }
        }
      } catch {}
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, authenticatedUserId);
      });
    } else {
      socket.destroy();
    }
  });

  return httpServer;
}
