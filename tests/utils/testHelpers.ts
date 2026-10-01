/**
 * ONCEClic Test Helpers
 *
 * Shared utilities for test files. Provides a single helper that registers a user
 * AND completes onboarding (industry + knowledge), which is now required before
 * the 7-day trial is activated.
 *
 * This keeps test files DRY and ensures they work correctly with the updated
 * signup flow where:
 *   REGISTER → VERIFY EMAIL (skipped in tests) → COMPLETE ONBOARDING → TRIAL STARTS
 */

import { AuthService } from '../../server/src/services/AuthService';

export interface RegisterAndOnboardResult {
  user: { id: string; email: string; fullName: string };
  organization: { id: string; name: string; slug: string };
}

/**
 * Register a new user and immediately complete their onboarding with the given
 * industry and business knowledge. Returns the user and organization objects.
 *
 * @param params.email        Unique email for this test run
 * @param params.password     Password (default: 'password123')
 * @param params.fullName     Owner's full name
 * @param params.businessName Business / organization name
 * @param params.industry     Industry type (e.g. 'Restaurant', 'Clinic', 'Salon')
 * @param params.knowledge    Business knowledge text (min 15 chars)
 */
export async function registerAndOnboard(params: {
  email: string;
  password?: string;
  fullName: string;
  businessName: string;
  industry?: string;
  knowledge?: string;
}): Promise<RegisterAndOnboardResult> {
  const {
    email,
    password = 'password123',
    fullName,
    businessName,
    industry = 'Restaurant',
    knowledge = `${businessName} is open Monday to Friday 9 AM to 6 PM. Located at 1 Test Street. Contact us at info@test.com.`,
  } = params;

  const reg = await AuthService.register({ email, password, fullName, businessName });

  await AuthService.completeOnboarding({
    userId: reg.user.id,
    organizationId: reg.organization!.id,
    industry,
    businessKnowledge: knowledge,
  });

  return {
    user: reg.user,
    organization: reg.organization!,
  };
}
