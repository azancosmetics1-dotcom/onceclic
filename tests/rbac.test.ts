import { UserRole, hasPermission, ROLE_PERMISSIONS } from '@onceclic/shared';

export async function runRBACTests() {
  console.log('--- Running Centralized RBAC Permission Tests ---');

  // 1. OWNER Tests
  if (!hasPermission(UserRole.OWNER, 'billing:manage')) {
    throw new Error('OWNER should have billing:manage permission.');
  }
  if (!hasPermission(UserRole.OWNER, 'org:manage')) {
    throw new Error('OWNER should have org:manage permission.');
  }
  if (!hasPermission(UserRole.OWNER, 'ai:manage')) {
    throw new Error('OWNER should have ai:manage permission.');
  }
  if (!hasPermission(UserRole.OWNER, 'analytics:read')) {
    throw new Error('OWNER should have analytics:read permission.');
  }
  if (!hasPermission(UserRole.OWNER, 'integrations:manage')) {
    throw new Error('OWNER should have integrations:manage permission.');
  }
  console.log('  ✓ OWNER role has full administrative, analytics, and billing access');

  // 2. MANAGER Tests
  if (hasPermission(UserRole.MANAGER, 'billing:manage')) {
    throw new Error('MANAGER should NOT have billing:manage permission.');
  }
  if (hasPermission(UserRole.MANAGER, 'integrations:manage')) {
    throw new Error('MANAGER should NOT have integrations:manage permission.');
  }
  if (!hasPermission(UserRole.MANAGER, 'analytics:read')) {
    throw new Error('MANAGER should have analytics:read permission.');
  }
  if (!hasPermission(UserRole.MANAGER, 'integrations:read')) {
    throw new Error('MANAGER should have integrations:read permission.');
  }
  if (!hasPermission(UserRole.MANAGER, 'ai:manage')) {
    throw new Error('MANAGER should have ai:manage permission.');
  }
  if (!hasPermission(UserRole.MANAGER, 'conversations:manage')) {
    throw new Error('MANAGER should have conversations:manage permission.');
  }
  console.log('  ✓ MANAGER role can configure AI & inbox, read analytics, but is blocked from billing & integration management');

  // 3. EMPLOYEE Tests
  if (hasPermission(UserRole.EMPLOYEE, 'ai:manage')) {
    throw new Error('EMPLOYEE should NOT have ai:manage permission.');
  }
  if (hasPermission(UserRole.EMPLOYEE, 'billing:manage')) {
    throw new Error('EMPLOYEE should NOT have billing:manage permission.');
  }
  if (hasPermission(UserRole.EMPLOYEE, 'integrations:manage')) {
    throw new Error('EMPLOYEE should NOT have integrations:manage permission.');
  }
  if (!hasPermission(UserRole.EMPLOYEE, 'appointments:manage')) {
    throw new Error('EMPLOYEE should have appointments:manage permission.');
  }
  if (!hasPermission(UserRole.EMPLOYEE, 'conversations:manage')) {
    throw new Error('EMPLOYEE should have conversations:manage permission.');
  }
  console.log('  ✓ EMPLOYEE role has operational inbox/appointment access, with admin features blocked');
}
