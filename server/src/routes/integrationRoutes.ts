import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { IntegrationService } from '../services/IntegrationService';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// ------------------------------------------
// Website Connection Endpoints
// ------------------------------------------

// Get website connection status and embed script
router.get('/website', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getWebsiteConfig(req.organizationId!);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Verify website connection
router.post('/website/verify', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.verifyWebsite(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Website verified successfully.', data });
  } catch (err) {
    next(err);
  }
});

// Disconnect website widget
router.post('/website/disconnect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.disconnectWebsite(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Website widget disconnected.', data });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// Email Connection Endpoints
// ------------------------------------------

// Get email connection status
router.get('/email', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getEmailConfig(req.organizationId!);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Connect business email
router.post('/email/connect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const { email } = req.body;
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.connectEmail(req.organizationId!, email, req.user?.id, ip);
    res.json({ success: true, message: 'Business email connected successfully.', data });
  } catch (err) {
    next(err);
  }
});

// Disconnect business email
router.post('/email/disconnect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.disconnectEmail(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Business email disconnected.', data });
  } catch (err) {
    next(err);
  }
});

export default router;
