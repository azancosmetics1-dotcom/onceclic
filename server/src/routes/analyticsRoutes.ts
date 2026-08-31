import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { AnalyticsService } from '../services/AnalyticsService';
import { ConversationChannel } from '@onceclic/shared';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// Get tenant-isolated analytics overview and charts
router.get('/', requirePermission('analytics:read'), async (req: Request, res: Response, next) => {
  try {
    const period = (req.query.period as any) || '7d';
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const channel = req.query.channel as ConversationChannel;
    const ip = req.ip || req.socket.remoteAddress;

    const data = await AnalyticsService.getOrganizationAnalytics({
      organizationId: req.organizationId!,
      userId: req.user?.id,
      period,
      startDate,
      endDate,
      channel,
      ipAddress: ip,
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
