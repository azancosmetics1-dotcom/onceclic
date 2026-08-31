import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { EmailService } from '../services/EmailService';

const router = Router();

// Public webhook endpoint for inbound emails
router.post('/inbound', async (req: Request, res: Response, next) => {
  try {
    const { fromEmail, fromName, toEmail, subject, textBody, webhookToken } = req.body;

    if (!fromEmail || !textBody) {
      return res.status(400).json({ success: false, error: 'fromEmail and textBody are required.' });
    }

    const result = await EmailService.processInboundEmail({
      fromEmail,
      fromName,
      toEmail,
      subject: subject || 'No Subject',
      textBody,
      webhookToken: webhookToken || (req.headers['x-webhook-token'] as string),
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Authenticated connection management routes
router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// Get email connection settings
router.get('/connection', requirePermission('email:read'), async (req: Request, res: Response, next) => {
  try {
    const conn = await EmailService.getConnection(req.organizationId!);
    res.json({ success: true, data: conn });
  } catch (err) {
    next(err);
  }
});

// Update email connection settings
router.put('/connection', requirePermission('email:manage'), async (req: Request, res: Response, next) => {
  try {
    const updated = await EmailService.updateConnection(req.organizationId!, req.body, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
