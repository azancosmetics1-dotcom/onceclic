import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SalonServiceRecord {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  price: number;
  durationMinutes: number;
  category?: string;
  isActive: boolean;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalonStaffRecord {
  id: string;
  organizationId: string;
  name: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableSlot {
  startTime: string;
  endTime: string;
  available: boolean;
}

// ─── SalonService ─────────────────────────────────────────────────────────────

export class SalonService {
  // ── Helpers ──────────────────────────────────────────────────────────────

  private static formatService(row: any): SalonServiceRecord {
    return {
      id: row.id,
      organizationId: row.organization_id ?? row.organizationId,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      durationMinutes: row.duration_minutes ?? row.durationMinutes,
      category: row.category,
      isActive: row.is_active ?? row.isActive,
      instructions: row.instructions,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at ?? row.createdAt),
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at ?? row.updatedAt),
    };
  }

  private static formatStaff(row: any): SalonStaffRecord {
    let workingDays: number[] = [];
    const wd = row.working_days ?? row.workingDays;
    if (Array.isArray(wd)) {
      workingDays = wd.map(Number);
    } else if (typeof wd === 'string') {
      try {
        workingDays = JSON.parse(wd).map(Number);
      } catch {
        workingDays = [];
      }
    }

    return {
      id: row.id,
      organizationId: row.organization_id ?? row.organizationId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      isActive: row.is_active ?? row.isActive,
      workingDays,
      workingHoursStart: row.working_hours_start ?? row.workingHoursStart,
      workingHoursEnd: row.working_hours_end ?? row.workingHoursEnd,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at ?? row.createdAt),
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at ?? row.updatedAt),
    };
  }

  // ── Services ──────────────────────────────────────────────────────────────

  static async createService(
    orgId: string,
    params: {
      name: string;
      description?: string;
      price?: number;
      durationMinutes?: number;
      category?: string;
      isActive?: boolean;
      instructions?: string;
    }
  ): Promise<SalonServiceRecord> {
    const id = uuidv4();
    const row = await db.getOne(
      `INSERT INTO salon_services
         (id, organization_id, name, description, price, duration_minutes, category, is_active, instructions, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        orgId,
        params.name,
        params.description ?? null,
        params.price ?? 0,
        params.durationMinutes ?? 30,
        params.category ?? null,
        params.isActive !== undefined ? params.isActive : true,
        params.instructions ?? null,
      ]
    );
    return this.formatService(row!);
  }

  static async listServices(orgId: string): Promise<SalonServiceRecord[]> {
    const result = await db.query(
      `SELECT * FROM salon_services WHERE organization_id = $1 ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows.map((r) => this.formatService(r));
  }

  static async getService(orgId: string, id: string): Promise<SalonServiceRecord | null> {
    const row = await db.getOne(
      `SELECT * FROM salon_services WHERE organization_id = $1 AND id = $2`,
      [orgId, id]
    );
    return row ? this.formatService(row) : null;
  }

  static async updateService(
    orgId: string,
    id: string,
    params: {
      name?: string;
      description?: string;
      price?: number;
      durationMinutes?: number;
      category?: string;
      isActive?: boolean;
      instructions?: string;
    }
  ): Promise<SalonServiceRecord> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (params.name !== undefined) { sets.push(`name = $${idx++}`); values.push(params.name); }
    if (params.description !== undefined) { sets.push(`description = $${idx++}`); values.push(params.description); }
    if (params.price !== undefined) { sets.push(`price = $${idx++}`); values.push(params.price); }
    if (params.durationMinutes !== undefined) { sets.push(`duration_minutes = $${idx++}`); values.push(params.durationMinutes); }
    if (params.category !== undefined) { sets.push(`category = $${idx++}`); values.push(params.category); }
    if (params.isActive !== undefined) { sets.push(`is_active = $${idx++}`); values.push(params.isActive); }
    if (params.instructions !== undefined) { sets.push(`instructions = $${idx++}`); values.push(params.instructions); }

    if (sets.length === 0) {
      const existing = await this.getService(orgId, id);
      if (!existing) throw new Error('Salon service not found.');
      return existing;
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(orgId, id);

    const row = await db.getOne(
      `UPDATE salon_services SET ${sets.join(', ')} WHERE organization_id = $${idx++} AND id = $${idx++} RETURNING *`,
      values
    );

    if (!row) throw new Error('Salon service not found.');
    return this.formatService(row);
  }

  static async deleteService(orgId: string, id: string): Promise<void> {
    // Soft-delete: deactivate
    const count = await db.execute(
      `UPDATE salon_services SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $1 AND id = $2`,
      [orgId, id]
    );
    if (count === 0) throw new Error('Salon service not found.');
  }

  static async deleteStaff(orgId: string, id: string): Promise<void> {
    // Soft-delete: deactivate
    const count = await db.execute(
      `UPDATE salon_staff SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $1 AND id = $2`,
      [orgId, id]
    );
    if (count === 0) throw new Error('Staff member not found.');
  }

  // ── Staff ─────────────────────────────────────────────────────────────────

  static async createStaff(
    orgId: string,
    params: {
      name: string;
      phone?: string;
      email?: string;
      isActive?: boolean;
      workingDays?: number[];
      workingHoursStart?: string;
      workingHoursEnd?: string;
    }
  ): Promise<SalonStaffRecord> {
    const id = uuidv4();
    const row = await db.getOne(
      `INSERT INTO salon_staff
         (id, organization_id, name, phone, email, is_active, working_days, working_hours_start, working_hours_end, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        orgId,
        params.name,
        params.phone ?? null,
        params.email ?? null,
        params.isActive !== undefined ? params.isActive : true,
        JSON.stringify(params.workingDays ?? [1, 2, 3, 4, 5, 6]),
        params.workingHoursStart ?? '09:00',
        params.workingHoursEnd ?? '18:00',
      ]
    );
    return this.formatStaff(row!);
  }

  static async listStaff(orgId: string): Promise<SalonStaffRecord[]> {
    const result = await db.query(
      `SELECT * FROM salon_staff WHERE organization_id = $1 ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows.map((r) => this.formatStaff(r));
  }

  static async getStaff(orgId: string, id: string): Promise<SalonStaffRecord | null> {
    const row = await db.getOne(
      `SELECT * FROM salon_staff WHERE organization_id = $1 AND id = $2`,
      [orgId, id]
    );
    return row ? this.formatStaff(row) : null;
  }

  static async updateStaff(
    orgId: string,
    id: string,
    params: {
      name?: string;
      phone?: string;
      email?: string;
      isActive?: boolean;
      workingDays?: number[];
      workingHoursStart?: string;
      workingHoursEnd?: string;
    }
  ): Promise<SalonStaffRecord> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (params.name !== undefined) { sets.push(`name = $${idx++}`); values.push(params.name); }
    if (params.phone !== undefined) { sets.push(`phone = $${idx++}`); values.push(params.phone); }
    if (params.email !== undefined) { sets.push(`email = $${idx++}`); values.push(params.email); }
    if (params.isActive !== undefined) { sets.push(`is_active = $${idx++}`); values.push(params.isActive); }
    if (params.workingDays !== undefined) { sets.push(`working_days = $${idx++}`); values.push(JSON.stringify(params.workingDays)); }
    if (params.workingHoursStart !== undefined) { sets.push(`working_hours_start = $${idx++}`); values.push(params.workingHoursStart); }
    if (params.workingHoursEnd !== undefined) { sets.push(`working_hours_end = $${idx++}`); values.push(params.workingHoursEnd); }

    if (sets.length === 0) {
      const existing = await this.getStaff(orgId, id);
      if (!existing) throw new Error('Staff member not found.');
      return existing;
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(orgId, id);

    const row = await db.getOne(
      `UPDATE salon_staff SET ${sets.join(', ')} WHERE organization_id = $${idx++} AND id = $${idx++} RETURNING *`,
      values
    );

    if (!row) throw new Error('Staff member not found.');
    return this.formatStaff(row);
  }

  // ── Staff-Service Qualifications ──────────────────────────────────────────

  static async assignServiceToStaff(orgId: string, staffId: string, serviceId: string): Promise<void> {
    // Verify both belong to org
    const staff = await this.getStaff(orgId, staffId);
    if (!staff) throw new Error('Staff member not found.');
    const service = await this.getService(orgId, serviceId);
    if (!service) throw new Error('Salon service not found.');

    await db.execute(
      `INSERT INTO salon_staff_services (staff_id, service_id, organization_id, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (staff_id, service_id) DO NOTHING`,
      [staffId, serviceId, orgId]
    );
  }

  static async removeServiceFromStaff(orgId: string, staffId: string, serviceId: string): Promise<void> {
    const count = await db.execute(
      `DELETE FROM salon_staff_services
       WHERE organization_id = $1 AND staff_id = $2 AND service_id = $3`,
      [orgId, staffId, serviceId]
    );
    if (count === 0) throw new Error('Staff-service assignment not found.');
  }

  static async getStaffServices(orgId: string, staffId: string): Promise<SalonServiceRecord[]> {
    const result = await db.query(
      `SELECT ss.*
       FROM salon_services ss
       INNER JOIN salon_staff_services sss ON sss.service_id = ss.id
       WHERE sss.organization_id = $1 AND sss.staff_id = $2
       ORDER BY ss.name ASC`,
      [orgId, staffId]
    );
    return result.rows.map((r) => this.formatService(r));
  }

  // ── Staff Availability ────────────────────────────────────────────────────

  static async getStaffAvailability(
    orgId: string,
    staffId: string,
    dateStr: string,
    durationMinutes: number = 30
  ): Promise<AvailableSlot[]> {
    const staff = await this.getStaff(orgId, staffId);
    if (!staff || !staff.isActive) return [];

    // Parse date
    const targetDate = new Date(`${dateStr}T00:00:00Z`);
    if (isNaN(targetDate.getTime())) throw new Error('Invalid date format. Expected YYYY-MM-DD');

    const dayOfWeek = targetDate.getUTCDay(); // 0=Sun..6=Sat

    // Check if staff works on this day
    if (!staff.workingDays.includes(dayOfWeek)) return [];

    // Parse working hours
    const [startHour, startMin] = staff.workingHoursStart.split(':').map(Number);
    const [endHour, endMin] = staff.workingHoursEnd.split(':').map(Number);
    const startMinutesOfDay = startHour * 60 + startMin;
    const endMinutesOfDay = endHour * 60 + endMin;

    // Fetch existing appointments for this staff on this date
    const dayStartISO = `${dateStr}T00:00:00.000Z`;
    const dayEndISO = `${dateStr}T23:59:59.999Z`;

    const existingAppts = await db.query(
      `SELECT start_time, end_time FROM appointments
       WHERE organization_id = $1
         AND staff_id = $2
         AND status IN ('CONFIRMED', 'REQUESTED')
         AND start_time >= $3 AND start_time <= $4`,
      [orgId, staffId, dayStartISO, dayEndISO]
    );

    const bookedIntervals = existingAppts.rows.map((a: any) => ({
      start: new Date(a.start_time).getTime(),
      end: new Date(a.end_time).getTime(),
    }));

    // Generate slots
    const slots: AvailableSlot[] = [];
    const pad = (n: number) => n.toString().padStart(2, '0');
    let currentMin = startMinutesOfDay;

    while (currentMin + durationMinutes <= endMinutesOfDay) {
      const slotStartHour = Math.floor(currentMin / 60);
      const slotStartMinute = currentMin % 60;
      const slotEndHour = Math.floor((currentMin + durationMinutes) / 60);
      const slotEndMinute = (currentMin + durationMinutes) % 60;

      const slotStartISO = `${dateStr}T${pad(slotStartHour)}:${pad(slotStartMinute)}:00.000Z`;
      const slotEndISO = `${dateStr}T${pad(slotEndHour)}:${pad(slotEndMinute)}:00.000Z`;

      const slotStartMs = new Date(slotStartISO).getTime();
      const slotEndMs = new Date(slotEndISO).getTime();

      const hasConflict = bookedIntervals.some(
        (booked) => slotStartMs < booked.end && slotEndMs > booked.start
      );
      const isPast = slotStartMs <= Date.now();

      slots.push({
        startTime: slotStartISO,
        endTime: slotEndISO,
        available: !hasConflict && !isPast,
      });

      currentMin += durationMinutes;
    }

    return slots;
  }

  // ── Book Salon Appointment ────────────────────────────────────────────────

  static async bookSalonAppointment(params: {
    organizationId: string;
    staffId?: string;
    serviceId?: string;
    serviceName: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    startTime: string;
    endTime?: string;
    notes?: string;
    partySize?: number;
    seatingPreference?: string;
    durationMinutes?: number;
    conversationId?: string;
  }): Promise<any> {
    const {
      organizationId,
      staffId,
      serviceId,
      serviceName,
      customerName,
      customerEmail,
      customerPhone,
      startTime,
      notes,
      partySize,
      seatingPreference,
      durationMinutes = 30,
      conversationId,
    } = params;

    // Calculate endTime if not provided
    const startMs = new Date(startTime).getTime();
    const endTime = params.endTime ?? new Date(startMs + durationMinutes * 60000).toISOString();

    return db.withTransaction(async (tx) => {
      // BOOKING MODEL:
      //   Salon:      Each STAFF MEMBER is an independent resource. Different stylists
      //               can serve customers simultaneously → check staff overlap only.
      //   Restaurant: Tables are fungible (capacity enforced by maxPartySize at app layer)
      //               → no time-overlap lock needed for unassigned reservations.
      //   Clinic:     Uses AppointmentService (org-level resource) — not this path.

      // 1. Staff-level appointment overlap check (salon bookings with assigned staff).
      //    FOR UPDATE locks conflicting rows so concurrent transactions block until this
      //    transaction commits, preventing READ COMMITTED double-booking phantom reads.
      //    The DB-level exclusion constraint (migration 024) is the final backstop.
      if (staffId) {
        const staffConflict = await tx.getOne(
          `SELECT id FROM appointments
           WHERE organization_id = $1
             AND staff_id = $2
             AND status IN ('CONFIRMED', 'REQUESTED')
             AND start_time < $3
             AND end_time > $4
           FOR UPDATE`,
          [organizationId, staffId, endTime, startTime]
        );
        if (staffConflict) {
          throw new Error('The requested staff member is already booked at this time.');
        }
      }

      // 2. No org-level overlap check here: different staff members may serve
      //    different customers simultaneously (this is correct salon behaviour).
      //    Restaurant reservations (staff_id = NULL) rely on maxPartySize enforcement
      //    in VoiceService.executeVoiceTool → book_reservation.

      // 3. Insert appointment
      const id = uuidv4();
      const row = await tx.getOne(
        `INSERT INTO appointments
           (id, organization_id, service_id, service_name, customer_name, customer_email, customer_phone,
            start_time, end_time, status, notes, staff_id, party_size, seating_preference, conversation_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CONFIRMED', $10, $11, $12, $13, $14,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [
          id,
          organizationId,
          serviceId ?? null,
          serviceName,
          customerName,
          customerEmail,
          customerPhone ?? null,
          startTime,
          endTime,
          notes ?? null,
          staffId ?? null,
          partySize ?? null,
          seatingPreference ?? null,
          conversationId ?? null,
        ]
      );

      return row;
    });
  }

  /** Alias matching route handler expectation */
  static async getStaffAvailableSlots(
    orgId: string,
    staffId: string,
    dateStr: string,
    durationMinutes: number = 30
  ): Promise<AvailableSlot[]> {
    return this.getStaffAvailability(orgId, staffId, dateStr, durationMinutes);
  }
}
