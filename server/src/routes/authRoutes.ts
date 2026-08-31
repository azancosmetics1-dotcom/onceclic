import { Router, Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { authMiddleware } from '../middleware/authMiddleware';
import { config } from '../config';

const router = Router();

router.post('/register', async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const result = await AuthService.register(req.body, ip);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const result = await AuthService.login(req.body, ip);
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        error: err.message || 'Please verify your email before accessing ONCEClic.',
        email: err.email,
      });
    }
    next(err);
  }
});

router.post('/verify-email', async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const { token } = req.body;
    const result = await AuthService.verifyEmail(token, ip);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.status || 400).json({
      success: false,
      code: err.code || 'VERIFICATION_FAILED',
      error: err.message || 'Verification failed.',
    });
  }
});

router.post('/resend-verification', async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const { email } = req.body;
    const result = await AuthService.resendVerification(email, ip);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.status || 400).json({
      success: false,
      error: err.message || 'Failed to resend verification link.',
    });
  }
});

router.get('/me', authMiddleware, async (req: Request, res: Response, next) => {
  try {
    const result = await AuthService.getProfile(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Google OAuth authorization URL with CSRF state token
 */
router.get('/google/url', (req: Request, res: Response, next) => {
  try {
    const returnUrl = req.query.returnUrl as string | undefined;
    const result = AuthService.getGoogleAuthUrl(returnUrl);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Google OAuth redirect callback endpoint
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress;
  const { code, state, error, error_description } = req.query;

  // Handle user cancelled or Google error
  if (error) {
    const errorMsg = (error_description as string) || (error as string) || 'Google authentication was cancelled.';
    return res.redirect(`${config.app.url}/login?error=${encodeURIComponent(errorMsg)}`);
  }

  if (!code || !state) {
    return res.redirect(`${config.app.url}/login?error=${encodeURIComponent('Missing authorization code or state token from Google.')}`);
  }

  try {
    const result = await AuthService.handleGoogleCallback(code as string, state as string, ip);
    const token = result.auth.token;
    const orgId = result.auth.organization?.id || '';
    const returnPath = result.returnUrl || '/app';

    // Redirect to frontend auth callback handler with session token
    res.redirect(
      `${config.app.url}/auth/callback?token=${encodeURIComponent(token)}&orgId=${encodeURIComponent(
        orgId
      )}&returnUrl=${encodeURIComponent(returnPath)}`
    );
  } catch (err: any) {
    console.error('[Google OAuth] Callback error:', err);
    res.redirect(`${config.app.url}/login?error=${encodeURIComponent(err.message || 'Google authentication failed.')}`);
  }
});

/**
 * Programmatic Google OAuth token exchange (e.g. for SPA token exchange)
 */
router.post('/google/exchange', async (req: Request, res: Response, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const { code, state } = req.body;
    const result = await AuthService.handleGoogleCallback(code, state, ip);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;

