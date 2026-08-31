import { Request, Response, NextFunction } from 'express';
import { Permission, hasPermission } from '@onceclic/shared';

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.membership) {
      return res.status(403).json({ success: false, error: 'No organization membership context found.' });
    }

    const allowed = hasPermission(req.membership.role, permission);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: Insufficient permissions. Role '${req.membership.role}' lacks '${permission}'.`,
      });
    }

    next();
  };
}
