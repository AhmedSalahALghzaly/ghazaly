import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { query } from "./server-db";

export function generateSessionToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function serializeUser(user: any): Promise<any> {
  const serialized = {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    is_admin: user.is_admin,
    phone: user.phone || null,
    phone_verified: user.phone_verified || false,
    subscription_status: user.subscription_status || 'free',
    created_at: user.created_at,
  };
  return serialized;
}

export async function getUserRole(email: string): Promise<string> {
  if (!email) return "guest";

  const owner = await query("SELECT id FROM owners WHERE email = $1 AND deleted_at IS NULL", [email.toLowerCase()]);
  if (owner.rows.length > 0) return "owner";

  const partner = await query("SELECT id FROM partners WHERE email = $1 AND deleted_at IS NULL", [email]);
  if (partner.rows.length > 0) return "partner";
  
  const admin = await query("SELECT id FROM admins WHERE email = $1 AND deleted_at IS NULL", [email]);
  if (admin.rows.length > 0) return "admin";
  
  const subscriber = await query("SELECT id FROM subscribers WHERE email = $1 AND deleted_at IS NULL", [email]);
  if (subscriber.rows.length > 0) return "subscriber";

  const supplier = await query("SELECT id FROM suppliers WHERE email = $1 AND deleted_at IS NULL", [email]);
  if (supplier.rows.length > 0) return "supplier";

  const distributor = await query("SELECT id FROM distributors WHERE email = $1 AND deleted_at IS NULL", [email]);
  if (distributor.rows.length > 0) return "distributor";
  
  return "user";
}

export async function getCurrentUser(req: Request): Promise<any | null> {
  const token = req.cookies?.session_token || 
    req.headers?.authorization?.replace("Bearer ", "");
  
  if (!token) return null;
  
  try {
    const sessionResult = await query(
      "SELECT * FROM sessions WHERE session_token = $1 AND expires_at > NOW()",
      [token]
    );
    
    if (sessionResult.rows.length === 0) return null;
    const session = sessionResult.rows[0];
    
    const userResult = await query(
      "SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL",
      [session.user_id]
    );
    
    if (userResult.rows.length === 0) return null;
    return userResult.rows[0];
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ detail: "Not authenticated" });
    return;
  }
  (req as any).user = user;
  next();
}

export function requireAdminRole(allowedRoles = ["owner", "partner", "admin"]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ detail: "Not authenticated" });
      return;
    }
    const role = await getUserRole(user.email);
    if (!allowedRoles.includes(role)) {
      res.status(403).json({ detail: "Access denied" });
      return;
    }
    (req as any).user = user;
    (req as any).userRole = role;
    next();
  };
}
