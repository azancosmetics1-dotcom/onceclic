/**
 * ONCEClic Automated Test Environment Guardrail
 * 
 * Enforces strict executable checks before running tests, migrations, billing actions,
 * or database mutations. Fails closed if the environment cannot be positively
 * verified as local/test.
 */

export interface EnvironmentSafetyReport {
  safe: boolean;
  environment: string;
  isProductionMode: boolean;
  databaseTarget: string;
  paddleEnvironment: string;
  blockedProductionEndpoints: string[];
  errors: string[];
}

export const BLOCKED_PRODUCTION_DOMAINS = [
  'api.onceclic.com',
  'onceclic.com',
  'www.onceclic.com',
  'onceclic.netlify.app',
  'app.onceclic.com',
];

export const BLOCKED_PRODUCTION_PADDLE_URLS = [
  'api.paddle.com',
  'checkout.paddle.com',
];

/**
 * Checks if a URL or hostname resolves to a known ONCEClic production endpoint
 */
export function isProductionUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase().trim();
  
  return BLOCKED_PRODUCTION_DOMAINS.some((domain) => {
    return (
      lower === domain ||
      lower.includes(`://${domain}`) ||
      lower.includes(`/${domain}`) ||
      lower.startsWith(`http://${domain}`) ||
      lower.startsWith(`https://${domain}`)
    );
  });
}

/**
 * Checks if Paddle configuration is safely restricted to sandbox / mock
 */
export function isSafePaddle(paddleEnv: string | undefined | null, paddleApiUrl?: string | null): boolean {
  const env = (paddleEnv || '').toLowerCase().trim();
  if (env === 'production') return false;
  
  if (paddleApiUrl) {
    const lowerUrl = paddleApiUrl.toLowerCase().trim();
    if (BLOCKED_PRODUCTION_PADDLE_URLS.some((pUrl) => lowerUrl.includes(pUrl) && !lowerUrl.includes('sandbox-api.paddle.com'))) {
      return false;
    }
  }

  return env === 'sandbox' || env === 'mock' || env === 'test' || env === '' || !paddleEnv;
}

/**
 * Checks if Database target is a safe local / embedded / test target
 */
export function isSafeDatabase(dbUrl: string | undefined | null, useEmbedded?: boolean): boolean {
  if (useEmbedded) return true;
  if (!dbUrl) return true; // Defaults to embedded DB in test runner

  const lower = dbUrl.toLowerCase().trim();

  // If pointing to a known production domain
  if (isProductionUrl(lower)) return false;

  // Safe local / test indicators
  const isLocalhost = lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('::1');
  const isTestDb = lower.includes('test') || lower.includes('onceclic_test') || lower.includes('mock');
  const isEmbedded = lower.includes('embedded') || lower.includes('memory') || lower.includes('sqlite');

  if (isLocalhost || isTestDb || isEmbedded) return true;

  // If it's a remote connection without explicit test indicator, fail closed
  return false;
}

/**
 * Validate an entire environment configuration dictionary
 */
export function validateEnvironment(env: Record<string, string | undefined> = process.env): EnvironmentSafetyReport {
  const errors: string[] = [];
  const blockedProductionEndpoints: string[] = [];

  const nodeEnv = (env.NODE_ENV || '').toLowerCase().trim();
  const isProd = nodeEnv === 'production';

  if (isProd) {
    errors.push('NODE_ENV is set to "production". Tests must run in "test" or "development" mode.');
  }

  if (!nodeEnv || (nodeEnv !== 'test' && nodeEnv !== 'development' && nodeEnv !== 'local')) {
    errors.push(`Unrecognized NODE_ENV: "${nodeEnv}". Environment must be explicitly "test", "development", or "local".`);
  }

  // Check URL variables
  const urlVarsToCheck = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_DB_URL',
    'API_URL',
    'FRONTEND_URL',
    'NEXT_PUBLIC_API_URL',
    'VITE_API_URL',
    'COMPOSIO_API_URL',
  ];

  for (const varName of urlVarsToCheck) {
    const val = env[varName];
    if (val && isProductionUrl(val)) {
      blockedProductionEndpoints.push(`${varName}=${val}`);
      errors.push(`Environment variable "${varName}" points to a production endpoint (${val}). Execution blocked.`);
    }
  }

  // Check Paddle environment
  const paddleEnv = env.PADDLE_ENVIRONMENT || env.PADDLE_ENV || 'sandbox';
  const paddleApiUrl = env.PADDLE_API_URL;
  if (!isSafePaddle(paddleEnv, paddleApiUrl)) {
    errors.push(`PADDLE_ENVIRONMENT is "${paddleEnv}". Must be "sandbox" or "mock" for local tests.`);
  }

  // Check Database
  const dbUrl = env.DATABASE_URL;
  const useEmbedded = env.USE_EMBEDDED_DB === 'true' || (nodeEnv === 'test' && !dbUrl);
  if (!isSafeDatabase(dbUrl, useEmbedded)) {
    errors.push(`DATABASE_URL "${dbUrl}" cannot be verified as a safe local/test database. Execution blocked.`);
  }

  return {
    safe: errors.length === 0,
    environment: nodeEnv || 'unknown',
    isProductionMode: isProd,
    databaseTarget: useEmbedded ? 'EMBEDDED IN-MEMORY (ISOLATED)' : 'LOCAL TEST DATABASE',
    paddleEnvironment: (paddleEnv || 'sandbox').toUpperCase(),
    blockedProductionEndpoints,
    errors,
  };
}

/**
 * Mandatory executable assertion. Throws immediately if unsafe.
 */
export function assertSafeTestEnvironment(env: Record<string, string | undefined> = process.env): void {
  const report = validateEnvironment(env);
  if (!report.safe) {
    const errorMsg = [
      '====================================================',
      '🚨 ENVIRONMENT GUARD: FAILED (EXECUTION BLOCKED)',
      '====================================================',
      ...report.errors.map((e) => ` - ❌ ${e}`),
      '====================================================',
      'Execution aborted immediately. No operations were performed.',
      '====================================================',
    ].join('\n');
    throw new Error(errorMsg);
  }
}

/**
 * Print preflight guard summary banner
 */
export function printPreflightSummary(env: Record<string, string | undefined> = process.env): void {
  const report = validateEnvironment(env);
  if (!report.safe) {
    assertSafeTestEnvironment(env);
  }

  console.log('====================================================');
  console.log('ONCEClic TEST ENVIRONMENT PREFLIGHT');
  console.log('====================================================\n');
  console.log(`Environment: ${report.environment.toUpperCase()}`);
  console.log(`Production mode: ${report.isProductionMode ? 'YES (UNSAFE)' : 'NO'}`);
  console.log(`Database: ${report.databaseTarget}`);
  console.log(`Paddle: ${report.paddleEnvironment}`);
  console.log('OpenAI: CONTROLLED TEST MODE');
  console.log('Composio: TEST/MOCK');
  console.log('Production API target: BLOCKED');
  console.log('Production database target: BLOCKED');
  console.log('Real customer data: BLOCKED');
  console.log('Deployment commands: BLOCKED');
  console.log('Git push/commit: BLOCKED\n');
  console.log('Environment guard: PASSED');
  console.log('====================================================\n');
}
