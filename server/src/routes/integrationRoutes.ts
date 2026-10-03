import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { IntegrationService } from '../services/IntegrationService';
import { config } from '../config';

const router = Router();

// ------------------------------------------
// Public OAuth Callback for Google Calendar
// ------------------------------------------
router.get('/google-calendar/callback', async (req: Request, res: Response, next) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${config.app.url}/app/integrations?error=${encodeURIComponent(String(error))}`);
    }

    if (!code || !state) {
      return res.redirect(`${config.app.url}/app/integrations?error=missing_oauth_params`);
    }

    const ip = req.ip || req.socket.remoteAddress;
    const result = await IntegrationService.handleGoogleCalendarCallback(String(code), String(state), undefined, ip);

    return res.redirect(`${config.app.url}${result.returnUrl}?calendar_connected=true`);
  } catch (err: any) {
    console.error('[Google Calendar Callback Error]', err);
    return res.redirect(`${config.app.url}/app/integrations?error=${encodeURIComponent(err.message || 'oauth_failed')}`);
  }
});

// ------------------------------------------
// Public OAuth Callback for Google Email / Gmail
// ------------------------------------------
router.get('/google-email/callback', async (req: Request, res: Response, next) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${config.app.url}/app/integrations?error=${encodeURIComponent(String(error))}`);
    }

    if (!code || !state) {
      return res.redirect(`${config.app.url}/app/integrations?error=missing_oauth_params`);
    }

    const ip = req.ip || req.socket.remoteAddress;
    const result = await IntegrationService.handleGoogleEmailCallback(String(code), String(state), undefined, ip);

    return res.redirect(
      `${config.app.url}${result.returnUrl}?email_connected=true&email=${encodeURIComponent(result.connectedEmail)}`
    );
  } catch (err: any) {
    console.error('[Google Email Callback Error]', err);
    return res.redirect(`${config.app.url}/app/integrations?error=${encodeURIComponent(err.message || 'oauth_failed')}`);
  }
});

// ------------------------------------------
// Public Callback for Composio Managed OAuth
// ------------------------------------------
router.get('/composio/callback', async (req: Request, res: Response, next) => {
  try {
    const { app, orgId, returnUrl, error } = req.query;
    const effectiveReturn = returnUrl ? String(returnUrl) : '/app/integrations';

    if (error) {
      return res.redirect(`${config.app.url}${effectiveReturn}?error=${encodeURIComponent(String(error))}`);
    }

    if (!orgId || !app) {
      return res.redirect(`${config.app.url}${effectiveReturn}?error=missing_composio_params`);
    }

    const rawApp = String(app).toLowerCase();
    const appType: 'gmail' | 'googlecalendar' | 'instagram' | 'facebook' =
      rawApp === 'googlecalendar' ? 'googlecalendar'
      : rawApp === 'instagram' ? 'instagram'
      : rawApp === 'facebook' ? 'facebook'
      : 'gmail';
    const ip = req.ip || req.socket.remoteAddress;

    const result = await IntegrationService.handleComposioCallback({
      app: appType,
      orgId: String(orgId),
      returnUrl: effectiveReturn,
      ipAddress: ip,
    });

    if (appType === 'gmail') {
      return res.redirect(
        `${config.app.url}${result.returnUrl}?email_connected=true${
          result.connectedItem ? `&email=${encodeURIComponent(result.connectedItem)}` : ''
        }`
      );
    } else if (appType === 'instagram') {
      return res.redirect(
        `${config.app.url}${result.returnUrl}?instagram_connected=true${
          result.connectedItem ? `&username=${encodeURIComponent(result.connectedItem)}` : ''
        }`
      );
    } else if (appType === 'facebook') {
      return res.redirect(
        `${config.app.url}${result.returnUrl}?facebook_connected=true${
          result.connectedItem ? `&page=${encodeURIComponent(result.connectedItem)}` : ''
        }`
      );
    } else {
      return res.redirect(`${config.app.url}${result.returnUrl}?calendar_connected=true`);
    }
  } catch (err: any) {
    console.error('[Composio Callback Error]', err);
    return res.redirect(
      `${config.app.url}/app/integrations?error=${encodeURIComponent(err.message || 'composio_connection_failed')}`
    );
  }
});


// ------------------------------------------
// Public Inbound Webhook Verification for Instagram / Meta
// ------------------------------------------
router.get('/instagram/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] || (req.query.hub as any)?.mode || req.query.hub_mode;
  const token = req.query['hub.verify_token'] || (req.query.hub as any)?.verify_token || req.query.hub_verify_token;
  const challenge = req.query['hub.challenge'] || (req.query.hub as any)?.challenge || req.query.hub_challenge;

  const expectedToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === 'subscribe' &&
    expectedToken &&
    token === expectedToken &&
    challenge !== undefined &&
    challenge !== null
  ) {
    return res.status(200).send(String(challenge));
  }

  return res.status(403).send('Forbidden');
});

// ------------------------------------------
// Public Inbound Webhook for Instagram Messages
// ------------------------------------------
router.post('/instagram/webhook', async (req: Request, res: Response, next) => {
  try {
    const payload = req.body || {};
    const { organizationId, orgId, senderId, senderUsername, text, message, messageId, id } = payload;
    const effectiveOrgId = organizationId || orgId || (req.query.orgId as string);

    if (!effectiveOrgId) {
      return res.status(400).json({ success: false, error: 'Missing organizationId' });
    }

    const effectiveSenderId = senderId || payload.from?.id || payload.sender?.id || 'unknown_ig_user';
    const effectiveSenderUsername = senderUsername || payload.from?.username || payload.sender?.username;
    const effectiveText = text || message || payload.content || '';
    const effectiveMessageId = messageId || id || payload.mid;

    const result = await IntegrationService.handleInstagramInboundMessage({
      organizationId: effectiveOrgId,
      senderId: effectiveSenderId,
      senderUsername: effectiveSenderUsername,
      text: effectiveText,
      messageId: effectiveMessageId,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// Public Inbound Webhook for Facebook Page Messages
// ------------------------------------------
router.post('/facebook/webhook', async (req: Request, res: Response, next) => {
  try {
    const payload = req.body || {};
    const { organizationId, orgId, senderId, senderName, text, message, messageId, id } = payload;
    const effectiveOrgId = organizationId || orgId || (req.query.orgId as string);

    if (!effectiveOrgId) {
      return res.status(400).json({ success: false, error: 'Missing organizationId' });
    }

    const effectiveSenderId = senderId || payload.from?.id || payload.sender?.id || 'unknown_fb_user';
    const effectiveSenderName = senderName || payload.from?.name || payload.sender?.name;
    const effectiveText = text || message || payload.content || '';
    const effectiveMessageId = messageId || id || payload.mid;

    const result = await IntegrationService.handleFacebookInboundMessage({
      organizationId: effectiveOrgId,
      senderId: effectiveSenderId,
      senderName: effectiveSenderName,
      text: effectiveText,
      messageId: effectiveMessageId,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});


import {
  toCustomerWebsiteConfig,
  toCustomerEmailConfig,
  toCustomerCalendarConfig,
  toCustomerInstagramConfig,
  toCustomerFacebookConfig,
} from '../serializers/customerSerializers';

// Protected routes require authentication & tenant isolation
router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// ------------------------------------------
// Google Calendar Endpoints
// ------------------------------------------

// Get Google Calendar authorization URL
router.get(
  ['/google-calendar/auth-url', '/google-calendar/auth', '/calendar/auth-url', '/calendar/auth'],
  requirePermission('integrations:manage'),
  async (req: Request, res: Response, next) => {
    try {
      const { returnUrl } = req.query;
      const result = await IntegrationService.getGoogleCalendarAuthUrl(
        req.organizationId!,
        req.user?.id,
        returnUrl ? String(returnUrl) : undefined
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// Get Google Calendar connection status
router.get('/google-calendar', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getGoogleCalendarConfig(req.organizationId!);
    res.json({ success: true, data: toCustomerCalendarConfig(data) });
  } catch (err) {
    next(err);
  }
});

// Disconnect Google Calendar
router.post('/google-calendar/disconnect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.disconnectGoogleCalendar(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Google Calendar disconnected.', data: toCustomerCalendarConfig(data) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// Website Connection Endpoints
// ------------------------------------------

// Get website connection status and embed script
router.get('/website', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getWebsiteConfig(req.organizationId!);
    res.json({ success: true, data: toCustomerWebsiteConfig(data) });
  } catch (err) {
    next(err);
  }
});

// Verify website connection
router.post('/website/verify', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.verifyWebsite(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Website verified successfully.', data: toCustomerWebsiteConfig(data) });
  } catch (err) {
    next(err);
  }
});

// Disconnect website widget
router.post('/website/disconnect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.disconnectWebsite(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Website widget disconnected.', data: toCustomerWebsiteConfig(data) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// Email Connection Endpoints
// ------------------------------------------

// Get Google Email / Gmail OAuth authorization URL
router.get(
  ['/google-email/auth-url', '/google-email/auth', '/email/auth-url', '/email/auth', '/gmail/auth-url', '/gmail/auth'],
  requirePermission('integrations:manage'),
  async (req: Request, res: Response, next) => {
    try {
      const { returnUrl } = req.query;
      const result = await IntegrationService.getGoogleEmailAuthUrl(
        req.organizationId!,
        req.user?.id,
        returnUrl ? String(returnUrl) : undefined
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// Get email connection status
router.get('/email', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getEmailConfig(req.organizationId!);
    res.json({ success: true, data: toCustomerEmailConfig(data) });
  } catch (err) {
    next(err);
  }
});

// Disconnect business email
router.post('/email/disconnect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.disconnectEmail(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Business email disconnected.', data: toCustomerEmailConfig(data) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// Instagram Connection Endpoints
// ------------------------------------------

// Get Instagram OAuth authorization URL
router.get(
  ['/instagram/auth-url', '/instagram/auth'],
  requirePermission('integrations:manage'),
  async (req: Request, res: Response, next) => {
    try {
      const { returnUrl } = req.query;
      const result = await IntegrationService.getInstagramAuthUrl(
        req.organizationId!,
        req.user?.id,
        returnUrl ? String(returnUrl) : undefined
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// Get Instagram connection status
router.get('/instagram', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getInstagramConfig(req.organizationId!);
    res.json({ success: true, data: toCustomerInstagramConfig(data) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// Facebook Connection Endpoints
// ------------------------------------------

// Get Facebook Page OAuth authorization URL
router.get(
  ['/facebook/auth-url', '/facebook/auth'],
  requirePermission('integrations:manage'),
  async (req: Request, res: Response, next) => {
    try {
      const { returnUrl } = req.query;
      const result = await IntegrationService.getFacebookAuthUrl(
        req.organizationId!,
        req.user?.id,
        returnUrl ? String(returnUrl) : undefined
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// Get Facebook connection status
router.get('/facebook', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getFacebookConfig(req.organizationId!);
    res.json({ success: true, data: toCustomerFacebookConfig(data) });
  } catch (err) {
    next(err);
  }
});

// Disconnect Facebook
router.post('/facebook/disconnect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.disconnectFacebook(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Facebook Page disconnected.', data: toCustomerFacebookConfig(data) });
  } catch (err) {
    next(err);
  }
});

export default router;

