import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { AppointmentService } from '../services/AppointmentService';
import { AppointmentStatus, AvailabilityRule } from '@onceclic/shared';
import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// List appointments
router.get('/', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const status = req.query.status as AppointmentStatus | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const appointments = await AppointmentService.listAppointments({
      organizationId: req.organizationId!,
      status,
      startDate,
      endDate,
    });

    res.json({ success: true, data: appointments });
  } catch (err) {
    next(err);
  }
});

// Query available slots
router.get('/slots', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const date = req.query.date as string;
    const duration = req.query.duration ? parseInt(req.query.duration as string, 10) : 30;

    if (!date) {
      return res.status(400).json({ success: false, error: 'Date parameter (YYYY-MM-DD) is required.' });
    }

    const slots = await AppointmentService.getAvailableSlots(req.organizationId!, date, duration);
    res.json({ success: true, data: slots });
  } catch (err) {
    next(err);
  }
});

// Book appointment
router.post('/', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    const { serviceId, serviceName, customerName, customerEmail, customerPhone, startTime, endTime, notes } = req.body;

    if (!serviceName || !customerName || !customerEmail || !startTime) {
      return res.status(400).json({
        success: false,
        error: 'Service name, customer name, email, and start time are required.',
      });
    }

    const appointment = await AppointmentService.bookAppointment({
      organizationId: req.organizationId!,
      serviceId,
      serviceName,
      customerName,
      customerEmail,
      customerPhone,
      startTime,
      endTime,
      notes,
      userId: req.user?.id,
    });

    res.status(201).json({ success: true, data: appointment });
  } catch (err) {
    next(err);
  }
});

// Update appointment status
router.patch('/:id/status', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    const { status } = req.body;
    if (!status || !Object.values(AppointmentStatus).includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid appointment status is required.' });
    }

    const updated = await AppointmentService.updateStatus(
      req.organizationId!,
      req.params.id,
      status as AppointmentStatus,
      req.user?.id
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Get availability rules
router.get('/rules', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const rulesRes = await db.query(
      `SELECT id, organization_id as "organizationId", day_of_week as "dayOfWeek",
              start_time as "startTime", end_time as "endTime",
              slot_duration_minutes as "slotDurationMinutes", buffer_minutes as "bufferMinutes",
              is_available as "isAvailable"
       FROM availability_rules
       WHERE organization_id = $1
       ORDER BY day_of_week ASC`,
      [req.organizationId]
    );

    res.json({ success: true, data: rulesRes.rows });
  } catch (err) {
    next(err);
  }
});

// Update availability rules
router.put('/rules', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    const { rules } = req.body as { rules: AvailabilityRule[] };
    if (!Array.isArray(rules)) {
      return res.status(400).json({ success: false, error: 'Rules array is required.' });
    }

    for (const r of rules) {
      const existing = await db.getOne(
        'SELECT id FROM availability_rules WHERE organization_id = $1 AND day_of_week = $2',
        [req.organizationId, r.dayOfWeek]
      );

      if (existing) {
        await db.execute(
          `UPDATE availability_rules
           SET start_time = $1, end_time = $2, slot_duration_minutes = $3,
               buffer_minutes = $4, is_available = $5, updated_at = CURRENT_TIMESTAMP
           WHERE id = $6`,
          [r.startTime, r.endTime, r.slotDurationMinutes || 30, r.bufferMinutes || 0, r.isAvailable, existing.id]
        );
      } else {
        await db.execute(
          `INSERT INTO availability_rules (
             id, organization_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes, is_available, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            uuidv4(),
            req.organizationId,
            r.dayOfWeek,
            r.startTime,
            r.endTime,
            r.slotDurationMinutes || 30,
            r.bufferMinutes || 0,
            r.isAvailable,
          ]
        );
      }
    }

    res.json({ success: true, message: 'Availability rules updated successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
