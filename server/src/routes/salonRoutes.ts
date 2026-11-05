import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { SalonService } from '../services/SalonService';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// ─── Services ────────────────────────────────────────────────────────────────

/**
 * List all salon services for the organization
 */
router.get('/services', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const services = await SalonService.listServices(req.organizationId!);
    res.json({ success: true, data: services });
  } catch (err) {
    next(err);
  }
});

/**
 * Create a new salon service
 */
router.post('/services', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    const { name, description, price, durationMinutes, category, isActive, instructions } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'Service name is required.' });
    }
    const service = await SalonService.createService(req.organizationId!, {
      name: name.trim(),
      description,
      price: price !== undefined ? parseFloat(price) : 0,
      durationMinutes: durationMinutes !== undefined ? parseInt(durationMinutes, 10) : 30,
      category,
      isActive,
      instructions,
    });
    res.status(201).json({ success: true, data: service });
  } catch (err) {
    next(err);
  }
});

/**
 * Get a single salon service
 */
router.get('/services/:id', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const service = await SalonService.getService(req.organizationId!, req.params.id);
    if (!service) {
      return res.status(404).json({ success: false, error: 'Salon service not found.' });
    }
    res.json({ success: true, data: service });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a salon service
 */
router.put('/services/:id', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    const { name, description, price, durationMinutes, category, isActive, instructions } = req.body;
    const updated = await SalonService.updateService(req.organizationId!, req.params.id, {
      name,
      description,
      price: price !== undefined ? parseFloat(price) : undefined,
      durationMinutes: durationMinutes !== undefined ? parseInt(durationMinutes, 10) : undefined,
      category,
      isActive,
      instructions,
    });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    if (err.message === 'Salon service not found.') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/**
 * Delete (deactivate) a salon service
 */
router.delete('/services/:id', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    await SalonService.deleteService(req.organizationId!, req.params.id);
    res.json({ success: true, message: 'Service deactivated successfully.' });
  } catch (err: any) {
    if (err.message === 'Salon service not found.') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// ─── Staff ───────────────────────────────────────────────────────────────────

/**
 * List all staff members for the organization
 */
router.get('/staff', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const staff = await SalonService.listStaff(req.organizationId!);
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
});

/**
 * Create a new staff member
 */
router.post('/staff', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    const { name, phone, email, isActive, workingDays, workingHoursStart, workingHoursEnd } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'Staff name is required.' });
    }
    const staff = await SalonService.createStaff(req.organizationId!, {
      name: name.trim(),
      phone,
      email,
      isActive,
      workingDays: Array.isArray(workingDays) ? workingDays.map(Number) : undefined,
      workingHoursStart,
      workingHoursEnd,
    });
    res.status(201).json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
});

/**
 * Get a single staff member
 */
router.get('/staff/:id', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const staff = await SalonService.getStaff(req.organizationId!, req.params.id);
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff member not found.' });
    }
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a staff member
 */
router.put('/staff/:id', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    const { name, phone, email, isActive, workingDays, workingHoursStart, workingHoursEnd } = req.body;
    const updated = await SalonService.updateStaff(req.organizationId!, req.params.id, {
      name,
      phone,
      email,
      isActive,
      workingDays: Array.isArray(workingDays) ? workingDays.map(Number) : undefined,
      workingHoursStart,
      workingHoursEnd,
    });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    if (err.message === 'Staff member not found.') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/**
 * Delete (deactivate) a staff member
 */
router.delete('/staff/:id', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    await SalonService.deleteStaff(req.organizationId!, req.params.id);
    res.json({ success: true, message: 'Staff member deactivated successfully.' });
  } catch (err: any) {
    if (err.message === 'Staff member not found.') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// ─── Staff-Service Assignments ───────────────────────────────────────────────

/**
 * List services assigned to a staff member
 */
router.get('/staff/:id/services', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const services = await SalonService.getStaffServices(req.organizationId!, req.params.id);
    res.json({ success: true, data: services });
  } catch (err) {
    next(err);
  }
});

/**
 * Assign a service to a staff member
 */
router.post('/staff/:id/services/:serviceId', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    await SalonService.assignServiceToStaff(req.organizationId!, req.params.id, req.params.serviceId);
    res.json({ success: true, message: 'Service assigned to staff member.' });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
});

/**
 * Remove a service from a staff member
 */
router.delete('/staff/:id/services/:serviceId', requirePermission('appointments:manage'), async (req: Request, res: Response, next) => {
  try {
    await SalonService.removeServiceFromStaff(req.organizationId!, req.params.id, req.params.serviceId);
    res.json({ success: true, message: 'Service removed from staff member.' });
  } catch (err) {
    next(err);
  }
});

/**
 * Check staff availability for a given date
 */
router.get('/staff/:id/availability', requirePermission('appointments:read'), async (req: Request, res: Response, next) => {
  try {
    const dateStr = req.query.date as string;
    const durationMinutes = req.query.durationMinutes ? parseInt(req.query.durationMinutes as string, 10) : 30;
    if (!dateStr) {
      return res.status(400).json({ success: false, error: 'date query parameter is required (YYYY-MM-DD).' });
    }
    const slots = await SalonService.getStaffAvailableSlots(req.organizationId!, req.params.id, dateStr, durationMinutes);
    res.json({ success: true, data: slots });
  } catch (err) {
    next(err);
  }
});

export default router;

