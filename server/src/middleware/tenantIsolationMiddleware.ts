import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { UserRole } from '@onceclic/shared';

export async function tenantIsolationMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required before tenant resolution.' });
    }

    // Tenant can be specified via header or query or route params
    const requestedOrgId = (req.headers['x-organization-id'] as string) || req.params.organizationId || (req.body && req.body.organizationId);

    let membership: any = null;

    if (requestedOrgId) {
      // Strictly verify that the authenticated user is indeed a member of requested organization
      membership = await db.getOne(
        'SELECT id, organization_id, user_id, role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
        [req.user.id, requestedOrgId]
      );

      if (!membership) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. You do not belong to the requested organization.',
        });
      }
    } else {
      // If no specific org was requested, fetch user's first/primary organization
      membership = await db.getOne(
        'SELECT id, organization_id, user_id, role FROM organization_memberships WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
        [req.user.id]
      );

      if (!membership) {
        return res.status(404).json({
          success: false,
          error: 'No active organization found for this user. Please complete onboarding.',
        });
      }
    }

    req.organizationId = membership.organization_id;
    req.membership = {
      id: membership.id,
      organizationId: membership.organization_id,
      userId: membership.user_id,
      role: membership.role as UserRole,
    };

    next();
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Failed to resolve organization context.' });
  }
}
