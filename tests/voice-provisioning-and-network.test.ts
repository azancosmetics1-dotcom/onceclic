process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';

import assert from 'assert';
import { db } from '../server/src/db';
import { VoiceAssistantProvisioningService } from '../server/src/services/voice/VoiceAssistantProvisioningService';
import { SafeIpValidator, SafeNetworkClient, SafeNetworkResponse } from '../server/src/services/voice/SafeNetworkClient';
import { MockVoiceProvider } from '../server/src/services/voice/MockVoiceProvider';
import { runVoiceBackfillCli, isLocalDatabaseUrl } from '../server/src/scripts/voice-backfill';
import { VapiVoiceProvider } from '../server/src/services/voice/VapiVoiceProvider';
import { TelnyxTelephonyProvider } from '../server/src/services/voice/TelnyxTelephonyProvider';
import { RetellVoiceProvider } from '../server/src/services/voice/RetellVoiceProvider';

class HttpError extends Error {
  status?: number;
  statusCode?: number;
}

function mockJsonResponse<T>(data: T): SafeNetworkResponse['json'] {
  const serialized = JSON.stringify(data ?? {});
  return async () => JSON.parse(serialized);
}

export async function runVoiceProvisioningAndNetworkTests() {
  console.log('--- Running Voice Provisioning, Concurrency, and Network Security (Prompt 2 Remediation) Tests ---');

  const prefix = `test_p2_${Date.now()}`;

  async function createTestOrg(orgId: string, name: string) {
    await db.execute(
      `INSERT INTO organizations (id, name, slug, business_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'HEALTHCARE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [orgId, name, `slug-${orgId}`]
    );
  }

  async function createTestLine(lineId: string, orgId: string, phone: string, asstId: string | null = null) {
    await db.execute(
      `INSERT INTO voice_phone_numbers (
         id, organization_id, phone_number, vapi_assistant_id, sync_status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [lineId, orgId, phone, asstId]
    );
  }

  // =========================================================================
  // Test 1: One Organization, One Phone Line Provisioning & Synchronization
  // =========================================================================
  const org1 = `${prefix}_org1`;
  await createTestOrg(org1, 'Org 1 Single Line');
  await createTestLine(`${prefix}_line1`, org1, '+15551110001', null);

  const mockProvider = new MockVoiceProvider();
  const res1 = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org1, {
    customVoiceProvider: mockProvider,
  });

  assert.ok(res1.assistantId, 'Should return a valid assistant ID');
  assert.strictEqual(res1.isNew, true, 'Assistant should be newly created');

  const syncRes1 = await VoiceAssistantProvisioningService.synchronizePhoneLines(org1, res1.assistantId);
  assert.strictEqual(syncRes1.linesSynchronized, 1, 'Should synchronize 1 line');

  const line1Db = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line1`]);
  assert.strictEqual(line1Db.vapi_assistant_id, res1.assistantId, 'Line assistant should match canonical assistant');
  assert.strictEqual(line1Db.sync_status, 'SYNCHRONIZED', 'Line should be SYNCHRONIZED');
  console.log('  ✓ 1. One organization, one phone line provisioning & sync verified');

  // =========================================================================
  // Test 2: One Organization, Multiple Phone Lines Synchronization
  // =========================================================================
  const org2 = `${prefix}_org2`;
  await createTestOrg(org2, 'Org 2 Multi Line');
  await createTestLine(`${prefix}_line2_a`, org2, '+15551110002', null);
  await createTestLine(`${prefix}_line2_b`, org2, '+15551110003', null);
  await createTestLine(`${prefix}_line2_c`, org2, '+15551110004', null);

  const res2 = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org2, {
    customVoiceProvider: mockProvider,
  });

  const syncRes2 = await VoiceAssistantProvisioningService.synchronizePhoneLines(org2, res2.assistantId);
  assert.strictEqual(syncRes2.linesSynchronized, 3, 'All 3 lines should synchronize');

  const lines2Db = await db.query<any>('SELECT * FROM voice_phone_numbers WHERE organization_id = $1', [org2]);
  for (const l of lines2Db.rows) {
    assert.strictEqual(l.vapi_assistant_id, res2.assistantId, 'Each line references canonical assistant');
    assert.strictEqual(l.sync_status, 'SYNCHRONIZED');
  }
  console.log('  ✓ 2. One organization, multiple phone lines synchronization verified');

  // =========================================================================
  // Test 3: Concurrent Provisioning Attempts for the SAME Organization
  // =========================================================================
  const org3 = `${prefix}_org3`;
  await createTestOrg(org3, 'Org 3 Concurrency Same Org');

  // Launch 5 concurrent provisioning calls simultaneously
  const concurrentCalls = await Promise.all([
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org3, { customVoiceProvider: mockProvider }),
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org3, { customVoiceProvider: mockProvider }),
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org3, { customVoiceProvider: mockProvider }),
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org3, { customVoiceProvider: mockProvider }),
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org3, { customVoiceProvider: mockProvider }),
  ]);

  const firstAsstId = concurrentCalls[0].assistantId;
  for (const call of concurrentCalls) {
    assert.strictEqual(call.assistantId, firstAsstId, 'All concurrent callers must receive the exact same assistant ID');
  }

  const ovaRecords = await db.query<any>(
    'SELECT * FROM organization_voice_assistants WHERE organization_id = $1',
    [org3]
  );
  assert.strictEqual(ovaRecords.rows.length, 1, 'Exactly 1 canonical assistant record must exist (no duplicates)');
  assert.strictEqual(ovaRecords.rows[0].vapi_assistant_id, firstAsstId);
  console.log('  ✓ 3. Concurrent provisioning for same organization returned single canonical assistant');

  // =========================================================================
  // Test 4: Concurrent Attempts for DIFFERENT Organizations
  // =========================================================================
  const org4A = `${prefix}_org4_a`;
  const org4B = `${prefix}_org4_b`;
  const org4C = `${prefix}_org4_c`;
  await createTestOrg(org4A, 'Org 4A');
  await createTestOrg(org4B, 'Org 4B');
  await createTestOrg(org4C, 'Org 4C');

  const diffOrgCalls = await Promise.all([
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org4A, { customVoiceProvider: mockProvider }),
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org4B, { customVoiceProvider: mockProvider }),
    VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org4C, { customVoiceProvider: mockProvider }),
  ]);

  const asstSet = new Set(diffOrgCalls.map(c => c.assistantId));
  assert.strictEqual(asstSet.size, 3, 'Each distinct organization must receive its own distinct assistant');
  console.log('  ✓ 4. Concurrent attempts for different organizations isolated cleanly');

  // =========================================================================
  // Test 5: Active Lease Protection
  // =========================================================================
  const org5 = `${prefix}_org5`;
  await createTestOrg(org5, 'Org 5 Active Lease');
  const futureLease = new Date(Date.now() + 120000);
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, claim_token, claim_expires_at, created_at, updated_at
     ) VALUES ($1, 'CLAIMED', 'worker-active-token', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org5, futureLease.toISOString()]
  );

  const attemptClaim5 = await VoiceAssistantProvisioningService.acquireClaim(org5);
  assert.strictEqual(attemptClaim5.acquired, false, 'Cannot acquire claim when active lease is held by another worker');
  assert.strictEqual(attemptClaim5.existingStatus, 'CLAIMED');

  const ova5 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org5]);
  assert.strictEqual(ova5.claim_token, 'worker-active-token', 'Original claim token must remain untouched');
  console.log('  ✓ 5. Active lease protection confirmed: claim unavailable to second worker');

  // =========================================================================
  // Test 6: Expired CLAIMED Lease Transitions to RECONCILIATION_REQUIRED & Database Clock Renewal (Fix 1, 2 & 4)
  // =========================================================================
  const org6 = `${prefix}_org6`;
  await createTestOrg(org6, 'Org 6 Expired Lease Recovery');
  const pastLease = new Date(Date.now() - 60000);
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, claim_token, claim_expires_at, created_at, updated_at
     ) VALUES ($1, 'CLAIMED', 'dead-worker-token', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org6, pastLease.toISOString()]
  );

  // 6a: Expired CLAIMED lease transitions atomically to RECONCILIATION_REQUIRED using database time
  const attemptClaim6 = await VoiceAssistantProvisioningService.acquireClaim(org6);
  assert.strictEqual(attemptClaim6.acquired, false, 'Expired CLAIMED lease must NOT be blindly re-claimed');
  assert.strictEqual(attemptClaim6.existingStatus, 'RECONCILIATION_REQUIRED', 'Must return RECONCILIATION_REQUIRED status');

  const ova6 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org6]);
  assert.strictEqual(ova6.provisioning_status, 'RECONCILIATION_REQUIRED', 'DB status must be RECONCILIATION_REQUIRED');
  assert.strictEqual(ova6.claim_token, null, 'Claim token must be cleared');
  assert.strictEqual(ova6.claim_expires_at, null, 'Claim expires at must be cleared');

  // 6b: Subsequent automated requests fail closed to prevent duplicate assistant creation
  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org6);
    },
    /requires manual voice assistant reconciliation/,
    'Subsequent provisioning attempt must fail closed and block duplicate assistant creation'
  );

  // 6c: Database Clock Renewal Protection: Active lease can be renewed, expired lease cannot
  const org6c = `${prefix}_org6c`;
  await createTestOrg(org6c, 'Org 6c Renewal Race');
  const futureLease6c = new Date(Date.now() + 60000);
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, claim_token, claim_expires_at, created_at, updated_at
     ) VALUES ($1, 'CLAIMED', 'worker-a-token', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org6c, futureLease6c.toISOString()]
  );

  // Worker A successfully renews its active lease
  const renewSuccess = await VoiceAssistantProvisioningService.renewClaim(org6c, 'worker-a-token', 120);
  assert.strictEqual(renewSuccess, true, 'Worker A renewal of active lease succeeded');

  // Stale worker cannot renew an expired lease
  const org6c_exp = `${prefix}_org6c_exp`;
  await createTestOrg(org6c_exp, 'Org 6c Expired Renewal');
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, claim_token, claim_expires_at, created_at, updated_at
     ) VALUES ($1, 'CLAIMED', 'worker-exp-token', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org6c_exp, new Date(Date.now() - 30000).toISOString()]
  );
  const expiredRenew = await VoiceAssistantProvisioningService.renewClaim(org6c_exp, 'worker-exp-token', 120);
  assert.strictEqual(expiredRenew, false, 'Expired lease cannot be renewed (enforced via database clock claim_expires_at > CURRENT_TIMESTAMP)');

  // 6d: Competing workers on IDLE org: only one can acquire lease
  const org6d = `${prefix}_org6d`;
  await createTestOrg(org6d, 'Org 6d Competing Workers');
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, claim_token, claim_expires_at, created_at, updated_at
     ) VALUES ($1, 'IDLE', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org6d]
  );

  const [claimD1, claimD2] = await Promise.all([
    VoiceAssistantProvisioningService.acquireClaim(org6d),
    VoiceAssistantProvisioningService.acquireClaim(org6d),
  ]);
  const acquiredCount = (claimD1.acquired ? 1 : 0) + (claimD2.acquired ? 1 : 0);
  assert.strictEqual(acquiredCount, 1, 'Exactly one of two competing recovery workers must acquire the lease');

  // 6e: Stale worker cannot commit assistant ID
  const staleCommit = await VoiceAssistantProvisioningService.commitAssistant(org6d, 'invalid-stale-token', 'asst-stale');
  assert.strictEqual(staleCommit.committed, false, 'Stale worker cannot commit assistant ID');

  console.log('  ✓ 6. Expired CLAIMED lease fails closed to RECONCILIATION_REQUIRED & database clock renewal verified');

  // =========================================================================
  // Test 7: Stale Worker Fencing Prevents Unauthorized Commit
  // =========================================================================
  const org7 = `${prefix}_org7`;
  await createTestOrg(org7, 'Org 7 Fencing');
  const claim7A = await VoiceAssistantProvisioningService.acquireClaim(org7);
  assert.strictEqual(claim7A.acquired, true);

  // Worker B overtakes the claim
  const newExpiry = new Date(Date.now() + 120000);
  await db.execute(
    `UPDATE organization_voice_assistants
     SET claim_token = 'worker-b-token', claim_expires_at = $1
     WHERE organization_id = $2`,
    [newExpiry.toISOString(), org7]
  );

  // Worker A tries to commit with stale token
  const commit7A = await VoiceAssistantProvisioningService.commitAssistant(org7, claim7A.claimToken!, 'asst-stale-worker-a');
  assert.strictEqual(commit7A.committed, false, 'Stale worker commit must be rejected by fencing');

  const ova7 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org7]);
  assert.strictEqual(ova7.vapi_assistant_id, null, 'Stale assistant ID must NOT be persisted in database');
  console.log('  ✓ 7. Stale worker fencing prevented unauthorized commit');

  // =========================================================================
  // Test 8: Concrete Race: Stale Worker Fencing & Orphan Durability (Audit 1 & Fix 1)
  // 1. Worker A creates external assistant
  // 2. Worker A loses its lease
  // 3. Worker B obtains claim and commits canonical assistant as READY
  // 4. Worker A attempts commit / reconciliation
  // Verifies:
  // - Worker B's READY status is NOT cleared or altered.
  // - Worker B's canonical assistant ID is NOT replaced.
  // - Worker A's orphaned assistant ID is durably recorded in audit_logs.
  // - Worker A cannot clear Worker B's claim_token or claim_expires_at.
  // - Audit failure surfaces error to stale worker without corrupting state.
  // =========================================================================
  const org8 = `${prefix}_org8`;
  await createTestOrg(org8, 'Org 8 External Success Lease Lost Race');

  const assistantCreatedByWorkerA = 'asst-8-worker-a-orphan';
  const workerAProvider = {
    createOrUpdateAssistant: async () => {
      // Step 2 & 3: While Worker A is creating assistant externally, Worker A loses lease.
      // Worker B claims and commits canonical assistant as READY:
      await db.execute(
        `UPDATE organization_voice_assistants
         SET provisioning_status = 'READY',
             vapi_assistant_id = 'asst-8-worker-b-canonical',
             claim_token = NULL,
             claim_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1`,
        [org8]
      );
      return { assistantId: assistantCreatedByWorkerA };
    },
  };

  // Step 4: Worker A attempts to finish provisioning but fails fencing
  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org8, {
        customVoiceProvider: workerAProvider,
        maxRetries: 1,
      });
    },
    /fencing error/,
    'Fencing error must be raised when lease was overtaken'
  );

  // Verification 1: Worker B's READY status is NOT cleared or altered!
  const ova8 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org8]);
  assert.strictEqual(ova8.provisioning_status, 'READY', 'Worker B READY status must NOT be cleared or altered');

  // Verification 2: Worker B's canonical assistant ID is NOT replaced!
  assert.strictEqual(ova8.vapi_assistant_id, 'asst-8-worker-b-canonical', 'Worker B canonical assistant ID must NOT be replaced');

  // Verification 3: Worker A's orphaned assistant ID is durably recorded in audit_logs!
  const orphanAuditLog = await db.getOne<any>(
    `SELECT * FROM audit_logs
     WHERE organization_id = $1
       AND action = 'VOICE_ASSISTANT_ORPHAN_DETECTED'`,
    [org8]
  );
  assert.ok(orphanAuditLog, 'Orphaned assistant must be durably recorded in audit_logs');
  const metadata = JSON.parse(orphanAuditLog.metadata);
  assert.strictEqual(metadata.orphanedAssistantId, 'asst-8-worker-a-orphan', 'Orphaned assistant ID recorded in metadata');

  // Verification 4: Worker A cannot clear Worker B's claim_token or claim_expires_at if Worker B is actively CLAIMED
  const org8_active = `${prefix}_org8_active`;
  await createTestOrg(org8_active, 'Org 8 Active Claim Protection');
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, claim_token, claim_expires_at, created_at, updated_at
     ) VALUES ($1, 'CLAIMED', 'worker-b-active-token', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org8_active, new Date(Date.now() + 120000).toISOString()]
  );

  // Stale Worker A calls recordStaleWorkerOrphan and attempts to flag reconciliation:
  await VoiceAssistantProvisioningService.recordStaleWorkerOrphan(
    org8_active,
    'stale-worker-a-token',
    'asst-orphan-x',
    'Test stale orphan logging'
  );
  const flagged = await VoiceAssistantProvisioningService.flagReconciliationRequiredWithActiveClaim(
    org8_active,
    'stale-worker-a-token',
    {
      category: 'AMBIGUOUS_NETWORK',
      reason: 'Stale attempt',
    }
  );
  assert.strictEqual(flagged, false, 'Stale worker cannot flag reconciliation or clear active claim');

  const ova8Active = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org8_active]);
  assert.strictEqual(ova8Active.claim_token, 'worker-b-active-token', 'Worker B active claim token must remain intact');
  assert.strictEqual(ova8Active.provisioning_status, 'CLAIMED', 'Worker B status must remain CLAIMED');
  assert.ok(ova8Active.claim_expires_at !== null, 'Worker B claim expiry must remain intact');

  // Verification 5: Audit log failure is surfaced to stale worker without corrupting database state
  const org8_auditfail = `${prefix}_org8_auditfail`;
  await createTestOrg(org8_auditfail, 'Org 8 Audit Failure Test');
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, vapi_assistant_id, created_at, updated_at
     ) VALUES ($1, 'READY', 'asst-8-ready-canonical', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org8_auditfail]
  );

  const failingAuditDb = {
    ...db,
    execute: async (sql: string, params: any[]) => {
      if (sql.includes('INSERT INTO audit_logs')) {
        throw new Error('SIMULATED_DB_ERROR: audit_logs write failed');
      }
      return db.execute(sql, params);
    },
    getOne: (sql: string, params?: any[]) => db.getOne(sql, params),
  };

  // Must surface the error when audit logging fails
  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.recordStaleWorkerOrphan(
        org8_auditfail,
        'stale-token-audit-fail',
        'asst-orphan-unrecorded',
        'Simulated audit failure',
        failingAuditDb as any
      );
    },
    /SIMULATED_DB_ERROR|Failed to record orphaned voice assistant/,
    'Audit insertion failure must be surfaced to stale worker'
  );

  // Assert actual database state: Worker B's READY state and assistant ID remain unchanged
  const ova8AfterAuditFail = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org8_auditfail]);
  assert.strictEqual(ova8AfterAuditFail.provisioning_status, 'READY', 'READY state must remain unchanged');
  assert.strictEqual(ova8AfterAuditFail.vapi_assistant_id, 'asst-8-ready-canonical', 'Canonical assistant ID must remain unchanged');

  // Assert actual database state: Worker B's active claim remains unchanged under audit failure
  const org8_claimfail = `${prefix}_org8_claimfail`;
  await createTestOrg(org8_claimfail, 'Org 8 Audit Failure Claim Test');
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, provisioning_status, claim_token, claim_expires_at, created_at, updated_at
     ) VALUES ($1, 'CLAIMED', 'worker-b-active-claim', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org8_claimfail, new Date(Date.now() + 60000).toISOString()]
  );

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.recordStaleWorkerOrphan(
        org8_claimfail,
        'stale-token-audit-fail-2',
        'asst-orphan-claimed-unrecorded',
        'Simulated audit failure on claimed',
        failingAuditDb as any
      );
    },
    /SIMULATED_DB_ERROR|Failed to record orphaned voice assistant/
  );

  const ova8ClaimAfterFail = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org8_claimfail]);
  assert.strictEqual(ova8ClaimAfterFail.provisioning_status, 'CLAIMED', 'CLAIMED state must remain unchanged');
  assert.strictEqual(ova8ClaimAfterFail.claim_token, 'worker-b-active-claim', 'Claim token must remain unchanged');

  // Verify future provisioning request does not create another assistant
  const reuseRes = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org8_auditfail);
  assert.strictEqual(reuseRes.assistantId, 'asst-8-ready-canonical', 'Reuses existing canonical assistant without duplicate creation');
  assert.strictEqual(reuseRes.isNew, false);

  console.log('  ✓ 8. Concrete race: Stale worker fencing preserved READY & canonical ID; audit failure surfaced');

  // =========================================================================
  // Test 9: Strict Error Classification Allowlist & Ambiguous Failure Protection (Audit Remediation 1 & 3)
  // =========================================================================
  // 9-unit: Comprehensive validation of all classification cases:
  // Definitive allowlist: 400, 401, 403, 404, 422
  for (const code of [400, 401, 403, 404, 422]) {
    assert.strictEqual(
      VoiceAssistantProvisioningService.isDefinitiveClientFailure({ status: code }, 'EXTERNAL_CALL'),
      true,
      `Status ${code} must be definitive`
    );
    assert.strictEqual(
      VoiceAssistantProvisioningService.isDefinitiveClientFailure({ statusCode: code }, 'EXTERNAL_CALL'),
      true,
      `StatusCode ${code} must be definitive`
    );
  }

  // Ambiguous unmapped 4xx: 408, 409, 418, 425, 429
  for (const code of [408, 409, 418, 425, 429]) {
    assert.strictEqual(
      VoiceAssistantProvisioningService.isDefinitiveClientFailure({ status: code }, 'EXTERNAL_CALL'),
      false,
      `Status ${code} must fail closed to ambiguous`
    );
  }

  // Ambiguous 5xx: 500, 502, 503, 504
  for (const code of [500, 502, 503, 504]) {
    assert.strictEqual(
      VoiceAssistantProvisioningService.isDefinitiveClientFailure({ status: code }, 'EXTERNAL_CALL'),
      false,
      `Status ${code} must fail closed to ambiguous`
    );
  }

  // Missing status
  assert.strictEqual(
    VoiceAssistantProvisioningService.isDefinitiveClientFailure(new Error('Connection reset'), 'EXTERNAL_CALL'),
    false,
    'Missing status must fail closed to ambiguous'
  );

  // Malformed status (strings, NaN, boolean, objects)
  assert.strictEqual(
    VoiceAssistantProvisioningService.isDefinitiveClientFailure({ status: 'invalid_code' }, 'EXTERNAL_CALL'),
    false,
    'Malformed string status must fail closed to ambiguous'
  );
  assert.strictEqual(
    VoiceAssistantProvisioningService.isDefinitiveClientFailure({ status: NaN }, 'EXTERNAL_CALL'),
    false,
    'NaN status must fail closed to ambiguous'
  );
  assert.strictEqual(
    VoiceAssistantProvisioningService.isDefinitiveClientFailure({ status: true }, 'EXTERNAL_CALL'),
    false,
    'Boolean status must fail closed to ambiguous'
  );

  // Misleading message containing '400' with a 502 status
  assert.strictEqual(
    VoiceAssistantProvisioningService.isDefinitiveClientFailure({ status: 502, message: '400 Bad Request simulation' }, 'EXTERNAL_CALL'),
    false,
    'Misleading 502 message must fail closed to ambiguous'
  );

  // 9a: Ambiguous timeout transitions to RECONCILIATION_REQUIRED in database
  const org9 = `${prefix}_org9`;
  await createTestOrg(org9, 'Org 9 Ambiguous Timeout');
  let vapiCreationAttempts = 0;
  const timeoutProvider = {
    createOrUpdateAssistant: async () => {
      vapiCreationAttempts++;
      throw new Error('ETIMEDOUT: Connection to Vapi API timed out while awaiting response');
    },
  };

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9, {
        customVoiceProvider: timeoutProvider,
        maxRetries: 1,
      });
    },
    /ETIMEDOUT/,
    'Timeout error propagated'
  );

  const ova9 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9]);
  assert.strictEqual(ova9.provisioning_status, 'RECONCILIATION_REQUIRED', 'Must enter RECONCILIATION_REQUIRED on timeout');
  assert.ok(ova9.error_message.includes('AMBIGUOUS_NETWORK'), 'Failure category AMBIGUOUS_NETWORK recorded');

  // 9b: Subsequent automated requests MUST NOT automatically reclaim or create duplicate assistant!
  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9, {
        customVoiceProvider: timeoutProvider,
      });
    },
    /requires manual voice assistant reconciliation/,
    'Subsequent retry must fail closed without calling external provider'
  );

  assert.strictEqual(vapiCreationAttempts, 1, 'External Vapi creation must NOT be called again on retry (duplicate prevented)');

  // 9c: Definitive failure with structured 401 Unauthorized transitions to FAILED for retry
  const org9c = `${prefix}_org9c`;
  await createTestOrg(org9c, 'Org 9c Definitive Rejection');
  const unauthorizedProvider = {
    createOrUpdateAssistant: async () => {
      const err = new HttpError('Vapi API error: 401 Unauthorized. Invalid API credentials.');
      err.status = 401;
      throw err;
    },
  };

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9c, {
        customVoiceProvider: unauthorizedProvider,
        maxRetries: 1,
      });
    },
    /401 Unauthorized/,
    'Definitive 401 rejected'
  );

  const ova9c = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9c]);
  assert.strictEqual(ova9c.provisioning_status, 'FAILED', 'Definitive structured 401 transitions to FAILED for retry');

  // 9d: Misleading error: HTTP 502 with substring "400" in error message MUST fail closed to RECONCILIATION_REQUIRED
  const org9d = `${prefix}_org9d`;
  await createTestOrg(org9d, 'Org 9d Misleading 502 Error');
  const misleading502Provider = {
    createOrUpdateAssistant: async () => {
      const err = new HttpError('502 Bad Gateway: prompt error 400 words exceed standard limit');
      err.status = 502; // Numeric status is 502 server error
      throw err;
    },
  };

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9d, {
        customVoiceProvider: misleading502Provider,
        maxRetries: 1,
      });
    },
    /502 Bad Gateway/,
    '502 error rejected'
  );

  const ova9d = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9d]);
  assert.strictEqual(ova9d.provisioning_status, 'RECONCILIATION_REQUIRED', 'Misleading 502 must fail closed to RECONCILIATION_REQUIRED, never FAILED');

  // 9e: Structured 422 Unprocessable Entity transitions to FAILED for retry
  const org9e = `${prefix}_org9e`;
  await createTestOrg(org9e, 'Org 9e Structured 422 Error');
  const unprocessableProvider = {
    createOrUpdateAssistant: async () => {
      const err = new HttpError('Unprocessable Entity: invalid parameter');
      err.statusCode = 422; // Using statusCode property
      throw err;
    },
  };

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9e, {
        customVoiceProvider: unprocessableProvider,
        maxRetries: 1,
      });
    },
    /Unprocessable Entity/,
    '422 error rejected'
  );

  const ova9e = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9e]);
  assert.strictEqual(ova9e.provisioning_status, 'FAILED', 'Structured 422 transitions to FAILED for retry');

  // 9f: Rate limiting (HTTP 429) fails closed to RECONCILIATION_REQUIRED
  const org9f = `${prefix}_org9f`;
  await createTestOrg(org9f, 'Org 9f Rate Limit 429');
  const rateLimitProvider = {
    createOrUpdateAssistant: async () => {
      const err = new HttpError('Rate limit exceeded');
      err.status = 429;
      throw err;
    },
  };

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9f, {
        customVoiceProvider: rateLimitProvider,
        maxRetries: 1,
      });
    },
    /Rate limit exceeded/,
    '429 error rejected'
  );

  const ova9f = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9f]);
  assert.strictEqual(ova9f.provisioning_status, 'RECONCILIATION_REQUIRED', 'HTTP 429 fails closed to RECONCILIATION_REQUIRED');

  // 9g: Unmapped 4xx (e.g. 409 Conflict, 418 Teapot, 425 Too Early) fail closed to RECONCILIATION_REQUIRED
  const org9g = `${prefix}_org9g`;
  await createTestOrg(org9g, 'Org 9g Unmapped 418 Error');
  const teapotProvider = {
    createOrUpdateAssistant: async () => {
      const err = new HttpError("I'm a teapot");
      err.status = 418;
      throw err;
    },
  };

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9g, {
        customVoiceProvider: teapotProvider,
        maxRetries: 1,
      });
    },
    /teapot/,
    '418 error rejected'
  );

  const ova9g = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9g]);
  assert.strictEqual(ova9g.provisioning_status, 'RECONCILIATION_REQUIRED', 'Unmapped 418 must fail closed to RECONCILIATION_REQUIRED');

  // 9h: Missing status (e.g. socket reset) fails closed to RECONCILIATION_REQUIRED
  const org9h = `${prefix}_org9h`;
  await createTestOrg(org9h, 'Org 9h Missing Status Socket Error');
  const socketErrorProvider = {
    createOrUpdateAssistant: async () => {
      throw new Error('ECONNRESET: socket hang up');
    },
  };

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org9h, {
        customVoiceProvider: socketErrorProvider,
        maxRetries: 1,
      });
    },
    /ECONNRESET/,
    'Socket error rejected'
  );

  const ova9h = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9h]);
  assert.strictEqual(ova9h.provisioning_status, 'RECONCILIATION_REQUIRED', 'Missing status must fail closed to RECONCILIATION_REQUIRED');

  console.log('  ✓ 9. Strict error classification allowlist & ambiguous failure protection verified');

  // =========================================================================
  // Test 10: Existing Valid Assistant Reuse (Zero Duplication)
  // =========================================================================
  const org10 = `${prefix}_org10`;
  await createTestOrg(org10, 'Org 10 Valid Reuse');
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, vapi_assistant_id, provisioning_status, created_at, updated_at
     ) VALUES ($1, 'asst-existing-auth-10', 'READY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org10]
  );

  let providerCalls = 0;
  const spyingProvider = {
    createOrUpdateAssistant: async () => {
      providerCalls++;
      return { assistantId: 'asst-unwanted-duplicate' };
    },
  };

  const res10 = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org10, {
    customVoiceProvider: spyingProvider,
  });

  assert.strictEqual(res10.assistantId, 'asst-existing-auth-10', 'Must reuse existing canonical assistant ID');
  assert.strictEqual(res10.isNew, false, 'isNew must be false');
  assert.strictEqual(providerCalls, 0, 'External provider must NOT be called when READY assistant exists');
  console.log('  ✓ 10. Existing valid assistant reused with zero duplicate external creation');

  // =========================================================================
  // Test 11: Divergent Legacy Assistant Assignments Fail Closed
  // =========================================================================
  const org11 = `${prefix}_org11`;
  await createTestOrg(org11, 'Org 11 Divergent Legacy');
  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, vapi_assistant_id, provisioning_status, error_message, created_at, updated_at
     ) VALUES ($1, NULL, 'RECONCILIATION_REQUIRED', 'Divergent line assistants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org11]
  );

  await assert.rejects(
    async () => {
      await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(org11);
    },
    /manual voice assistant reconciliation/,
    'Must fail closed when status is RECONCILIATION_REQUIRED'
  );
  console.log('  ✓ 11. Divergent legacy assistant assignments safely blocked until reconciliation');

  // =========================================================================
  // Test 12: Synchronization Conflict Protection (Never Overwrite Divergent Line)
  // =========================================================================
  const org12 = `${prefix}_org12`;
  await createTestOrg(org12, 'Org 12 Sync Conflict');
  await createTestLine(`${prefix}_line12_a`, org12, '+15551110012', 'asst-12-authoritative');
  await createTestLine(`${prefix}_line12_b`, org12, '+15551110013', 'asst-12-conflict');

  await db.execute(
    `INSERT INTO organization_voice_assistants (
       organization_id, vapi_assistant_id, provisioning_status, created_at, updated_at
     ) VALUES ($1, 'asst-12-authoritative', 'READY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [org12]
  );

  const syncRes12 = await VoiceAssistantProvisioningService.synchronizePhoneLines(org12, 'asst-12-authoritative');
  assert.strictEqual(syncRes12.conflictDetected, true, 'Conflict must be flagged');

  const line12B = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line12_b`]);
  assert.strictEqual(line12B.vapi_assistant_id, 'asst-12-conflict', 'Conflicting line assistant must NEVER be overwritten');
  assert.strictEqual(line12B.sync_status, 'PENDING');

  const ova12 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org12]);
  assert.strictEqual(ova12.provisioning_status, 'RECONCILIATION_REQUIRED', 'Org transitions to RECONCILIATION_REQUIRED on conflict');
  console.log('  ✓ 12. Synchronization conflict protection preserved line ID without overwrite');

  // =========================================================================
  // Test 13: SSRF Private IPv4 Rejection
  // =========================================================================
  const privateIpv4s = [
    '127.0.0.1',
    '10.0.0.1',
    '10.254.254.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.0.1',
    '192.168.1.254',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ];

  for (const ip of privateIpv4s) {
    assert.strictEqual(SafeIpValidator.isRestrictedIp(ip), true, `Private IPv4 ${ip} must be restricted`);
  }
  // Public IP
  assert.strictEqual(SafeIpValidator.isRestrictedIp('93.184.216.34'), false, 'Public IP 93.184.216.34 must be allowed');
  console.log('  ✓ 13. Complete SSRF private, loopback, and reserved IPv4 rejection verified');

  // =========================================================================
  // Test 14: SSRF Private IPv6 Rejection
  // =========================================================================
  const privateIpv6s = [
    '::1',
    '::',
    'fc00::1',
    'fd12:3456:789a:1::1',
    'fe80::1',
    'fe80::200:5aee:feaa:20a2',
    'ff02::1',
    'fec0::1',
    '2001:db8::1',
    '100::1',
  ];

  for (const ip of privateIpv6s) {
    assert.strictEqual(SafeIpValidator.isRestrictedIp(ip), true, `Private IPv6 ${ip} must be restricted`);
  }
  console.log('  ✓ 14. Complete SSRF private, loopback, ULA, and multicast IPv6 rejection verified');

  // =========================================================================
  // Test 15: IPv4-Mapped IPv6 Rejection
  // =========================================================================
  const mappedIpv6s = [
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
    '::127.0.0.1',
  ];

  for (const ip of mappedIpv6s) {
    assert.strictEqual(SafeIpValidator.isRestrictedIp(ip), true, `IPv4-mapped IPv6 ${ip} must be restricted`);
  }
  console.log('  ✓ 15. IPv4-mapped and IPv4-compatible IPv6 addresses safely extracted and rejected');

  // =========================================================================
  // Test 16: DNS Rebinding Protection
  // =========================================================================
  await assert.rejects(
    async () => {
      await SafeNetworkClient.fetch('https://api.vapi.ai/assistant', {
        dnsLookupOverride: async () => ['127.0.0.1'], // Rebound to loopback
      });
    },
    /SSRF_BLOCKED: Host "api.vapi.ai" resolved to prohibited non-public IP: 127.0.0.1/,
    'Must abort connection if DNS resolves to a prohibited IP'
  );
  console.log('  ✓ 16. DNS rebinding connection attempt intercepted and blocked');

  // =========================================================================
  // Test 17: Comprehensive SafeNetworkClient Redirect Workflow (Fix 4)
  // =========================================================================
  // 17A: Multi-hop redirect (302 -> 301 -> 200 OK) to approved allowlisted destinations
  const visitedUrls: string[] = [];
  const mockRedirectTransport = async (url: URL): Promise<SafeNetworkResponse> => {
    visitedUrls.push(url.toString());
    if (url.toString() === 'https://api.vapi.ai/initial') {
      return {
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: { location: 'https://vapi-public.s3.amazonaws.com/step2' },
        buffer: async () => Buffer.from(''),
        text: async () => '',
        json: mockJsonResponse({}),
      };
    }
    if (url.toString() === 'https://vapi-public.s3.amazonaws.com/step2') {
      return {
        ok: false,
        status: 301,
        statusText: 'Moved Permanently',
        headers: { location: 'https://storage.googleapis.com/final' },
        buffer: async () => Buffer.from(''),
        text: async () => '',
        json: mockJsonResponse({}),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      buffer: async () => Buffer.from(JSON.stringify({ success: true })),
      text: async () => JSON.stringify({ success: true }),
      json: mockJsonResponse({ success: true }),
    };
  };

  const redirectRes = await SafeNetworkClient.fetch('https://api.vapi.ai/initial', {
    dnsLookupOverride: async () => ['93.184.216.34'],
    mockTransport: mockRedirectTransport,
  });

  assert.strictEqual(redirectRes.ok, true, 'Multi-hop redirect to allowlisted hosts must succeed');
  assert.strictEqual(visitedUrls.length, 3, 'Must visit initial, step2, and final URLs');

  // 17B: Redirect to unapproved external host
  await assert.rejects(
    async () => {
      await SafeNetworkClient.fetch('https://api.vapi.ai/redirect-evil', {
        dnsLookupOverride: async () => ['93.184.216.34'],
        mockTransport: async () => ({
          ok: false,
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://evil-attacker.com/steal' },
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({}),
        }),
      });
    },
    /Host "evil-attacker.com" is not in the approved host allowlist/,
    'Redirect to unapproved host must be blocked'
  );

  // 17C: Redirect to private / metadata IP
  await assert.rejects(
    async () => {
      await SafeNetworkClient.fetch('https://api.vapi.ai/redirect-metadata', {
        dnsLookupOverride: async () => ['93.184.216.34'],
        mockTransport: async () => ({
          ok: false,
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://169.254.169.254/latest/meta-data' },
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({}),
        }),
      });
    },
    /SSRF_BLOCKED/,
    'Redirect to metadata IP must be blocked'
  );

  // 17D: Redirect to non-standard port
  await assert.rejects(
    async () => {
      await SafeNetworkClient.fetch('https://api.vapi.ai/redirect-port', {
        dnsLookupOverride: async () => ['93.184.216.34'],
        mockTransport: async () => ({
          ok: false,
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://api.vapi.ai:8080/internal' },
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({}),
        }),
      });
    },
    /Non-standard port "8080"/,
    'Redirect to non-standard port must be blocked'
  );

  // 17E: Redirect to plain HTTP
  await assert.rejects(
    async () => {
      await SafeNetworkClient.fetch('https://api.vapi.ai/redirect-http', {
        dnsLookupOverride: async () => ['93.184.216.34'],
        mockTransport: async () => ({
          ok: false,
          status: 302,
          statusText: 'Found',
          headers: { location: 'http://api.vapi.ai/plain' },
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({}),
        }),
      });
    },
    /Only "https:" is permitted/,
    'Redirect to HTTP must be blocked'
  );

  // 17F: Redirect loop exceeding limit
  await assert.rejects(
    async () => {
      await SafeNetworkClient.fetch('https://api.vapi.ai/loop', {
        dnsLookupOverride: async () => ['93.184.216.34'],
        maxRedirects: 2,
        mockTransport: async (u) => ({
          ok: false,
          status: 302,
          statusText: 'Found',
          headers: { location: `https://api.vapi.ai/loop?step=${Date.now()}` },
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({}),
        }),
      });
    },
    /Maximum redirect limit of 2 exceeded/,
    'Redirect loop must be halted at limit'
  );

  console.log('  ✓ 17. Real SafeNetworkClient redirect workflow, multi-hop handling, and hop-by-hop re-validation verified');

  // =========================================================================
  // Test 18: Invalid Hostname, Port, Userinfo, and Domain Spoofing Rejection
  // =========================================================================
  assert.throws(() => SafeNetworkClient.validateUrl('http://api.vapi.ai'), /forbidden. Only "https:"/);
  assert.throws(() => SafeNetworkClient.validateUrl('https://api.vapi.ai:8080'), /Non-standard port "8080"/);
  assert.throws(() => SafeNetworkClient.validateUrl('https://user:pass@api.vapi.ai'), /user credentials/);
  assert.throws(() => SafeNetworkClient.validateUrl('https://api.vapi.ai.attacker.com'), /not in the approved host allowlist/);
  assert.throws(() => SafeNetworkClient.validateUrl('https://sub.api.vapi.ai'), /not in the approved host allowlist/);
  console.log('  ✓ 18. Invalid protocol, port, userinfo, and suffix domain spoofing rejected');

  // =========================================================================
  // Test 19: Outbound Provider Routing to SafeNetworkClient (Fix 4)
  // =========================================================================
  const { config } = await import('../server/src/config');
  const origVapiKey = config.vapi.apiKey;
  const origTelnyxKey = config.telnyx.apiKey;
  const origRetellKey = config.voice.retellApiKey;
  config.vapi.apiKey = 'test_vapi_synthetic_key';
  config.telnyx.apiKey = 'test_telnyx_synthetic_key';
  config.voice.retellApiKey = 'test_retell_synthetic_key';

  const interceptedCalls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const originalFetch = SafeNetworkClient.fetch;

  try {
    // Intercept SafeNetworkClient.fetch to prove VapiVoiceProvider routes all calls through it
    SafeNetworkClient.fetch = async (url: string, opts?: any): Promise<SafeNetworkResponse> => {
      interceptedCalls.push({
        url,
        method: opts?.method || 'GET',
        headers: opts?.headers || {},
      });

      // Return synthetic responses matching provider API expectations
      if (url.includes('/assistant')) {
        return {
          ok: true,
          status: 201,
          statusText: 'Created',
          headers: {},
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({ id: 'asst_intercepted_123' }),
        };
      }
      if (url.includes('/phone-number/')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {},
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({ success: true }),
        };
      }
      if (url.includes('/phone-number')) {
        return {
          ok: true,
          status: 201,
          statusText: 'Created',
          headers: {},
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({ id: 'vapi_pn_intercepted', number: '+15551234567' }),
        };
      }
      if (url.includes('/stop')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {},
          buffer: async () => Buffer.from(''),
          text: async () => '',
          json: mockJsonResponse({ success: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {},
        buffer: async () => Buffer.from(''),
        text: async () => '',
        json: mockJsonResponse({}),
      };
    };

    const vapiProvider = new VapiVoiceProvider();

    // 19A: Assistant creation routes through SafeNetworkClient
    const asstRes = await vapiProvider.createOrUpdateAssistant({
      agentName: 'Test Assistant',
      systemPrompt: 'You are helpful',
      greeting: 'Hello',
    });
    assert.strictEqual(asstRes.assistantId, 'asst_intercepted_123');
    assert.ok(
      interceptedCalls.some(c => c.url === 'https://api.vapi.ai/assistant' && c.method === 'POST'),
      'createOrUpdateAssistant must route to SafeNetworkClient.fetch'
    );

    // 19B: Phone number import routes through SafeNetworkClient
    const importRes = await vapiProvider.importPhoneNumber({
      phoneNumber: '+15551234567',
      assistantId: 'asst_intercepted_123',
      telnyxApiKey: 'test_key',
    });
    assert.strictEqual(importRes.vapiPhoneNumberId, 'vapi_pn_intercepted');
    assert.ok(
      interceptedCalls.some(c => c.url === 'https://api.vapi.ai/phone-number' && c.method === 'POST'),
      'importPhoneNumber must route to SafeNetworkClient.fetch'
    );

    // 19C: Phone number linkage routes through SafeNetworkClient
    const linkRes = await vapiProvider.linkPhoneNumberToAssistant({
      phoneNumberIdOrNumber: 'vapi_pn_intercepted',
      assistantId: 'asst_intercepted_123',
    });
    assert.strictEqual(linkRes, true);
    assert.ok(
      interceptedCalls.some(c => c.url === 'https://api.vapi.ai/phone-number/vapi_pn_intercepted' && c.method === 'PATCH'),
      'linkPhoneNumberToAssistant must route to SafeNetworkClient.fetch'
    );

    // 19D: Call termination routes through SafeNetworkClient
    const termRes = await vapiProvider.terminateCall('call_12345');
    assert.strictEqual(termRes, true);
    assert.ok(
      interceptedCalls.some(c => c.url === 'https://api.vapi.ai/call/call_12345/stop' && c.method === 'POST'),
      'terminateCall must route to SafeNetworkClient.fetch'
    );
  } finally {
    SafeNetworkClient.fetch = originalFetch;
  }
  console.log('  ✓ 19. Real VapiVoiceProvider method invocations confirmed to route outbound requests through SafeNetworkClient');

  // =========================================================================
  // Test 20: Comprehensive CLI Safety & Connection String Detection (Fix 3)
  // =========================================================================
  // 20A: Strict URL parsing validation
  assert.strictEqual(isLocalDatabaseUrl('postgresql://user:pass@localhost:5432/mydb'), true, 'localhost must be local');
  assert.strictEqual(isLocalDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/mydb'), true, '127.0.0.1 must be local');
  assert.strictEqual(isLocalDatabaseUrl('postgresql://user:pass@[::1]:5432/mydb'), true, '::1 must be local');
  assert.strictEqual(isLocalDatabaseUrl('postgresql://user:pass@0.0.0.0:5432/mydb'), true, '0.0.0.0 must be local');

  // Substring evasion attacks must ALL be rejected as remote:
  assert.strictEqual(isLocalDatabaseUrl('postgresql://localhost_admin:secret@db.supabase.co:5432/postgres'), false, 'localhost in username is NOT local');
  assert.strictEqual(isLocalDatabaseUrl('postgresql://app:pass_localhost@containers.railway.app:5432/prod'), false, 'localhost in password is NOT local');
  assert.strictEqual(isLocalDatabaseUrl('postgresql://app:secret@db.supabase.co:5432/localhost_db'), false, 'localhost in db name is NOT local');
  assert.strictEqual(isLocalDatabaseUrl('postgresql://app:secret@aws.neon.tech:5432/prod?schema=localhost'), false, 'localhost in query param is NOT local');
  assert.strictEqual(isLocalDatabaseUrl('invalid://not-a-valid-url'), false, 'Malformed URL fails closed as non-local');
  assert.strictEqual(isLocalDatabaseUrl(''), false, 'Empty URL fails closed as non-local');
  assert.strictEqual(isLocalDatabaseUrl(undefined), false, 'Undefined URL fails closed as non-local');

  // 20B: Remote CLI execution safeguard
  const originalEnvDb = process.env.DATABASE_URL;
  const originalEmbedded = process.env.USE_EMBEDDED_DB;

  try {
    delete process.env.USE_EMBEDDED_DB;
    // URL with localhost in path/name targeting a remote host:
    process.env.DATABASE_URL = 'postgresql://app:secret@db.supabase.co:5432/localhost_db';

    await assert.rejects(
      async () => {
        await runVoiceBackfillCli(['--execute']);
      },
      /SAFETY BLOCK: Executing mutations against a non-local \/ remote database requires explicit confirmation/,
      'Must block accidental execution against remote DB even with localhost in DB name'
    );
  } finally {
    process.env.DATABASE_URL = originalEnvDb;
    process.env.USE_EMBEDDED_DB = originalEmbedded;
  }
  console.log('  ✓ 20. CLI safeguard and robust URL hostname parsing verified against evasion attacks');

  // =========================================================================
  // Test 21: Telnyx Telephony Provider Network Security (Fix 6)
  // =========================================================================
  const telnyxIntercepts: string[] = [];
  const origFetch21 = SafeNetworkClient.fetch;
  try {
    SafeNetworkClient.fetch = async (url: string, opts?: any): Promise<SafeNetworkResponse> => {
      telnyxIntercepts.push(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {},
        buffer: async () => Buffer.from(''),
        text: async () => '',
        json: mockJsonResponse({ data: [] }),
      };
    };

    const telnyx = new TelnyxTelephonyProvider();
    await telnyx.searchAvailableNumbers({ countryCode: 'US', limit: 1 });
    assert.ok(
      telnyxIntercepts.some(u => u.includes('api.telnyx.com/v2/available_phone_numbers')),
      'Telnyx provider must route requests through SafeNetworkClient.fetch'
    );
  } finally {
    SafeNetworkClient.fetch = origFetch21;
  }
  console.log('  ✓ 21. TelnyxTelephonyProvider confirmed to route outbound requests through SafeNetworkClient');

  // =========================================================================
  // Test 22: Retell Voice Provider Network Security (Fix 6)
  // =========================================================================
  const retellIntercepts: string[] = [];
  const origFetch22 = SafeNetworkClient.fetch;
  try {
    SafeNetworkClient.fetch = async (url: string, opts?: any): Promise<SafeNetworkResponse> => {
      retellIntercepts.push(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {},
        buffer: async () => Buffer.from(''),
        text: async () => '',
        json: mockJsonResponse({ phone_number: '+14155550000', phone_number_id: 'retell_pn_123' }),
      };
    };

    const retell = new RetellVoiceProvider();
    await retell.provisionNumber({ country: 'US', areaCode: '415' });
    assert.ok(
      retellIntercepts.some(u => u.includes('api.retellai.com/create-phone-number')),
      'Retell provider must route requests through SafeNetworkClient.fetch'
    );
  } finally {
    SafeNetworkClient.fetch = origFetch22;
    config.vapi.apiKey = origVapiKey;
    config.telnyx.apiKey = origTelnyxKey;
    config.voice.retellApiKey = origRetellKey;
  }
  console.log('  ✓ 22. RetellVoiceProvider confirmed to route outbound requests through SafeNetworkClient');

  console.log('\n====================================================');
  console.log('  ALL 22 REMEDIATION SCENARIOS VERIFIED SUCCESSFULLY!');
  console.log('====================================================\n');
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('voice-provisioning-and-network.test'))) {
  runVoiceProvisioningAndNetworkTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
