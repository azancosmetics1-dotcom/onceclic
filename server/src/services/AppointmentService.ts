import { db } from '../db';
import { Appointment, AppointmentStatus, AvailableSlot, AuditAction } from '@onceclic/shared';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export class AppointmentService {
  /**
   * Get available appointment slots for a given date.
   */
  static async getAvailableSlots(
    organizationId: string,
    dateStr: string, // 'YYYY-MM-DD'
    durationMinutes: number = 30
  ): Promise<AvailableSlot[]> {
    const targetDate = new Date(`${dateStr}T00:00:00Z`);
    if (isNaN(targetDate.getTime())) {
      throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const dayOfWeek = targetDate.getUTCDay(); // 0 = Sun, 1 = Mon ...

    // 1. Fetch organization availability rule for this day
    const rule = await db.getOne(
      'SELECT start_time, end_time, slot_duration_minutes, buffer_minutes, is_available FROM availability_rules WHERE organization_id = $1 AND day_of_week = $2',
      [organizationId, dayOfWeek]
    );

    if (!rule || !rule.is_available) {
      return [];
    }

    const slotDuration = durationMinutes || rule.slot_duration_minutes || 30;
    const buffer = rule.buffer_minutes || 0;

    // Parse start and end times (e.g. "09:00", "17:00")
    const [startHour, startMin] = rule.start_time.split(':').map(Number);
    const [endHour, endMin] = rule.end_time.split(':').map(Number);

    const startMinutesOfDay = startHour * 60 + startMin;
    const endMinutesOfDay = endHour * 60 + endMin;

    // 2. Fetch existing confirmed or requested appointments on this day
    const dayStartISO = `${dateStr}T00:00:00.000Z`;
    const dayEndISO = `${dateStr}T23:59:59.999Z`;

    const existingAppts = await db.query(
      `SELECT start_time, end_time FROM appointments
       WHERE organization_id = $1
         AND status IN ('CONFIRMED', 'REQUESTED')
         AND start_time >= $2 AND start_time <= $3`,
      [organizationId, dayStartISO, dayEndISO]
    );

    const bookedIntervals = existingAppts.rows.map(a => ({
      start: new Date(a.start_time).getTime(),
      end: new Date(a.end_time).getTime(),
    }));

    // 3. Generate candidate slots and test availability
    const slots: AvailableSlot[] = [];
    let currentMin = startMinutesOfDay;

    while (currentMin + slotDuration <= endMinutesOfDay) {
      const slotStartHour = Math.floor(currentMin / 60);
      const slotStartMinute = currentMin % 60;
      const slotEndHour = Math.floor((currentMin + slotDuration) / 60);
      const slotEndMinute = (currentMin + slotDuration) % 60;

      const pad = (n: number) => n.toString().padStart(2, '0');

      const slotStartISO = `${dateStr}T${pad(slotStartHour)}:${pad(slotStartMinute)}:00.000Z`;
      const slotEndISO = `${dateStr}T${pad(slotEndHour)}:${pad(slotEndMinute)}:00.000Z`;

      const slotStartMs = new Date(slotStartISO).getTime();
      const slotEndMs = new Date(slotEndISO).getTime();

      // Check collision with any existing booked interval (including buffer)
      const hasConflict = bookedIntervals.some(booked => {
        const bookedWithBufferStart = booked.start - buffer * 60000;
        const bookedWithBufferEnd = booked.end + buffer * 60000;
        return slotStartMs < bookedWithBufferEnd && slotEndMs > bookedWithBufferStart;
      });

      // Don't offer slots in the past
      const isPast = slotStartMs <= Date.now();

      slots.push({
        startTime: slotStartISO,
        endTime: slotEndISO,
        available: !hasConflict && !isPast,
      });

      currentMin += slotDuration + buffer;
    }

    return slots;
  }

  /**
   * Book an appointment with strict double-booking prevention in transaction.
   */
  static async bookAppointment(params: {
    organizationId: string;
    serviceId?: string;
    serviceName: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    startTime: string;
    endTime?: string;
    notes?: string;
    conversationId?: string;
    userId?: string;
  }): Promise<Appointment> {
    const startMs = new Date(params.startTime).getTime();
    if (isNaN(startMs)) {
      throw new Error('Invalid start time format.');
    }

    // Default duration 30 mins if endTime not provided
    const calculatedEndTime = params.endTime
      ? params.endTime
      : new Date(startMs + 30 * 60000).toISOString();

    const endMs = new Date(calculatedEndTime).getTime();

    if (endMs <= startMs) {
      throw new Error('Appointment end time must be after start time.');
    }

    return await db.withTransaction(async (tx) => {
      // 1. Conflict Check: Verify no existing appointment overlaps with requested time
      const conflicts = await tx.query(
        `SELECT id, customer_name, start_time, end_time FROM appointments
         WHERE organization_id = $1
           AND status IN ('CONFIRMED', 'REQUESTED')
           AND start_time < $2 AND end_time > $3`,
        [params.organizationId, calculatedEndTime, params.startTime]
      );

      if (conflicts.rowCount > 0) {
        throw new Error('This appointment slot has already been booked. Please choose another time.');
      }

      // 2. Insert new appointment
      const apptId = uuidv4();
      await tx.execute(
        `INSERT INTO appointments (
           id, organization_id, service_id, service_name, customer_name,
           customer_email, customer_phone, start_time, end_time, status,
           notes, conversation_id, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CONFIRMED', $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          apptId,
          params.organizationId,
          params.serviceId || null,
          params.serviceName,
          params.customerName,
          params.customerEmail,
          params.customerPhone || null,
          params.startTime,
          calculatedEndTime,
          params.notes || null,
          params.conversationId || null,
        ]
      );

      await AuditService.log({
        organizationId: params.organizationId,
        userId: params.userId,
        action: AuditAction.APPOINTMENT_CREATED,
        entityType: 'APPOINTMENT',
        entityId: apptId,
        metadata: {
          customerName: params.customerName,
          customerEmail: params.customerEmail,
          startTime: params.startTime,
          serviceName: params.serviceName,
        },
      });

      const booked = await tx.getOne<Appointment>(
        `SELECT id, organization_id as "organizationId", service_id as "serviceId", service_name as "serviceName",
                customer_name as "customerName", customer_email as "customerEmail", customer_phone as "customerPhone",
                start_time as "startTime", end_time as "endTime", status, notes, conversation_id as "conversationId",
                created_at as "createdAt", updated_at as "updatedAt"
         FROM appointments WHERE id = $1`,
        [apptId]
      );

      return booked!;
    });
  }

  /**
   * List appointments with optional date range and status filters.
   */
  static async listAppointments(params: {
    organizationId: string;
    startDate?: string;
    endDate?: string;
    status?: AppointmentStatus;
  }): Promise<Appointment[]> {
    let sql = `
      SELECT id, organization_id as "organizationId", service_id as "serviceId", service_name as "serviceName",
             customer_name as "customerName", customer_email as "customerEmail", customer_phone as "customerPhone",
             start_time as "startTime", end_time as "endTime", status, notes, conversation_id as "conversationId",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM appointments
      WHERE organization_id = $1
    `;
    const queryParams: any[] = [params.organizationId];

    if (params.status) {
      queryParams.push(params.status);
      sql += ` AND status = $${queryParams.length}`;
    }

    sql += ' ORDER BY start_time ASC';

    const res = await db.query(sql, queryParams);
    return res.rows;
  }

  /**
   * Update appointment status (CONFIRMED, CANCELED, COMPLETED, NO_SHOW).
   */
  static async updateStatus(
    organizationId: string,
    appointmentId: string,
    status: AppointmentStatus,
    userId?: string
  ): Promise<Appointment> {
    const updated = await db.execute(
      'UPDATE appointments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $2 AND id = $3',
      [status, organizationId, appointmentId]
    );

    if (updated === 0) {
      throw new Error('Appointment not found.');
    }

    const action =
      status === AppointmentStatus.CANCELED
        ? AuditAction.APPOINTMENT_CANCELED
        : AuditAction.APPOINTMENT_CONFIRMED;

    await AuditService.log({
      organizationId,
      userId,
      action,
      entityType: 'APPOINTMENT',
      entityId: appointmentId,
      metadata: { newStatus: status },
    });

    const appt = await db.getOne<Appointment>(
      `SELECT id, organization_id as "organizationId", service_id as "serviceId", service_name as "serviceName",
              customer_name as "customerName", customer_email as "customerEmail", customer_phone as "customerPhone",
              start_time as "startTime", end_time as "endTime", status, notes, conversation_id as "conversationId",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM appointments WHERE id = $1`,
      [appointmentId]
    );

    return appt!;
  }
}
