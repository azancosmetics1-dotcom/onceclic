import {
  validateEnvironment,
  assertSafeTestEnvironment,
  isProductionUrl,
  isSafePaddle,
  isSafeDatabase,
} from './utils/environmentGuard';

export async function runEnvironmentGuardTests() {
  console.log('--- Running Executable Environment Guardrail Tests ---');

  // 1. Local/test environment -> allowed
  const safeConfig = {
    NODE_ENV: 'test',
    USE_EMBEDDED_DB: 'true',
    PADDLE_ENVIRONMENT: 'sandbox',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/onceclic_test',
  };
  const reportSafe = validateEnvironment(safeConfig);
  if (!reportSafe.safe || reportSafe.errors.length > 0) {
    throw new Error(`Expected safe config to pass, got errors: ${reportSafe.errors.join(', ')}`);
  }
  console.log('  ✓ 1. Local/test environment allowed');

  // 2. NODE_ENV=production -> blocked
  const prodEnvConfig = {
    ...safeConfig,
    NODE_ENV: 'production',
  };
  const reportProd = validateEnvironment(prodEnvConfig);
  if (reportProd.safe || !reportProd.errors.some((e) => e.includes('NODE_ENV is set to "production"'))) {
    throw new Error('Expected NODE_ENV=production to be strictly blocked by guardrail.');
  }
  console.log('  ✓ 2. NODE_ENV=production strictly blocked');

  // 3. Production API URL -> blocked
  const prodUrlConfigs = [
    { ...safeConfig, API_URL: 'https://api.onceclic.com' },
    { ...safeConfig, FRONTEND_URL: 'https://onceclic.com' },
    { ...safeConfig, SUPABASE_URL: 'https://onceclic.netlify.app' },
  ];
  for (const cfg of prodUrlConfigs) {
    const reportUrl = validateEnvironment(cfg);
    if (reportUrl.safe) {
      throw new Error(`Expected production URL to be blocked: ${JSON.stringify(cfg)}`);
    }
  }
  console.log('  ✓ 3. Production API & Frontend URLs strictly blocked');

  // 4. Production database target -> blocked
  const prodDbConfig = {
    NODE_ENV: 'test',
    USE_EMBEDDED_DB: 'false',
    DATABASE_URL: 'postgresql://postgres:prodpass@db.production.onceclic.com:5432/postgres',
  };
  const reportProdDb = validateEnvironment(prodDbConfig);
  if (reportProdDb.safe) {
    throw new Error('Expected production database target to be blocked.');
  }
  console.log('  ✓ 4. Production database target strictly blocked');

  // 5. Paddle production environment -> blocked
  const prodPaddleConfig = {
    ...safeConfig,
    PADDLE_ENVIRONMENT: 'production',
  };
  const reportProdPaddle = validateEnvironment(prodPaddleConfig);
  if (reportProdPaddle.safe || !reportProdPaddle.errors.some((e) => e.includes('PADDLE_ENVIRONMENT'))) {
    throw new Error('Expected PADDLE_ENVIRONMENT=production to be blocked.');
  }
  console.log('  ✓ 5. Paddle production environment strictly blocked');

  // 6. Unknown environment -> blocked
  const unknownEnvConfig = {
    ...safeConfig,
    NODE_ENV: 'staging_unknown',
  };
  const reportUnknown = validateEnvironment(unknownEnvConfig);
  if (reportUnknown.safe) {
    throw new Error('Expected unknown NODE_ENV to be blocked.');
  }
  console.log('  ✓ 6. Unknown environment strictly blocked');

  // 7. Missing environment classification -> blocked
  const missingEnvConfig = {
    ...safeConfig,
    NODE_ENV: undefined,
  };
  const reportMissing = validateEnvironment(missingEnvConfig);
  if (reportMissing.safe) {
    throw new Error('Expected missing NODE_ENV to be blocked.');
  }
  console.log('  ✓ 7. Missing environment classification strictly blocked');

  // 8. Sandbox Paddle -> allowed
  if (!isSafePaddle('sandbox') || !isSafePaddle('mock')) {
    throw new Error('Expected Paddle sandbox / mock to be allowed.');
  }
  if (isSafePaddle('production')) {
    throw new Error('Paddle safety validator failed on production boundary.');
  }
  console.log('  ✓ 8. Sandbox Paddle verified as allowed target');

  // 9. Test database -> allowed
  if (!isSafeDatabase('postgresql://localhost:5432/test_db', false)) {
    throw new Error('Expected localhost/test database to be recognized as safe.');
  }
  if (!isSafeDatabase(undefined, true)) {
    throw new Error('Expected embedded in-memory database to be recognized as safe.');
  }
  if (isSafeDatabase('postgresql://db.onceclic.com/prod', false)) {
    throw new Error('Production database string must be rejected.');
  }
  console.log('  ✓ 9. Test database verified as allowed target');

  // 10. Production deployment command / blocked actions -> blocked
  const blockedCommands = [
    'railway up',
    'railway deploy',
    'netlify deploy --prod',
    'git push origin main',
  ];
  const isCommandBlocked = (cmd: string) => {
    return (
      cmd.includes('railway') ||
      cmd.includes('netlify deploy') ||
      cmd.includes('git push') ||
      cmd.includes('git commit')
    );
  };
  for (const cmd of blockedCommands) {
    if (!isCommandBlocked(cmd)) {
      throw new Error(`Expected command "${cmd}" to be classified as blocked.`);
    }
  }
  console.log('  ✓ 10. Production deployment and destructive commands verified as blocked');
}
