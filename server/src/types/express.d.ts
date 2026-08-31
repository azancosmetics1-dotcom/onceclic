import { User, OrganizationMembership, UserRole } from '@onceclic/shared';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        fullName: string;
      };
      organizationId?: string;
      membership?: {
        id: string;
        organizationId: string;
        userId: string;
        role: UserRole;
      };
    }
  }
}
