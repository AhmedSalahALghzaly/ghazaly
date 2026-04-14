import { Router, Request, Response } from "express";
import { query } from "../server-db";
import { requireAuth, getCurrentUser } from "../server-auth";
import { randomUUID } from "node:crypto";
import { createCalendarEvent } from "../lib/googleCalendar";

export function createAppointmentsRouter(): Router {
  const router = Router();

  // Ensure table exists
  query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      user_name VARCHAR(255),
      user_email VARCHAR(255),
      user_phone VARCHAR(50),
      service_type VARCHAR(100) NOT NULL DEFAULT 'maintenance',
      car_info VARCHAR(255),
      notes TEXT,
      appointment_date TIMESTAMPTZ NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      calendar_event_id VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // GET /api/appointments — list appointments
  router.get("/", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });

      const isPrivileged = user.role === "admin" || user.role === "owner";

      let rows;
      if (isPrivileged) {
        rows = await query(
          "SELECT * FROM appointments ORDER BY appointment_date ASC",
        );
      } else {
        rows = await query(
          "SELECT * FROM appointments WHERE user_id=$1 ORDER BY appointment_date ASC",
          [user.id],
        );
      }
      return res.json({ appointments: rows.rows });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // POST /api/appointments — create appointment
  router.post("/", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });

      const {
        service_type = "maintenance",
        car_info,
        notes,
        appointment_date,
        duration_minutes = 60,
        user_name,
        user_phone,
      } = req.body;

      if (!appointment_date) {
        return res.status(400).json({ detail: "appointment_date is required" });
      }

      const id = randomUUID();
      const startTime = new Date(appointment_date).toISOString();
      const endTime = new Date(
        new Date(appointment_date).getTime() + duration_minutes * 60000,
      ).toISOString();

      let calendarEventId: string | null = null;
      try {
        const calEvent = await createCalendarEvent({
          title: `${service_type === "installation" ? "تركيب قطع" : "صيانة"} — ${user_name || user.name || user.email}`,
          description: `${car_info ? `السيارة: ${car_info}\n` : ""}${notes ? `ملاحظات: ${notes}` : ""}`,
          startTime,
          endTime,
          attendeeEmail: user.email ?? undefined,
          location: "ورشة غزالي للقطع",
        });
        calendarEventId = calEvent.id ?? null;
      } catch (_err) {
        // Google Calendar optional — continue without it
      }

      const result = await query(
        `INSERT INTO appointments
          (id, user_id, user_name, user_email, user_phone, service_type, car_info, notes,
           appointment_date, duration_minutes, status, calendar_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11) RETURNING *`,
        [
          id,
          user.id,
          user_name || user.name || "",
          user.email || "",
          user_phone || "",
          service_type,
          car_info || "",
          notes || "",
          appointment_date,
          duration_minutes,
          calendarEventId,
        ],
      );

      return res.json({ appointment: result.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // GET /api/appointments/slots — all booked slots (for availability check by any authenticated user)
  router.get("/slots", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });
      const rows = await query(
        "SELECT appointment_date FROM appointments WHERE status != 'cancelled' ORDER BY appointment_date ASC",
      );
      return res.json({ slots: rows.rows.map((r: any) => r.appointment_date) });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // DELETE /api/appointments/:id — delete appointment (admin/owner OR own appointment)
  router.delete(
    "/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        const isPrivileged = user.role === "admin" || user.role === "owner";
        const existing = await query(
          "SELECT * FROM appointments WHERE id=$1",
          [req.params.id],
        );
        if (!existing.rows.length)
          return res.status(404).json({ detail: "Appointment not found" });
        if (!isPrivileged && existing.rows[0].user_id !== user.id)
          return res.status(403).json({ detail: "Forbidden" });
        await query("DELETE FROM appointments WHERE id=$1", [req.params.id]);
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PATCH /api/appointments/:id/status — update status (admin/owner)
  router.patch(
    "/:id/status",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        if (user.role !== "admin" && user.role !== "owner") {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const { status } = req.body;
        const result = await query(
          "UPDATE appointments SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
          [status, req.params.id],
        );
        return res.json({ appointment: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  return router;
}
