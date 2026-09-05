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

    const appType = String(app) === 'googlecalendar' ? 'googlecalendar' : 'gmail';
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

// Protected routes require authentication & tenant isolation
router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// ------------------------------------------
// Google Calendar Endpoints
// ------------------------------------------

// Get Google Calendar authorization URL
router.get('/google-calendar/auth-url', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
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
});

// Get Google Calendar connection status
router.get('/google-calendar', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getGoogleCalendarConfig(req.organizationId!);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Disconnect Google Calendar
router.post('/google-calendar/disconnect', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const data = await IntegrationService.disconnectGoogleCalendar(req.organizationId!, req.user?.id, ip);
    res.json({ success: true, message: 'Google Calendar disconnected.', data });
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

// Get Google Email / Gmail OAuth authorization URL
router.get('/google-email/auth-url', requirePermission('integrations:manage'), async (req: Request, res: Response, next) => {
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
});

// Get email connection status
router.get('/email', requirePermission('integrations:read'), async (req: Request, res: Response, next) => {
  try {
    const data = await IntegrationService.getEmailConfig(req.organizationId!);
    res.json({ success: true, data });
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
