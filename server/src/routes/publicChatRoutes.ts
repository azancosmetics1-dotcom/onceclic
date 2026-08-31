import { Router, Request, Response } from 'express';
import { db } from '../db';
import { ConversationService } from '../services/ConversationService';
import { AppointmentService } from '../services/AppointmentService';
import { rateLimit } from '../middleware/rateLimitMiddleware';
import { ConversationChannel, SubscriptionStatus } from '@onceclic/shared';
import jwt from 'jsonwebtoken';
import { config } from '../config';

const router = Router();

// Apply public rate limiting: 60 requests per minute per IP
router.use(rateLimit({ windowMs: 60 * 1000, maxRequests: 60 }));

// Get public organization profile for chat widget
router.get('/org/:slug', async (req: Request, res: Response, next) => {
  try {
    const { slug } = req.params;

    const org = await db.getOne(
      'SELECT id, name, slug, business_type, phone, email, website, address, timezone FROM organizations WHERE slug = $1 AND is_active = TRUE',
      [slug]
    );

    if (!org) {
      return res.status(404).json({ success: false, error: 'Business not found.' });
    }

    const settings = await db.getOne(
      'SELECT services, business_hours, website_chat_enabled, contact_instructions FROM business_settings WHERE organization_id = $1',
      [org.id]
    );

    if (settings && !settings.website_chat_enabled) {
      return res.status(403).json({ success: false, error: 'Website chat is currently disabled by the business.' });
    }

    const aiEmployee = await db.getOne(
      "SELECT name, role_title, greeting_message FROM ai_employees WHERE organization_id = $1 AND status = 'ACTIVE' LIMIT 1",
      [org.id]
    );

    res.json({
      success: true,
      data: {
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          businessType: org.business_type,
          phone: org.phone,
          email: org.email,
          timezone: org.timezone,
        },
        aiEmployee: {
          name: aiEmployee?.name || 'Luna',
          roleTitle: aiEmployee?.role_title || 'AI Receptionist',
          greetingMessage:
            aiEmployee?.greeting_message ||
            `Hi! Welcome to ${org.name}. How can I assist you today?`,
        },
        services: settings?.services ? (typeof settings.services === 'string' ? JSON.parse(settings.services) : settings.services) : [],
        businessHours: settings?.business_hours ? (typeof settings.business_hours === 'string' ? JSON.parse(settings.business_hours) : settings.business_hours) : [],
      },
    });
  } catch (err) {
    next(err);
  }
});

// Start or resume a public customer chat session
router.post('/session', async (req: Request, res: Response, next) => {
  try {
    const { orgSlug, customerName, customerEmail, customerPhone, conversationId } = req.body;

    const org = await db.getOne('SELECT id, name, slug FROM organizations WHERE slug = $1', [orgSlug]);
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    const conversation = await ConversationService.getOrCreateConversation({
      organizationId: org.id,
      channel: ConversationChannel.WEB,
      customerName,
      customerEmail,
      customerPhone,
      conversationId,
    });

    // Create a public session token scoped to this conversation
    const sessionToken = jwt.sign(
      { conversationId: conversation.id, organizationId: org.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    const messages = await ConversationService.getMessages(org.id, conversation.id);

    res.json({
      success: true,
      data: {
        conversationId: conversation.id,
        sessionToken,
        organizationId: org.id,
        messages,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Send a message from public customer chat widget
router.post('/message', async (req: Request, res: Response, next) => {
  try {
    const { sessionToken, content, clientMessageId, customerName, customerEmail, customerPhone } = req.body;

    if (!sessionToken || !content) {
      return res.status(400).json({ success: false, error: 'sessionToken and content are required.' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(sessionToken, config.jwtSecret);
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid or expired chat session token.' });
    }

    const { organizationId, conversationId } = decoded;

    // Check organization subscription status
    const sub = await db.getOne('SELECT status, trial_ends_at FROM subscriptions WHERE organization_id = $1', [
      organizationId,
    ]);

    const isSubActive =
      sub &&
      (sub.status === SubscriptionStatus.ACTIVE ||
        (sub.status === SubscriptionStatus.TRIALING && new Date(sub.trial_ends_at) > new Date()));

    if (!isSubActive) {
      return res.status(402).json({
        success: false,
        error: 'This business chat service is currently undergoing renewal. Please try again later.',
      });
    }

    const result = await ConversationService.handleCustomerMessage({
      organizationId,
      conversationId,
      content,
      clientMessageId,
      customerName,
      customerEmail,
      customerPhone,
    });

    // Update website last active timestamp
    await db.execute(
      'UPDATE business_settings SET website_last_active_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
      [organizationId]
    );

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Public appointment available slots
router.get('/slots', async (req: Request, res: Response, next) => {
  try {
    const orgSlug = req.query.orgSlug as string;
    const date = req.query.date as string;
    const duration = req.query.duration ? parseInt(req.query.duration as string, 10) : 30;

    if (!orgSlug || !date) {
      return res.status(400).json({ success: false, error: 'orgSlug and date are required.' });
    }

    const org = await db.getOne('SELECT id FROM organizations WHERE slug = $1', [orgSlug]);
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    const slots = await AppointmentService.getAvailableSlots(org.id, date, duration);
    res.json({ success: true, data: slots });
  } catch (err) {
    next(err);
  }
});

// Public appointment booking
router.post('/book', async (req: Request, res: Response, next) => {
  try {
    const { orgSlug, serviceId, serviceName, customerName, customerEmail, customerPhone, startTime, notes, conversationId } = req.body;

    if (!orgSlug || !serviceName || !customerName || !customerEmail || !startTime) {
      return res.status(400).json({
        success: false,
        error: 'orgSlug, serviceName, customerName, customerEmail, and startTime are required.',
      });
    }

    const org = await db.getOne('SELECT id FROM organizations WHERE slug = $1', [orgSlug]);
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    const appointment = await AppointmentService.bookAppointment({
      organizationId: org.id,
      serviceId,
      serviceName,
      customerName,
      customerEmail,
      customerPhone,
      startTime,
      notes,
      conversationId,
    });

    res.status(201).json({ success: true, data: appointment });
  } catch (err) {
    next(err);
  }
});

export default router;
