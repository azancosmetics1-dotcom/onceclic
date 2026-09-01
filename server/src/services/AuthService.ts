import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db';
import { config } from '../config';
import {
  User,
  Organization,
  OrganizationMembership,
  UserRole,
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  AuditAction,
  KnowledgeSourceType,
} from '@onceclic/shared';
import { PaddleBillingService } from './PaddleBillingService';
import { KnowledgeService } from './KnowledgeService';
import { AuditService } from './AuditService';
import { ResendEmailService } from './ResendEmailService';
import { v4 as uuidv4 } from 'uuid';

export interface ExtendedAuthResponse extends AuthResponse {
  verificationToken?: string;
  emailVerificationRequired?: boolean;
}

export class AuthService {
  /**
   * Register a new user, create default business workspace, 7-day trial, AI receptionist, and settings.
   */
  static async register(params: RegisterRequest, ipAddress?: string): Promise<ExtendedAuthResponse> {
    const email = params.email.toLowerCase().trim();
    if (!email || !params.password || params.password.length < 6) {
      throw new Error('Valid email and password (minimum 6 characters) are required.');
    }

    // Check if user already exists
    const existing = await db.getOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      throw new Error('An account with this email address already exists.');
    }

    const passwordHash = await bcrypt.hash(params.password, 10);
    const userId = uuidv4();

    // 1. Create User
    await db.execute(
      `INSERT INTO users (id, email, password_hash, full_name, is_email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [userId, email, passwordHash, params.fullName || 'Business Owner']
    );

    // 2. Setup standard organization, 7-day trial, Luna, settings, availability & knowledge
    const workspace = await this.setupDefaultWorkspace(userId, params.fullName || 'Business Owner', params.businessName);
    const orgId = workspace.organization.id;
    const membershipId = workspace.membership.id;
    const businessName = workspace.organization.name;
    const slug = workspace.organization.slug;

    // 3. Create cryptographic email verification token
    const rawVerificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenHash = crypto.createHash('sha256').update(rawVerificationToken).digest('hex');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.execute(
      `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [uuidv4(), userId, verificationTokenHash, verificationExpiresAt.toISOString()]
    );

    // 4. Send transactional verification email via Resend
    try {
      await ResendEmailService.sendVerificationEmail({
        toEmail: email,
        token: rawVerificationToken,
        fullName: params.fullName,
        organizationId: orgId,
        userId,
      });
    } catch (err: any) {
      console.error('[AuthService] Failed to dispatch verification email via Resend:', err?.message || err);
    }

    // 4. Audit logs
    await AuditService.log({
      organizationId: orgId,
      userId,
      action: AuditAction.USER_REGISTERED,
      entityType: 'USER',
      entityId: userId,
      metadata: { email },
      ipAddress,
    });

    await AuditService.log({
      organizationId: orgId,
      userId,
      action: AuditAction.EMAIL_VERIFICATION_SENT,
      entityType: 'USER',
      entityId: userId,
      metadata: { email, expiresAt: verificationExpiresAt.toISOString() },
      ipAddress,
    });

    await AuditService.log({
      organizationId: orgId,
      userId,
      action: AuditAction.ORGANIZATION_CREATED,
      entityType: 'ORGANIZATION',
      entityId: orgId,
      metadata: { name: businessName, slug },
      ipAddress,
    });

    // Generate JWT Token
    const token = jwt.sign({ userId, email }, config.jwtSecret, { expiresIn: '7d' });

    const user: User = {
      id: userId,
      email,
      fullName: params.fullName || 'Business Owner',
      isEmailVerified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      user,
      token,
      organization: workspace.organization,
      membership: workspace.membership,
      verificationToken: rawVerificationToken,
      emailVerificationRequired: true,
    };
  }

  /**
   * Helper to initialize default organization, 7-day trial, AI receptionist, business settings, availability, and knowledge base.
   */
  private static async setupDefaultWorkspace(
    userId: string,
    fullName: string,
    businessNameParam?: string
  ): Promise<{ organization: Organization; membership: OrganizationMembership }> {
    const orgId = uuidv4();
    const businessName = businessNameParam || `${fullName || 'My'} Business`;
    const slug = `${businessName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Math.random().toString(36).substring(2, 6)}`;

    // 1. Create Organization
    await db.execute(
      `INSERT INTO organizations (id, name, slug, business_type, timezone, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'Professional Services', 'UTC', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [orgId, businessName, slug]
    );

    // 2. Create Membership (Owner)
    const membershipId = uuidv4();
    await db.execute(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [membershipId, orgId, userId]
    );

    // 3. Create 7-day Trial Subscription
    await PaddleBillingService.createTrialSubscription(orgId);

    // 4. Create Default AI Receptionist
    const aiEmployeeId = uuidv4();
    await db.execute(
      `INSERT INTO ai_employees (
         id, organization_id, name, role_title, description, personality, tone,
         instructions, business_context, greeting_message, fallback_message, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        aiEmployeeId,
        orgId,
        'Luna',
        'AI Receptionist & Assistant',
        'Handles customer questions, books appointments, and routes urgent inquiries.',
        'Friendly, professional, helpful, and concise.',
        'warm, polished, and courteous',
        'Always verify customer needs politely. Guide them to schedule an appointment when appropriate. If you lack information, be honest and offer human assistance.',
        `Business: ${businessName}. Operating hours: Monday-Friday 9:00 AM - 5:00 PM.`,
        `Hi there! Welcome to ${businessName}. I am Luna, your AI receptionist. How can I help you today?`,
        "I'm sorry, I don't have enough details on that yet. Would you like to speak with a member of our team?",
      ]
    );

    // 5. Create Default Business Settings
    const defaultHours = [
      { dayOfWeek: 0, openTime: '09:00', closeTime: '17:00', isClosed: true },
      { dayOfWeek: 1, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { dayOfWeek: 2, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { dayOfWeek: 3, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { dayOfWeek: 4, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { dayOfWeek: 5, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { dayOfWeek: 6, openTime: '09:00', closeTime: '17:00', isClosed: true },
    ];

    const defaultServices = [
      { id: 'srv_1', name: 'General Consultation', durationMinutes: 30, price: 0, description: 'Initial consultation and inquiry.' },
      { id: 'srv_2', name: 'Standard Service Session', durationMinutes: 60, price: 100, description: 'Standard client appointment session.' },
    ];

    await db.execute(
      `INSERT INTO business_settings (
         id, organization_id, business_hours, services, cancellation_policy,
         contact_instructions, website_chat_enabled, email_answering_enabled, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        orgId,
        JSON.stringify(defaultHours),
        JSON.stringify(defaultServices),
        'Please give at least 24 hours notice for appointment cancellations or rescheduling.',
        'You can reach us directly via this chat or our business email.',
      ]
    );

    // 6. Create Default Availability Rules (Mon-Fri)
    for (let day = 1; day <= 5; day++) {
      await db.execute(
        `INSERT INTO availability_rules (
           id, organization_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes, is_available, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), orgId, day, '09:00', '17:00', 30, 10, true]
      );
    }

    // 7. Create Starter Knowledge Source
    await KnowledgeService.addSource({
      organizationId: orgId,
      sourceType: KnowledgeSourceType.FAQ,
      title: 'General Business FAQs',
      rawContent: `Q: What are your regular operating hours?\nA: We are open Monday through Friday from 9:00 AM to 5:00 PM. We are closed on weekends.\n\nQ: How do I book an appointment?\nA: You can book an appointment right here through this chat! Simply ask to schedule a time and provide your name and email.\n\nQ: What is your cancellation policy?\nA: We request at least 24 hours notice for any cancellations or schedule adjustments.`,
      userId,
    });

    const organization: Organization = {
      id: orgId,
      name: businessName,
      slug,
      businessType: 'Professional Services',
      timezone: 'UTC',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const membership: OrganizationMembership = {
      id: membershipId,
      organizationId: orgId,
      userId,
      role: UserRole.OWNER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return { organization, membership };
  }

  /**
   * Log in an existing user and retrieve their organization membership.
   */
  static async login(params: LoginRequest, ipAddress?: string): Promise<AuthResponse> {
    const email = params.email.toLowerCase().trim();
    if (!email || !params.password) {
      throw new Error('Email and password are required.');
    }

    const userRecord = await db.getOne(
      'SELECT id, email, password_hash, full_name, is_email_verified, created_at, updated_at FROM users WHERE email = $1',
      [email]
    );

    if (!userRecord) {
      throw new Error('Invalid email or password.');
    }

    const isMatch = await bcrypt.compare(params.password, userRecord.password_hash);
    if (!isMatch) {
      throw new Error('Invalid email or password.');
    }

    // Require account email verification
    if (!userRecord.is_email_verified) {
      const err: any = new Error('Please verify your email before accessing ONCEClic.');
      err.code = 'EMAIL_NOT_VERIFIED';
      err.status = 403;
      err.email = email;
      throw err;
    }

    // Retrieve primary membership and organization
    const membershipRecord = await db.getOne(
      `SELECT om.id as membership_id, om.role, om.created_at as membership_created_at,
              o.id as org_id, o.name as org_name, o.slug as org_slug, o.business_type,
              o.phone, o.email as org_email, o.website, o.address, o.timezone, o.is_active
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY om.created_at ASC LIMIT 1`,
      [userRecord.id]
    );

    const token = jwt.sign({ userId: userRecord.id, email: userRecord.email }, config.jwtSecret, {
      expiresIn: '7d',
    });

    const user: User = {
      id: userRecord.id,
      email: userRecord.email,
      fullName: userRecord.full_name,
      isEmailVerified: !!userRecord.is_email_verified,
      createdAt: userRecord.created_at,
      updatedAt: userRecord.updated_at,
    };

    let organization: Organization | undefined;
    let membership: OrganizationMembership | undefined;

    if (membershipRecord) {
      organization = {
        id: membershipRecord.org_id,
        name: membershipRecord.org_name,
        slug: membershipRecord.org_slug,
        businessType: membershipRecord.business_type,
        phone: membershipRecord.phone,
        email: membershipRecord.org_email,
        website: membershipRecord.website,
        address: membershipRecord.address,
        timezone: membershipRecord.timezone,
        isActive: !!membershipRecord.is_active,
        createdAt: userRecord.created_at,
        updatedAt: userRecord.updated_at,
      };

      membership = {
        id: membershipRecord.membership_id,
        organizationId: membershipRecord.org_id,
        userId: userRecord.id,
        role: membershipRecord.role as UserRole,
        createdAt: membershipRecord.membership_created_at,
        updatedAt: membershipRecord.membership_created_at,
      };

      await AuditService.log({
        organizationId: membershipRecord.org_id,
        userId: userRecord.id,
        action: AuditAction.USER_LOGIN,
        entityType: 'USER',
        entityId: userRecord.id,
        ipAddress,
      });
    }

    return { user, token, organization, membership };
  }

  /**
   * Get user session profile and organizations.
   */
  static async getProfile(userId: string): Promise<{
    user: User;
    organizations: Array<{ organization: Organization; membership: OrganizationMembership }>;
  }> {
    const userRecord = await db.getOne(
      'SELECT id, email, full_name, is_email_verified, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    if (!userRecord) {
      throw new Error('User not found.');
    }

    const membershipsRes = await db.query(
      `SELECT om.id as membership_id, om.role, om.created_at as membership_created_at,
              o.id as org_id, o.name as org_name, o.slug as org_slug, o.business_type,
              o.phone, o.email as org_email, o.website, o.address, o.timezone, o.is_active
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1`,
      [userId]
    );

    const user: User = {
      id: userRecord.id,
      email: userRecord.email,
      fullName: userRecord.full_name,
      isEmailVerified: !!userRecord.is_email_verified,
      createdAt: userRecord.created_at,
      updatedAt: userRecord.updated_at,
    };

    const organizations = membershipsRes.rows.map((row) => ({
      organization: {
        id: row.org_id,
        name: row.org_name,
        slug: row.org_slug,
        businessType: row.business_type,
        phone: row.phone,
        email: row.org_email,
        website: row.website,
        address: row.address,
        timezone: row.timezone,
        isActive: !!row.is_active,
        createdAt: row.membership_created_at,
        updatedAt: row.membership_created_at,
      },
      membership: {
        id: row.membership_id,
        organizationId: row.org_id,
        userId: userRecord.id,
        role: row.role as UserRole,
        createdAt: row.membership_created_at,
        updatedAt: row.membership_created_at,
      },
    }));

    return { user, organizations };
  }

  /**
   * Verify an email address with a single-use, time-limited cryptographic token.
   */
  static async verifyEmail(
    token: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string; user?: User }> {
    if (!token || typeof token !== 'string') {
      const err: any = new Error('This verification link is invalid or has already been used.');
      err.code = 'INVALID_TOKEN';
      err.status = 400;
      throw err;
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const verification = await db.getOne(
      'SELECT id, user_id, token_hash, expires_at, used_at FROM email_verifications WHERE token_hash = $1',
      [tokenHash]
    );

    if (!verification) {
      const err: any = new Error('This verification link is invalid or has already been used.');
      err.code = 'INVALID_TOKEN';
      err.status = 400;
      throw err;
    }

    if (verification.used_at) {
      const err: any = new Error('This verification link is invalid or has already been used.');
      err.code = 'ALREADY_USED';
      err.status = 400;
      throw err;
    }

    const expiresAt = new Date(verification.expires_at).getTime();
    if (Date.now() > expiresAt) {
      const err: any = new Error('This verification link has expired.');
      err.code = 'TOKEN_EXPIRED';
      err.status = 400;
      throw err;
    }

    // Mark verification token as used
    await db.execute('UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [
      verification.id,
    ]);

    // Mark user as verified
    await db.execute(
      'UPDATE users SET is_email_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [verification.user_id]
    );

    const userRecord = await db.getOne(
      'SELECT id, email, full_name, is_email_verified, created_at, updated_at FROM users WHERE id = $1',
      [verification.user_id]
    );

    // Retrieve organization for audit logging
    const membership = await db.getOne(
      'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
      [verification.user_id]
    );

    if (membership) {
      await AuditService.log({
        organizationId: membership.organization_id,
        userId: verification.user_id,
        action: AuditAction.EMAIL_VERIFIED,
        entityType: 'USER',
        entityId: verification.user_id,
        metadata: { email: userRecord?.email },
        ipAddress,
      });
    }

    const user: User | undefined = userRecord
      ? {
          id: userRecord.id,
          email: userRecord.email,
          fullName: userRecord.full_name,
          isEmailVerified: true,
          createdAt: userRecord.created_at,
          updatedAt: userRecord.updated_at,
        }
      : undefined;

    return { success: true, message: 'Email verified successfully.', user };
  }

  /**
   * Resend a verification email link to the user.
   */
  static async resendVerification(
    email: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string; verificationToken?: string }> {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) {
      throw new Error('Email address is required.');
    }

    const user = await db.getOne(
      'SELECT id, email, is_email_verified FROM users WHERE email = $1',
      [cleanEmail]
    );

    if (!user) {
      // Uniform response prevents user enumeration
      return {
        success: true,
        message: 'If an account exists with this email address, a verification link has been sent.',
      };
    }

    if (user.is_email_verified) {
      return {
        success: true,
        message: 'This email address is already verified. You can log in directly.',
      };
    }

    // Invalidate previous active verification tokens
    await db.execute(
      'UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );

    // Generate new secure random token
    const rawVerificationToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawVerificationToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.execute(
      `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [uuidv4(), user.id, tokenHash, expiresAt.toISOString()]
    );

    const membership = await db.getOne(
      'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
      [user.id]
    );

    if (membership) {
      await AuditService.log({
        organizationId: membership.organization_id,
        userId: user.id,
        action: AuditAction.EMAIL_VERIFICATION_RESENT,
        entityType: 'USER',
        entityId: user.id,
        metadata: { email: cleanEmail, expiresAt: expiresAt.toISOString() },
        ipAddress,
      });
    }

    // Dispatch transactional verification email via Resend
    try {
      await ResendEmailService.sendVerificationEmail({
        toEmail: cleanEmail,
        token: rawVerificationToken,
        organizationId: membership?.organization_id,
        userId: user.id,
      });
    } catch (err: any) {
      console.error('[AuthService] Failed to dispatch verification email via Resend:', err?.message || err);
    }

    return {
      success: true,
      message: 'A new verification link has been sent to your email address.',
      verificationToken: rawVerificationToken,
    };
  }

  /**
   * Generate Google OAuth authorization URL with signed CSRF state token.
   */
  static getGoogleAuthUrl(returnUrl?: string): { url: string; state: string } {
    if (!config.google.clientId) {
      throw new Error(
        'Google OAuth is not configured on the server. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment.'
      );
    }

    // State contains CSRF protection nonce and target returnUrl, signed with jwtSecret
    const stateToken = jwt.sign(
      {
        csrf: crypto.randomBytes(16).toString('hex'),
        returnUrl: returnUrl || '/app',
        type: 'google_oauth_state',
      },
      config.jwtSecret,
      { expiresIn: '15m' }
    );

    const redirectUri = config.google.callbackUrl;
    const scope = 'openid email profile';

    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      config.google.clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(
      scope
    )}&access_type=offline&state=${encodeURIComponent(stateToken)}&prompt=select_account`;

    return { url, state: stateToken };
  }

  /**
   * Validate and decode OAuth state token for CSRF protection.
   */
  static verifyGoogleState(state: string): { csrf: string; returnUrl?: string } {
    if (!state || typeof state !== 'string') {
      const err: any = new Error('Invalid or missing OAuth state parameter.');
      err.code = 'INVALID_OAUTH_STATE';
      err.status = 400;
      throw err;
    }

    try {
      const decoded = jwt.verify(state, config.jwtSecret) as any;
      if (decoded.type !== 'google_oauth_state' || !decoded.csrf) {
        const err: any = new Error('Invalid OAuth state token format.');
        err.code = 'INVALID_OAUTH_STATE';
        err.status = 400;
        throw err;
      }
      return { csrf: decoded.csrf, returnUrl: decoded.returnUrl };
    } catch (err: any) {
      const error: any = new Error('OAuth state token is invalid or expired.');
      error.code = 'EXPIRED_OAUTH_STATE';
      error.status = 400;
      throw error;
    }
  }

  /**
   * Exchange OAuth authorization code for Google user profile info.
   */
  static async exchangeGoogleCode(code: string): Promise<{
    googleId: string;
    email: string;
    emailVerified: boolean;
    fullName?: string;
    avatarUrl?: string;
  }> {
    if (!code) {
      throw new Error('Authorization code is required.');
    }
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth credentials are not configured on the server.');
    }

    const tokenParams = new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.callbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange authorization code with Google.');
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userData = (await userRes.json()) as any;
    if (!userRes.ok || !userData.email) {
      throw new Error('Failed to retrieve user profile from Google.');
    }

    return {
      googleId: userData.sub,
      email: userData.email,
      emailVerified: !!userData.email_verified,
      fullName: userData.name || userData.given_name || 'Business Owner',
      avatarUrl: userData.picture,
    };
  }

  /**
   * Authenticate, link, or register a user with verified Google identity.
   */
  static async processGoogleUser(
    params: {
      googleId: string;
      email: string;
      emailVerified: boolean;
      fullName?: string;
      avatarUrl?: string;
    },
    ipAddress?: string
  ): Promise<ExtendedAuthResponse & { isNewUser: boolean }> {
    const email = (params.email || '').toLowerCase().trim();
    if (!email) {
      throw new Error('Google identity must have a valid email address.');
    }

    // 1. Check if user exists by google_id
    let userRecord = await db.getOne(
      'SELECT id, email, full_name, is_email_verified, google_id, avatar_url, created_at, updated_at FROM users WHERE google_id = $1',
      [params.googleId]
    );

    let isNewUser = false;

    if (userRecord) {
      // User is already linked with this Google identity
      if (params.emailVerified && !userRecord.is_email_verified) {
        await db.execute('UPDATE users SET is_email_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [
          userRecord.id,
        ]);
        userRecord.is_email_verified = true;
      }
      if (params.avatarUrl && !userRecord.avatar_url) {
        await db.execute('UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
          params.avatarUrl,
          userRecord.id,
        ]);
        userRecord.avatar_url = params.avatarUrl;
      }
    } else {
      // 2. Check if user exists by email (account linking)
      userRecord = await db.getOne(
        'SELECT id, email, full_name, is_email_verified, google_id, avatar_url, created_at, updated_at FROM users WHERE email = $1',
        [email]
      );

      if (userRecord) {
        // Existing account with matching email
        // Security requirement: Only link if Google provides a verified email claim
        if (!params.emailVerified) {
          const err: any = new Error(
            'Google account email is not verified. For security, unverified Google accounts cannot link to existing accounts.'
          );
          err.code = 'UNVERIFIED_GOOGLE_EMAIL';
          err.status = 400;
          throw err;
        }

        // Link Google ID to existing user and mark email as verified
        await db.execute(
          'UPDATE users SET google_id = $1, is_email_verified = TRUE, avatar_url = COALESCE($2, avatar_url), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [params.googleId, params.avatarUrl || null, userRecord.id]
        );
        userRecord.google_id = params.googleId;
        userRecord.is_email_verified = true;
        if (params.avatarUrl) userRecord.avatar_url = params.avatarUrl;
      } else {
        // 3. New User Registration via Google OAuth
        isNewUser = true;
        const userId = uuidv4();
        const fullName = params.fullName || 'Business Owner';
        const isEmailVerified = params.emailVerified === true;

        await db.execute(
          `INSERT INTO users (id, email, full_name, is_email_verified, google_id, avatar_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, email, fullName, isEmailVerified, params.googleId, params.avatarUrl || null]
        );

        // Setup standard organization, 7-day trial, Luna, settings, availability & knowledge
        const workspace = await this.setupDefaultWorkspace(userId, fullName);

        await AuditService.log({
          organizationId: workspace.organization.id,
          userId,
          action: AuditAction.USER_REGISTERED,
          entityType: 'USER',
          entityId: userId,
          metadata: { email, provider: 'google', isEmailVerified },
          ipAddress,
        });

        const token = jwt.sign({ userId, email }, config.jwtSecret, { expiresIn: '7d' });

        const user: User = {
          id: userId,
          email,
          fullName,
          isEmailVerified,
          googleId: params.googleId,
          avatarUrl: params.avatarUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        return {
          user,
          token,
          organization: workspace.organization,
          membership: workspace.membership,
          isNewUser: true,
        };
      }
    }

    // Retrieve primary membership and organization for existing or linked user
    const membershipRecord = await db.getOne(
      `SELECT om.id as membership_id, om.role, om.created_at as membership_created_at,
              o.id as org_id, o.name as org_name, o.slug as org_slug, o.business_type,
              o.phone, o.email as org_email, o.website, o.address, o.timezone, o.is_active
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY om.created_at ASC LIMIT 1`,
      [userRecord.id]
    );

    let organization: Organization | undefined;
    let membership: OrganizationMembership | undefined;

    if (membershipRecord) {
      organization = {
        id: membershipRecord.org_id,
        name: membershipRecord.org_name,
        slug: membershipRecord.org_slug,
        businessType: membershipRecord.business_type,
        phone: membershipRecord.phone,
        email: membershipRecord.org_email,
        website: membershipRecord.website,
        address: membershipRecord.address,
        timezone: membershipRecord.timezone,
        isActive: !!membershipRecord.is_active,
        createdAt: userRecord.created_at,
        updatedAt: userRecord.updated_at,
      };

      membership = {
        id: membershipRecord.membership_id,
        organizationId: membershipRecord.org_id,
        userId: userRecord.id,
        role: membershipRecord.role as UserRole,
        createdAt: membershipRecord.membership_created_at,
        updatedAt: membershipRecord.membership_created_at,
      };

      await AuditService.log({
        organizationId: membershipRecord.org_id,
        userId: userRecord.id,
        action: AuditAction.USER_LOGIN,
        entityType: 'USER',
        entityId: userRecord.id,
        metadata: { provider: 'google', email },
        ipAddress,
      });
    }

    const token = jwt.sign({ userId: userRecord.id, email: userRecord.email }, config.jwtSecret, {
      expiresIn: '7d',
    });

    const user: User = {
      id: userRecord.id,
      email: userRecord.email,
      fullName: userRecord.full_name,
      isEmailVerified: !!userRecord.is_email_verified,
      googleId: userRecord.google_id || params.googleId,
      avatarUrl: userRecord.avatar_url || params.avatarUrl,
      createdAt: userRecord.created_at,
      updatedAt: userRecord.updated_at,
    };

    return {
      user,
      token,
      organization,
      membership,
      isNewUser: false,
    };
  }

  /**
   * Complete Google OAuth authorization callback.
   */
  static async handleGoogleCallback(
    code: string,
    state: string,
    ipAddress?: string
  ): Promise<{ auth: ExtendedAuthResponse; returnUrl: string; isNewUser: boolean }> {
    const statePayload = this.verifyGoogleState(state);
    const googleProfile = await this.exchangeGoogleCode(code);
    const authResult = await this.processGoogleUser(googleProfile, ipAddress);

    return {
      auth: authResult,
      returnUrl: statePayload.returnUrl || '/app',
      isNewUser: authResult.isNewUser,
    };
  }
}

