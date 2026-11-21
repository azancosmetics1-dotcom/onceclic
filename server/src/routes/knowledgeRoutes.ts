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
    const { sourceType, title, rawContent, fileUrl, fileType, fileSize } = req.body;
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

    // Asynchronously synchronize with Vapi assistant in background
    import('../services/voice/VoiceAssistantProvisioningService')
      .then(({ VoiceAssistantProvisioningService }) => {
        VoiceAssistantProvisioningService.syncAssistantKnowledge(req.organizationId!).catch(err => {
          console.warn(`[KnowledgeRoutes] Background Vapi knowledge sync deferred for org ${req.organizationId}:`, err?.message || err);
        });
      })
      .catch(() => {});

    res.status(201).json({ success: true, data: source });
  } catch (err) {
    next(err);
  }
});

// Explicit Sync to Vapi Assistant
router.post('/sync-vapi', requirePermission('knowledge:manage'), async (req: Request, res: Response, next) => {
  try {
    const { VoiceAssistantProvisioningService } = await import('../services/voice/VoiceAssistantProvisioningService');
    const result = await VoiceAssistantProvisioningService.syncAssistantKnowledge(req.organizationId!);
    res.json({
      success: true,
      message: 'Knowledge base successfully synchronized with dedicated AI Voice Assistant.',
      data: result,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `Knowledge synchronization failed: ${err.message || err}`,
    });
  }
});

// Delete knowledge source
router.delete('/sources/:id', requirePermission('knowledge:manage'), async (req: Request, res: Response, next) => {
  try {
    const success = await KnowledgeService.deleteSource(req.organizationId!, req.params.id, req.user?.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Knowledge source not found.' });
    }

    // Re-sync after delete
    import('../services/voice/VoiceAssistantProvisioningService')
      .then(({ VoiceAssistantProvisioningService }) => {
        VoiceAssistantProvisioningService.syncAssistantKnowledge(req.organizationId!).catch(() => {});
      })
      .catch(() => {});

    res.json({ success: true, message: 'Knowledge source deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
