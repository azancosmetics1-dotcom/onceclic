import assert from 'assert';
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

/**
 * PostgreSQL Multi-Connection Concurrency & Race Condition Integration Test Suite
 * 
 * Verifies real PostgreSQL row-level write locks, tuple fencing, and atomic conditional updates
 * using independent database connections (clientA and clientB).
 * 
 * SAFETY RULE: Never connects to production. Requires an explicit, safe TEST_DATABASE_URL.
 */
export async function runPostgresConcurrencyIntegrationTests(): Promise<{ ran: boolean; passed: boolean; message: string }> {
  console.log('--- Checking PostgreSQL Multi-Connection Integration Test Environment ---');

  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRES_TEST_URL;

  if (!testDbUrl) {
    const msg = 'Safe staging/test PostgreSQL database not configured (TEST_DATABASE_URL is not set). Skipping real PostgreSQL integration test to protect production.';
    console.log(`  [SKIP] ${msg}`);
    return { ran: false, passed: true, message: msg };
  }

  // Strict safety check: Block any URL pointing to production or live Supabase
  const lowerUrl = testDbUrl.toLowerCase();
  if (
    lowerUrl.includes('supabase.co') ||
    lowerUrl.includes('pooler.supabase.com') ||
    lowerUrl.includes('onceclic.com') ||
    lowerUrl.includes('prod')
  ) {
    throw new Error('TEST_DATABASE_URL points to a production or live remote database. Execution strictly blocked.');
  }

  console.log('--- Running PostgreSQL Multi-Connection Concurrency Integration Tests ---');
  const pool = new Pool({
    connectionString: testDbUrl,
    max: 5,
    idleTimeoutMillis: 5000,
  });

  let clientA: PoolClient | null = null;
  let clientB: PoolClient | null = null;

  try {
    clientA = await pool.connect();
    clientB = await pool.connect();

    const uniqueSuffix = Date.now().toString();
    const testOrgId = uuidv4();

    // Setup test organization
    await clientA.query(
      `INSERT INTO organizations (id, name, slug, industry, created_at, updated_at)
       VALUES ($1, 'Postgres Concurrency Dental', $2, 'clinic', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [testOrgId, `concurrency_dental_${uniqueSuffix}`]
    );

    // -------------------------------------------------------------------------
    // TEST 1: Renewal checkout racing against phone release
    // -------------------------------------------------------------------------
    const phone1Id = uuidv4();
    const phone1 = `+14155554001`;
    await clientA.query(
      `INSERT INTO voice_phone_numbers (
         id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
         billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
         customer_monthly_cost_usd, created_at, updated_at
       ) VALUES (
         $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
         'SUSPENDED_GRACE_PERIOD', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
      [phone1Id, testOrgId, phone1]
    );

    // Client A (Worker) claims lease
    const leaseExpires = new Date(Date.now() + 600000).toISOString();
    const claimRes = await clientA.query(
      `UPDATE voice_phone_numbers
       SET release_worker_id = 'worker_conn_A',
           release_locked_until = $1,
           release_status = 'RELEASE_IN_PROGRESS',
           status = 'RELEASE_IN_PROGRESS',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND (
           release_status IN ('RELEASE_PENDING', 'RELEASE_FAILED')
           OR (release_status = 'RELEASE_IN_PROGRESS' AND release_locked_until <= CURRENT_TIMESTAMP)
         )
         AND (release_locked_until IS NULL OR release_locked_until <= CURRENT_TIMESTAMP)
         AND (creem_subscription_id IS NULL OR billing_status != 'ACTIVE')
         AND status != 'ACTIVE'`,
      [leaseExpires, phone1Id]
    );
    assert.equal(claimRes.rowCount, 1, 'Client A must acquire lease');

    // Client B (Renewal) attempts fulfillment conditionally on independent connection
    const renewRes = await clientB.query(
      `UPDATE voice_phone_numbers
       SET status = 'ACTIVE',
           provisioning_status = 'ACTIVE',
           billing_status = 'ACTIVE',
           release_status = 'NOT_RELEASED',
           release_worker_id = NULL,
           release_locked_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2
         AND (release_status IS NULL OR release_status NOT IN ('RELEASE_IN_PROGRESS', 'RELEASED', 'RELEASE_FAILED_MANUAL_ATTENTION'))`,
      [phone1Id, testOrgId]
    );
    assert.equal(renewRes.rowCount, 0, 'Client B renewal must be blocked by conditional WHERE clause');
    console.log('  ✓ 1. Real PostgreSQL: Release claim strictly blocks concurrent renewal fulfillment');

    // -------------------------------------------------------------------------
    // TEST 2: subscription.paid racing against RELEASE_IN_PROGRESS
    // -------------------------------------------------------------------------
    const phone2Id = uuidv4();
    const phone2 = `+14155554002`;
    const sub2Id = `sub_pg_race_${uniqueSuffix}`;
    await clientA.query(
      `INSERT INTO voice_phone_numbers (
         id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
         billing_status, release_status, creem_subscription_id, is_retained, monthly_cost_usd,
         customer_monthly_cost_usd, created_at, updated_at
       ) VALUES (
         $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
         'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', $4, TRUE, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
      [phone2Id, testOrgId, phone2, sub2Id]
    );

    // Client B receives subscription.paid webhook and executes atomic conditional update
    const webhookRestoreRes = await clientB.query(
      `UPDATE voice_phone_numbers
       SET status = 'ACTIVE',
           provisioning_status = 'ACTIVE',
           billing_status = 'ACTIVE',
           release_status = 'NOT_RELEASED',
           release_worker_id = NULL,
           release_locked_until = NULL,
           is_retained = FALSE,
           retention_ends_at = NULL,
           rental_ends_at = NULL,
           cancel_at_period_end = FALSE,
           release_attempts = 0,
           next_release_attempt_at = NULL,
           release_error = NULL,
           last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE creem_subscription_id = $1
         AND (release_status IS NULL OR release_status NOT IN ('RELEASE_IN_PROGRESS', 'RELEASED', 'RELEASE_FAILED_MANUAL_ATTENTION'))`,
      [sub2Id]
    );
    assert.equal(webhookRestoreRes.rowCount, 0, 'Atomic conditional query must reject reactivation when RELEASE_IN_PROGRESS');
    console.log('  ✓ 2. Real PostgreSQL: subscription.paid atomic update safely rejects reactivation');

    // -------------------------------------------------------------------------
    // TEST 3: Concurrent release workers claiming the same number
    // -------------------------------------------------------------------------
    const phone3Id = uuidv4();
    const phone3 = `+14155554003`;
    await clientA.query(
      `INSERT INTO voice_phone_numbers (
         id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
         billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
         customer_monthly_cost_usd, created_at, updated_at
       ) VALUES (
         $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
         'SUSPENDED_GRACE_PERIOD', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
      [phone3Id, testOrgId, phone3]
    );

    // Simultaneously fire claims from Connection A and Connection B
    const claimQuery = `UPDATE voice_phone_numbers
       SET release_worker_id = $1,
           release_locked_until = $2,
           release_status = 'RELEASE_IN_PROGRESS',
           status = 'RELEASE_IN_PROGRESS',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
         AND (
           release_status IN ('RELEASE_PENDING', 'RELEASE_FAILED')
           OR (release_status = 'RELEASE_IN_PROGRESS' AND release_locked_until <= CURRENT_TIMESTAMP)
         )
         AND (release_locked_until IS NULL OR release_locked_until <= CURRENT_TIMESTAMP)
         AND (creem_subscription_id IS NULL OR billing_status != 'ACTIVE')
         AND status != 'ACTIVE'`;

    const [claimResA, claimResB] = await Promise.all([
      clientA.query(claimQuery, ['worker_parallel_A', leaseExpires, phone3Id]),
      clientB.query(claimQuery, ['worker_parallel_B', leaseExpires, phone3Id]),
    ]);

    const successfulClaims = (claimResA.rowCount || 0) + (claimResB.rowCount || 0);
    assert.equal(successfulClaims, 1, 'Exactly one concurrent worker must win the row lock and claim lease');
    console.log('  ✓ 3. Real PostgreSQL: Row-level write lock serializes concurrent worker claims (1 winner, 1 loser)');

    // -------------------------------------------------------------------------
    // TEST 4: Refund reconciliation with duplicate webhook delivery
    // -------------------------------------------------------------------------
    const eventId = `evt_pg_dup_${uniqueSuffix}`;
    const insertEventQuery = `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
       VALUES ($1, 'refund.created', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

    await clientA.query(insertEventQuery, [eventId]);

    let duplicateCaught = false;
    try {
      await clientB.query(insertEventQuery, [eventId]);
    } catch (pgErr: any) {
      if (pgErr.code === '23505' || pgErr.message?.includes('duplicate key') || pgErr.message?.includes('uq_processed_events')) {
        duplicateCaught = true;
      } else {
        throw pgErr;
      }
    }
    assert.equal(duplicateCaught, true, 'PostgreSQL unique constraint must throw 23505 on duplicate webhook');
    console.log('  ✓ 4. Real PostgreSQL: Unique index on processed_webhook_events strictly blocks duplicate delivery');

    // -------------------------------------------------------------------------
    // TEST 5: Late payment after number release has completed
    // -------------------------------------------------------------------------
    const phone5Id = uuidv4();
    const phone5 = `+14155554005`;
    const sub5Id = `sub_released_${uniqueSuffix}`;
    await clientA.query(
      `INSERT INTO voice_phone_numbers (
         id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
         billing_status, release_status, creem_subscription_id, is_retained, monthly_cost_usd,
         customer_monthly_cost_usd, created_at, updated_at
       ) VALUES (
         $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASED', 'INACTIVE',
         'CANCELED', 'RELEASED', $4, FALSE, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
      [phone5Id, testOrgId, phone5, sub5Id]
    );

    // Client B attempts late renewal
    const latePayRes = await clientB.query(
      `UPDATE voice_phone_numbers
       SET status = 'ACTIVE',
           provisioning_status = 'ACTIVE',
           billing_status = 'ACTIVE',
           release_status = 'NOT_RELEASED',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2
         AND (release_status IS NULL OR release_status NOT IN ('RELEASE_IN_PROGRESS', 'RELEASED', 'RELEASE_FAILED_MANUAL_ATTENTION'))`,
      [phone5Id, testOrgId]
    );
    assert.equal(latePayRes.rowCount, 0, 'Late payment must not reactivate a RELEASED number');

    const verifyFinal = await clientA.query(
      `SELECT status, release_status FROM voice_phone_numbers WHERE id = $1`,
      [phone5Id]
    );
    assert.equal(verifyFinal.rows[0].status, 'RELEASED', 'Status must remain RELEASED');
    assert.equal(verifyFinal.rows[0].release_status, 'RELEASED', 'Release status must remain RELEASED');
    console.log('  ✓ 5. Real PostgreSQL: Released numbers remain strictly locked against late reactivations');

    console.log('\n=======================================================================');
    console.log('  ALL POSTGRESQL MULTI-CONNECTION INTEGRATION TESTS PASSED (5/5)!');
    console.log('=======================================================================\n');

    return { ran: true, passed: true, message: 'All 5 PostgreSQL multi-connection concurrency tests passed successfully.' };
  } finally {
    if (clientA) clientA.release();
    if (clientB) clientB.release();
    await pool.end();
  }
}

if (require.main === module) {
  runPostgresConcurrencyIntegrationTests()
    .then((res) => {
      if (!res.ran) {
        console.log(`[INFO] ${res.message}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ POSTGRES INTEGRATION TEST FAILURE:', err);
      process.exit(1);
    });
}

