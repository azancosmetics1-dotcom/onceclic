import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { ConversationService } from '../services/ConversationService';
import { ConversationChannel, ConversationStatus } from '@onceclic/shared';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// List conversations
router.get('/', requirePermission('conversations:read'), async (req: Request, res: Response, next) => {
  try {
    const channel = req.query.channel as ConversationChannel | undefined;
    const status = req.query.status as ConversationStatus | undefined;

    const conversations = await ConversationService.listConversations({
      organizationId: req.organizationId!,
      channel,
      status,
    });

    res.json({ success: true, data: conversations });
  } catch (err) {
    next(err);
  }
});

// Get messages for conversation
router.get('/:id/messages', requirePermission('conversations:read'), async (req: Request, res: Response, next) => {
  try {
    const messages = await ConversationService.getMessages(req.organizationId!, req.params.id);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
});

// Send manual human agent reply
router.post('/:id/reply', requirePermission('conversations:manage'), async (req: Request, res: Response, next) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Reply content is required.' });
    }

    const message = await ConversationService.sendHumanReply({
      organizationId: req.organizationId!,
      conversationId: req.params.id,
      content,
      userId: req.user!.id,
    });

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
});

// Update conversation status
router.patch('/:id/status', requirePermission('conversations:manage'), async (req: Request, res: Response, next) => {
  try {
    const { status } = req.body;
    if (!status || !Object.values(ConversationStatus).includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid conversation status is required.' });
    }

    const updated = await ConversationService.updateStatus(
      req.organizationId!,
      req.params.id,
      status as ConversationStatus,
      req.user?.id
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
