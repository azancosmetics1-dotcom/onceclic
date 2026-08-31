import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { db } from '../db';
import { UserRole } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// Get current organization details and business settings
router.get('/current', async (req: Request, res: Response, next) => {
  try {
    const org = await db.getOne(
      `SELECT id, name, slug, business_type as "businessType", phone, email, website,
              address, timezone, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
       FROM organizations WHERE id = $1`,
      [req.organizationId]
    );

    const settings = await db.getOne(
      `SELECT id, business_hours as "businessHours", services, cancellation_policy as "cancellationPolicy",
              contact_instructions as "contactInstructions", website_chat_enabled as "websiteChatEnabled",
              email_answering_enabled as "emailAnsweringEnabled"
       FROM business_settings WHERE organization_id = $1`,
      [req.organizationId]
    );

    if (settings) {
      settings.businessHours = typeof settings.businessHours === 'string' ? JSON.parse(settings.businessHours) : settings.businessHours;
      settings.services = typeof settings.services === 'string' ? JSON.parse(settings.services) : settings.services;
    }

    res.json({
      success: true,
      data: {
        organization: org,
        settings,
        role: req.membership?.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update organization profile and business settings
router.put('/current', requirePermission('settings:manage'), async (req: Request, res: Response, next) => {
  try {
    const { name, businessType, phone, email, website, address, timezone, businessHours, services, cancellationPolicy, contactInstructions, websiteChatEnabled, emailAnsweringEnabled } = req.body;

    // Update organization
    await db.execute(
      `UPDATE organizations
       SET name = COALESCE($1, name),
           business_type = COALESCE($2, business_type),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           website = COALESCE($5, website),
           address = COALESCE($6, address),
           timezone = COALESCE($7, timezone),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [name, businessType, phone, email, website, address, timezone, req.organizationId]
    );

    // Update settings
    await db.execute(
      `UPDATE business_settings
       SET business_hours = COALESCE($1, business_hours),
           services = COALESCE($2, services),
           cancellation_policy = COALESCE($3, cancellation_policy),
           contact_instructions = COALESCE($4, contact_instructions),
           website_chat_enabled = COALESCE($5, website_chat_enabled),
           email_answering_enabled = COALESCE($6, email_answering_enabled),
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $7`,
      [
        businessHours ? JSON.stringify(businessHours) : null,
        services ? JSON.stringify(services) : null,
        cancellationPolicy,
        contactInstructions,
        websiteChatEnabled,
        emailAnsweringEnabled,
        req.organizationId,
      ]
    );

    res.json({ success: true, message: 'Business profile updated successfully.' });
  } catch (err) {
    next(err);
  }
});

// Get members
router.get('/members', requirePermission('org:read'), async (req: Request, res: Response, next) => {
  try {
    const membersRes = await db.query(
      `SELECT om.id, om.role, om.created_at as "createdAt",
              u.id as "userId", u.email, u.full_name as "fullName"
       FROM organization_memberships om
       JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY om.created_at ASC`,
      [req.organizationId]
    );

    res.json({ success: true, data: membersRes.rows });
  } catch (err) {
    next(err);
  }
});

// Invite / Add a member
router.post('/members', requirePermission('org:manage'), async (req: Request, res: Response, next) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ success: false, error: 'Email and role are required.' });
    }

    let user = await db.getOne('SELECT id, email, full_name FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User with this email not found. Please have them register first.' });
    }

    // Check existing membership
    const existing = await db.getOne(
      'SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [req.organizationId, user.id]
    );

    if (existing) {
      return res.status(400).json({ success: false, error: 'User is already a member of this organization.' });
    }

    await db.execute(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [uuidv4(), req.organizationId, user.id, role as UserRole]
    );

    res.status(201).json({ success: true, message: 'Member added successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
