import { db } from '../db';
import { Appointment, AppointmentStatus, AvailableSlot, AuditAction } from '@onceclic/shared';
import { AuditService } from './AuditService';
import { IntegrationService } from './IntegrationService';
import { ResendEmailService } from './ResendEmailService';
import { v4 as uuidv4 } from 'uuid';

export class AppointmentService {
  /**
   * Get available appointment slots for a given date, incorporating:
   * 1. Organization business hours & day availability
   * 2. Existing ONCEClic appointments
   * 3. Google Calendar busy periods (if connected)
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

    // 2. Fetch existing confirmed or requested appointments in ONCEClic DB on this day
    const dayStartISO = `${dateStr}T00:00:00.000Z`;
    const dayEndISO = `${dateStr}T23:59:59.999Z`;

    const existingAppts = await db.query(
      `SELECT start_time, end_time FROM appointments
       WHERE organization_id = $1
         AND status IN ('CONFIRMED', 'REQUESTED')
         AND start_time >= $2 AND start_time <= $3`,
      [organizationId, dayStartISO, dayEndISO]
    );

    const bookedIntervals = existingAppts.rows.map((a) => ({
      start: new Date(a.start_time).getTime(),
      end: new Date(a.end_time).getTime(),
    }));

    // 3. Fetch Google Calendar busy periods (if integrated)
    try {
      const gcalBusy = await IntegrationService.getGoogleCalendarBusyPeriods(
        organizationId,
        dayStartISO,
        dayEndISO
      );
      if (gcalBusy && gcalBusy.length > 0) {
        bookedIntervals.push(...gcalBusy);
      }
    } catch (err) {
      console.warn('[AppointmentService] Google Calendar busy check warning:', err);
    }

    // 4. Generate candidate slots and test availability
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
      const hasConflict = bookedIntervals.some((booked) => {
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
   * Book an appointment with strict double-booking prevention in transaction,
   * followed by Google Calendar synchronization and Resend transactional confirmation email.
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

    // 1. Execute transactional double-booking lock
    const booked = await db.withTransaction(async (tx) => {
      // Conflict Check: Verify no existing appointment overlaps with requested time
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

      const apptId = uuidv4();
      await tx.execute(
        `INSERT INTO appointments (
           id, organization_id, service_id, service_name, customer_name,
           customer_email, customer_phone, start_time, end_time, status,
           notes, conversation_id, calendar_sync_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CONFIRMED', $10, $11, 'NOT_SYNCED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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

      const appointment = await tx.getOne<Appointment>(
        `SELECT id, organization_id as "organizationId", service_id as "serviceId", service_name as "serviceName",
                customer_name as "customerName", customer_email as "customerEmail", customer_phone as "customerPhone",
                start_time as "startTime", end_time as "endTime", status, notes, conversation_id as "conversationId",
                google_calendar_event_id as "googleCalendarEventId", calendar_sync_status as "calendarSyncStatus",
                calendar_sync_error as "calendarSyncError", created_at as "createdAt", updated_at as "updatedAt"
         FROM appointments WHERE id = $1`,
        [apptId]
      );

      return appointment!;
    });

    // 2. Fetch business context for emails & calendar
    const org = await db.getOne('SELECT name, timezone FROM organizations WHERE id = $1', [
      params.organizationId,
    ]);
    const businessName = org?.name || 'ONCEClic Business';
    const timezone = org?.timezone || 'UTC';

    // 3. Asynchronously sync with Google Calendar (if connected)
    try {
      const gcalResult = await IntegrationService.createGoogleCalendarEvent(params.organizationId, {
        id: booked.id,
        customerName: booked.customerName,
        customerEmail: booked.customerEmail,
        customerPhone: booked.customerPhone,
        serviceName: booked.serviceName,
        startTime: booked.startTime,
        endTime: booked.endTime,
        notes: booked.notes,
        timezone,
      });

      if (gcalResult.success && gcalResult.eventId) {
        booked.googleCalendarEventId = gcalResult.eventId;
        booked.calendarSyncStatus = 'SYNCED';
      }
    } catch (err: any) {
      console.error('[AppointmentService] Google Calendar creation error:', err?.message || err);
    }

    // 4. Asynchronously send Resend confirmation email to customer
    try {
      await ResendEmailService.sendBookingConfirmation({
        appointmentId: booked.id,
        customerName: booked.customerName,
        customerEmail: booked.customerEmail,
        serviceName: booked.serviceName,
        businessName,
        startTime: booked.startTime,
        endTime: booked.endTime,
        timezone,
        notes: booked.notes,
        organizationId: params.organizationId,
      });
    } catch (err: any) {
      console.error('[AppointmentService] Resend booking confirmation error:', err?.message || err);
    }

    return booked;
  }

  /**
   * Reschedule an existing appointment to a new slot with conflict checks,
   * Google Calendar update, and Resend customer notification.
   */
  static async rescheduleAppointment(params: {
    organizationId: string;
    appointmentId: string;
    newStartTime: string;
    newEndTime?: string;
    userId?: string;
  }): Promise<Appointment> {
    const startMs = new Date(params.newStartTime).getTime();
    if (isNaN(startMs)) {
      throw new Error('Invalid start time format.');
    }

    const calculatedEndTime = params.newEndTime
      ? params.newEndTime
      : new Date(startMs + 30 * 60000).toISOString();

    const existing = await db.getOne<Appointment>(
      `SELECT id, organization_id as "organizationId", service_id as "serviceId", service_name as "serviceName",
              customer_name as "customerName", customer_email as "customerEmail", customer_phone as "customerPhone",
              start_time as "startTime", end_time as "endTime", status, notes, conversation_id as "conversationId",
              google_calendar_event_id as "googleCalendarEventId"
       FROM appointments WHERE organization_id = $1 AND id = $2`,
      [params.organizationId, params.appointmentId]
    );

    if (!existing) {
      throw new Error('Appointment not found.');
    }

    const oldStartTime = existing.startTime;

    // Check conflict excluding current appointment
    const conflicts = await db.query(
      `SELECT id FROM appointments
       WHERE organization_id = $1
         AND id != $2
         AND status IN ('CONFIRMED', 'REQUESTED')
         AND start_time < $3 AND end_time > $4`,
      [params.organizationId, params.appointmentId, calculatedEndTime, params.newStartTime]
    );

    if (conflicts.rowCount > 0) {
      throw new Error('The requested new appointment slot is not available. Please choose another time.');
    }

    await db.execute(
      `UPDATE appointments
       SET start_time = $1,
           end_time = $2,
           status = 'CONFIRMED',
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $3 AND id = $4`,
      [params.newStartTime, calculatedEndTime, params.organizationId, params.appointmentId]
    );

    await AuditService.log({
      organizationId: params.organizationId,
      userId: params.userId,
      action: AuditAction.APPOINTMENT_CONFIRMED,
      entityType: 'APPOINTMENT',
      entityId: params.appointmentId,
      metadata: { oldStartTime, newStartTime: params.newStartTime },
    });

    const org = await db.getOne('SELECT name, timezone FROM organizations WHERE id = $1', [
      params.organizationId,
    ]);
    const businessName = org?.name || 'ONCEClic Business';
    const timezone = org?.timezone || 'UTC';

    // Update Google Calendar event
    if (existing.googleCalendarEventId) {
      try {
        await IntegrationService.updateGoogleCalendarEvent(params.organizationId, {
          id: existing.id,
          googleCalendarEventId: existing.googleCalendarEventId,
          customerName: existing.customerName,
          customerEmail: existing.customerEmail,
          serviceName: existing.serviceName,
          startTime: params.newStartTime,
          endTime: calculatedEndTime,
          timezone,
        });
      } catch (err) {
        console.error('[AppointmentService] Google Calendar update error:', err);
      }
    }

    // Send Resend Rescheduled Email
    try {
      await ResendEmailService.sendBookingRescheduled({
        appointmentId: existing.id,
        customerName: existing.customerName,
        customerEmail: existing.customerEmail,
        serviceName: existing.serviceName,
        businessName,
        newStartTime: params.newStartTime,
        newEndTime: calculatedEndTime,
        timezone,
        organizationId: params.organizationId,
      });
    } catch (err) {
      console.error('[AppointmentService] Resend reschedule email error:', err);
    }

    return (await this.getAppointmentById(params.organizationId, params.appointmentId))!;
  }

  /**
   * Cancel an appointment, delete from Google Calendar, and send cancellation email.
   */
  static async cancelAppointment(
    organizationId: string,
    appointmentId: string,
    userId?: string
  ): Promise<Appointment> {
    return this.updateStatus(organizationId, appointmentId, AppointmentStatus.CANCELED, userId);
  }

  /**
   * Helper to normalize database rows to Appointment interface with ISO date strings.
   */
  private static formatAppointment(row: any): Appointment {
    return {
      ...row,
      startTime: row.startTime instanceof Date ? row.startTime.toISOString() : String(row.startTime),
      endTime: row.endTime instanceof Date ? row.endTime.toISOString() : String(row.endTime),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    };
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
             google_calendar_event_id as "googleCalendarEventId", calendar_sync_status as "calendarSyncStatus",
             calendar_sync_error as "calendarSyncError", created_at as "createdAt", updated_at as "updatedAt"
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
    return res.rows.map((r) => this.formatAppointment(r));
  }

  /**
   * Get single appointment by ID.
   */
  static async getAppointmentById(
    organizationId: string,
    appointmentId: string
  ): Promise<Appointment | null> {
    const appt = await db.getOne<Appointment>(
      `SELECT id, organization_id as "organizationId", service_id as "serviceId", service_name as "serviceName",
              customer_name as "customerName", customer_email as "customerEmail", customer_phone as "customerPhone",
              start_time as "startTime", end_time as "endTime", status, notes, conversation_id as "conversationId",
              google_calendar_event_id as "googleCalendarEventId", calendar_sync_status as "calendarSyncStatus",
              calendar_sync_error as "calendarSyncError", created_at as "createdAt", updated_at as "updatedAt"
       FROM appointments WHERE organization_id = $1 AND id = $2`,
      [organizationId, appointmentId]
    );

    return appt ? this.formatAppointment(appt) : null;
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
    const existing = await this.getAppointmentById(organizationId, appointmentId);
    if (!existing) {
      throw new Error('Appointment not found.');
    }

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

    // If cancelled, remove Google Calendar event and send cancellation email
    if (status === AppointmentStatus.CANCELED) {
      if (existing.googleCalendarEventId) {
        try {
          await IntegrationService.deleteGoogleCalendarEvent(
            organizationId,
            existing.googleCalendarEventId,
            appointmentId
          );
        } catch (err) {
          console.error('[AppointmentService] Google Calendar event deletion error:', err);
        }
      }

      try {
        const org = await db.getOne('SELECT name FROM organizations WHERE id = $1', [
          organizationId,
        ]);
        await ResendEmailService.sendBookingCancellation({
          appointmentId: existing.id,
          customerName: existing.customerName,
          customerEmail: existing.customerEmail,
          serviceName: existing.serviceName,
          businessName: org?.name || 'ONCEClic Business',
          startTime: existing.startTime,
          organizationId,
        });
      } catch (err) {
        console.error('[AppointmentService] Resend cancellation email error:', err);
      }
    }

    const appt = await this.getAppointmentById(organizationId, appointmentId);
    return appt!;
  }
}
