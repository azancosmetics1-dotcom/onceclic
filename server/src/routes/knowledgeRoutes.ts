import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { KnowledgeService } from '../services/KnowledgeService';
import { KnowledgeSourceType } from '@onceclic/shared';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// List knowledge sources
router.get('/sources', requirePermission('knowledge:read'), async (req: Request, res: Response, next) => {
  try {
    const sources = await KnowledgeService.listSources(req.organizationId!);
    res.json({ success: true, data: sources });
  } catch (err) {
    next(err);
  }
});

// Add knowledge source
router.post('/sources', requirePermission('knowledge:manage'), async (req: Request, res: Response, next) => {
  try {
    const { sourceType, title, rawContent } = req.body;
    if (!title || !rawContent) {
      return res.status(400).json({ success: false, error: 'Title and content are required.' });
    }

    const validSourceType = (sourceType as KnowledgeSourceType) || KnowledgeSourceType.FAQ;

    const source = await KnowledgeService.addSource({
      organizationId: req.organizationId!,
      sourceType: validSourceType,
      title,
      rawContent,
      userId: req.user?.id,
    });

    res.status(201).json({ success: true, data: source });
  } catch (err) {
    next(err);
  }
});

// Delete knowledge source
router.delete('/sources/:id', requirePermission('knowledge:manage'), async (req: Request, res: Response, next) => {
  try {
    const success = await KnowledgeService.deleteSource(req.organizationId!, req.params.id, req.user?.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Knowledge source not found.' });
    }
    res.json({ success: true, message: 'Knowledge source deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
