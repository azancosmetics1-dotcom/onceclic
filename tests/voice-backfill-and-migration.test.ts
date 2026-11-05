process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';

import assert from 'assert';
import { db } from '../server/src/db';
import { VoiceBackfillService } from '../server/src/services/voice/VoiceBackfillService';
import { runVoiceBackfillCli } from '../server/src/scripts/voice-backfill';

export async function runVoiceBackfillAndMigrationTests() {
  console.log('--- Running Voice Backfill & Migration 022 Test Suite ---');

  // Helper to insert an organization cleanly
  async function insertTestOrg(id: string, name: string) {
    await db.execute(
      `INSERT INTO organizations (id, name, slug, business_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'HEALTHCARE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, name, `slug-${id}`]
    );
  }

  // Helper to insert a voice phone number
  async function insertTestLine(
    id: string,
    orgId: string,
    phoneNumber: string,
    vapiAssistantId: string | null,
    syncStatus?: string | null
  ) {
    await db.execute(
      `INSERT INTO voice_phone_numbers (
         id, organization_id, phone_number, vapi_assistant_id, sync_status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, orgId, phoneNumber, vapiAssistantId, syncStatus || null]
    );
  }

  // Helper to insert an organization_voice_assistants row
  async function insertTestOrgAssistant(
    orgId: string,
    vapiAssistantId: string | null,
    status: string,
    claimToken?: string | null,
    claimExpiresAt?: Date | string | null,
    errorMessage?: string | null
  ) {
    await db.execute(
      `INSERT INTO organization_voice_assistants (
         organization_id, vapi_assistant_id, provisioning_status, claim_token, claim_expires_at, error_message, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [orgId, vapiAssistantId, status, claimToken || null, claimExpiresAt ? new Date(claimExpiresAt).toISOString() : null, errorMessage || null]
    );
  }

  const prefix = `test_bf_${Date.now()}`;

  // -------------------------------------------------------------------------
  // Scenario 1: One valid phone number & assistant ID -> READY & SYNCHRONIZED
  // -------------------------------------------------------------------------
  const org1 = `${prefix}_org1`;
  await insertTestOrg(org1, 'Org 1 - Single Line');
  await insertTestLine(`${prefix}_line1`, org1, '+15550000001', 'asst-org1-valid');

  // -------------------------------------------------------------------------
  // Scenario 2: Multiple lines sharing SAME assistant ID -> READY & SYNCHRONIZED
  // -------------------------------------------------------------------------
  const org2 = `${prefix}_org2`;
  await insertTestOrg(org2, 'Org 2 - Multi Shared Lines');
  await insertTestLine(`${prefix}_line2_a`, org2, '+15550000002', 'asst-org2-shared');
  await insertTestLine(`${prefix}_line2_b`, org2, '+15550000003', 'asst-org2-shared');
  await insertTestLine(`${prefix}_line2_c`, org2, '+15550000004', 'asst-org2-shared');

  // -------------------------------------------------------------------------
  // Scenario 3: Multiple lines with DIFFERENT assistant IDs -> RECONCILIATION_REQUIRED
  // -------------------------------------------------------------------------
  const org3 = `${prefix}_org3`;
  await insertTestOrg(org3, 'Org 3 - Divergent Lines');
  await insertTestLine(`${prefix}_line3_a`, org3, '+15550000005', 'asst-org3-alpha');
  await insertTestLine(`${prefix}_line3_b`, org3, '+15550000006', 'asst-org3-beta');

  // -------------------------------------------------------------------------
  // Scenario 4: Organization with NO phone numbers -> IDLE
  // -------------------------------------------------------------------------
  const org4 = `${prefix}_org4`;
  await insertTestOrg(org4, 'Org 4 - Zero Lines');

  // -------------------------------------------------------------------------
  // Scenario 5: Organization with NULL assistant ID on all lines -> IDLE
  // -------------------------------------------------------------------------
  const org5 = `${prefix}_org5`;
  await insertTestOrg(org5, 'Org 5 - Null Line Assistants');
  await insertTestLine(`${prefix}_line5_a`, org5, '+15550000007', null);
  await insertTestLine(`${prefix}_line5_b`, org5, '+15550000008', null);

  // -------------------------------------------------------------------------
  // Scenario 6: Pre-existing READY with NULL assistant ID -> Repaired to line assistant
  // -------------------------------------------------------------------------
  const org6 = `${prefix}_org6`;
  await insertTestOrg(org6, 'Org 6 - Incomplete Legacy Ready');
  await insertTestOrgAssistant(org6, null, 'READY');
  await insertTestLine(`${prefix}_line6`, org6, '+15550000009', 'asst-org6-repaired');

  // -------------------------------------------------------------------------
  // Scenario 7: Pre-existing READY with MATCHING valid assistant ID -> Untouched / Preserved
  // -------------------------------------------------------------------------
  const org7 = `${prefix}_org7`;
  await insertTestOrg(org7, 'Org 7 - Pre-existing Consistent');
  await insertTestOrgAssistant(org7, 'asst-org7-auth', 'READY');
  await insertTestLine(`${prefix}_line7`, org7, '+15550000010', 'asst-org7-auth');

  // -------------------------------------------------------------------------
  // Scenario 8: Pre-existing READY with DIFFERENT line assistant -> RECONCILIATION_REQUIRED
  // Assistant ID must NEVER be overwritten!
  // -------------------------------------------------------------------------
  const org8 = `${prefix}_org8`;
  await insertTestOrg(org8, 'Org 8 - Pre-existing Conflict');
  await insertTestOrgAssistant(org8, 'asst-org8-authoritative', 'READY');
  await insertTestLine(`${prefix}_line8`, org8, '+15550000011', 'asst-org8-line-conflict');

  // -------------------------------------------------------------------------
  // Scenario 9: Pre-existing CLAIMED with ACTIVE lease -> Untouched, left CLAIMED
  // -------------------------------------------------------------------------
  const org9 = `${prefix}_org9`;
  const futureExpiry = new Date(Date.now() + 3600000); // +1 hour
  await insertTestOrg(org9, 'Org 9 - Active Claim');
  await insertTestOrgAssistant(org9, null, 'CLAIMED', 'active-token-org9', futureExpiry);
  await insertTestLine(`${prefix}_line9`, org9, '+15550000012', 'asst-org9-line');

  // -------------------------------------------------------------------------
  // Scenario 10: Pre-existing CLAIMED with EXPIRED lease -> Safely Reclaimed to READY
  // -------------------------------------------------------------------------
  const org10 = `${prefix}_org10`;
  const pastExpiry = new Date(Date.now() - 3600000); // -1 hour
  await insertTestOrg(org10, 'Org 10 - Expired Claim');
  await insertTestOrgAssistant(org10, null, 'CLAIMED', 'dead-worker-token-org10', pastExpiry);
  await insertTestLine(`${prefix}_line10`, org10, '+15550000013', 'asst-org10-line');

  // -------------------------------------------------------------------------
  // Scenario 11: Incomplete legacy data (mixed NULL and non-NULL lines) -> READY, line 1 SYNCHRONIZED, line 2 PENDING
  // -------------------------------------------------------------------------
  const org11 = `${prefix}_org11`;
  await insertTestOrg(org11, 'Org 11 - Mixed Lines');
  await insertTestLine(`${prefix}_line11_a`, org11, '+15550000014', 'asst-org11-valid');
  await insertTestLine(`${prefix}_line11_b`, org11, '+15550000015', null);

  // -------------------------------------------------------------------------
  // Step A: Pre-migration DRY-RUN Verification
  // -------------------------------------------------------------------------
  console.log('Testing Dry-Run simulation...');
  const dryRunReport = await VoiceBackfillService.dryRun(db);
  assert(dryRunReport.summary.totalProcessed >= 11, 'Dry-run should process all test organizations');

  const item1 = dryRunReport.items.find(i => i.organizationId === org1);
  assert.strictEqual(item1?.proposedAction, 'BACKFILL_TO_READY', 'Scenario 1 dry run action');

  const item2 = dryRunReport.items.find(i => i.organizationId === org2);
  assert.strictEqual(item2?.proposedAction, 'BACKFILL_TO_READY', 'Scenario 2 dry run action');

  const item3 = dryRunReport.items.find(i => i.organizationId === org3);
  assert.strictEqual(item3?.proposedAction, 'FLAG_RECONCILIATION_REQUIRED_DIVERGENT', 'Scenario 3 dry run action');

  const item4 = dryRunReport.items.find(i => i.organizationId === org4);
  assert.strictEqual(item4?.proposedAction, 'INITIALIZE_IDLE', 'Scenario 4 dry run action');

  const item5 = dryRunReport.items.find(i => i.organizationId === org5);
  assert.strictEqual(item5?.proposedAction, 'INITIALIZE_IDLE', 'Scenario 5 dry run action');

  const item6 = dryRunReport.items.find(i => i.organizationId === org6);
  assert.strictEqual(item6?.proposedAction, 'BACKFILL_TO_READY', 'Scenario 6 dry run action');

  const item7 = dryRunReport.items.find(i => i.organizationId === org7);
  assert.strictEqual(item7?.proposedAction, 'NO_OP_ALREADY_CONSISTENT', 'Scenario 7 dry run action');

  const item8 = dryRunReport.items.find(i => i.organizationId === org8);
  assert.strictEqual(item8?.proposedAction, 'FLAG_RECONCILIATION_REQUIRED_PREEXISTING_READY_MISMATCH', 'Scenario 8 dry run action');

  const item9 = dryRunReport.items.find(i => i.organizationId === org9);
  assert.strictEqual(item9?.proposedAction, 'NO_OP_ACTIVE_CLAIM', 'Scenario 9 dry run action');

  const item10 = dryRunReport.items.find(i => i.organizationId === org10);
  assert.strictEqual(item10?.proposedAction, 'BACKFILL_TO_READY', 'Scenario 10 dry run action');

  const item11 = dryRunReport.items.find(i => i.organizationId === org11);
  assert.strictEqual(item11?.proposedAction, 'BACKFILL_TO_READY', 'Scenario 11 dry run action');

  // Verify that Dry-Run performed ZERO mutations
  const checkDryRunNoMutations = await db.getOne<any>(
    'SELECT vapi_assistant_id FROM organization_voice_assistants WHERE organization_id = $1',
    [org1]
  );
  assert.strictEqual(checkDryRunNoMutations, null, 'Dry run must not create or modify records');

  // Test the CLI runner in dry-run mode
  await runVoiceBackfillCli(['--dry-run']);

  // -------------------------------------------------------------------------
  // Step B: Backfill Execution Verification
  // -------------------------------------------------------------------------
  console.log('Testing Backfill Execution in Transaction...');
  const metrics = await db.withTransaction(async (tx) => {
    return await VoiceBackfillService.executeBackfill(tx);
  });

  assert(metrics.totalOrganizations >= 11, 'Should process all test orgs');
  assert(metrics.backfilledToReady >= 4, 'Should backfill eligible orgs');
  assert(metrics.flaggedReconciliationRequired >= 2, 'Should flag conflicting orgs');

  // Assertions for Scenario 1:
  const ova1 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org1]);
  assert.strictEqual(ova1?.provisioning_status, 'READY', 'Scenario 1: Org status must be READY');
  assert.strictEqual(ova1?.vapi_assistant_id, 'asst-org1-valid', 'Scenario 1: Assistant ID must match line');
  const line1 = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line1`]);
  assert.strictEqual(line1?.sync_status, 'SYNCHRONIZED', 'Scenario 1: Line must be SYNCHRONIZED');
  assert.strictEqual(line1?.vapi_assistant_id, 'asst-org1-valid', 'Scenario 1: Line assistant ID preserved');
  assert.strictEqual(line1?.phone_number, '+15550000001', 'Scenario 1: Phone number preserved');

  // Assertions for Scenario 2:
  const ova2 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org2]);
  assert.strictEqual(ova2?.provisioning_status, 'READY', 'Scenario 2: Org status must be READY');
  assert.strictEqual(ova2?.vapi_assistant_id, 'asst-org2-shared', 'Scenario 2: Assistant ID matches shared lines');
  const lines2 = await db.query<any>('SELECT * FROM voice_phone_numbers WHERE organization_id = $1', [org2]);
  assert.strictEqual(lines2.rows.length, 3, 'Scenario 2: All 3 lines preserved');
  for (const l of lines2.rows) {
    assert.strictEqual(l.sync_status, 'SYNCHRONIZED', 'Scenario 2: All lines SYNCHRONIZED');
    assert.strictEqual(l.vapi_assistant_id, 'asst-org2-shared', 'Scenario 2: Line assistant ID preserved');
  }

  // Assertions for Scenario 3:
  const ova3 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org3]);
  assert.strictEqual(ova3?.provisioning_status, 'RECONCILIATION_REQUIRED', 'Scenario 3: Conflicting lines marked RECONCILIATION_REQUIRED');
  assert.strictEqual(ova3?.vapi_assistant_id, null, 'Scenario 3: Conflicting org assistant ID must be null');
  assert(ova3?.error_message?.includes('Divergent'), 'Scenario 3: Error message notes divergence');
  const line3a = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line3_a`]);
  const line3b = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line3_b`]);
  assert.strictEqual(line3a?.vapi_assistant_id, 'asst-org3-alpha', 'Scenario 3: Line 3a ID strictly preserved');
  assert.strictEqual(line3b?.vapi_assistant_id, 'asst-org3-beta', 'Scenario 3: Line 3b ID strictly preserved');
  assert.strictEqual(line3a?.sync_status, 'PENDING', 'Scenario 3: Line 3a marked PENDING');
  assert.strictEqual(line3b?.sync_status, 'PENDING', 'Scenario 3: Line 3b marked PENDING');

  // Assertions for Scenario 4:
  const ova4 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org4]);
  assert.strictEqual(ova4?.provisioning_status, 'IDLE', 'Scenario 4: Org with zero lines must be IDLE');
  assert.strictEqual(ova4?.vapi_assistant_id, null, 'Scenario 4: Org with zero lines assistant ID is null');

  // Assertions for Scenario 5:
  const ova5 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org5]);
  assert.strictEqual(ova5?.provisioning_status, 'IDLE', 'Scenario 5: Org with NULL line assistants must be IDLE');
  assert.strictEqual(ova5?.vapi_assistant_id, null, 'Scenario 5: Assistant ID is null');
  const lines5 = await db.query<any>('SELECT * FROM voice_phone_numbers WHERE organization_id = $1', [org5]);
  assert.strictEqual(lines5.rows.length, 2, 'Scenario 5: Lines preserved');
  for (const l of lines5.rows) {
    assert.strictEqual(l.sync_status, 'PENDING', 'Scenario 5: Line marked PENDING');
    assert.strictEqual(l.vapi_assistant_id, null, 'Scenario 5: Line assistant ID preserved as null');
  }

  // Assertions for Scenario 6:
  const ova6 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org6]);
  assert.strictEqual(ova6?.provisioning_status, 'READY', 'Scenario 6: Incomplete READY repaired to READY');
  assert.strictEqual(ova6?.vapi_assistant_id, 'asst-org6-repaired', 'Scenario 6: Assistant ID repaired to line ID');
  const line6 = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line6`]);
  assert.strictEqual(line6?.sync_status, 'SYNCHRONIZED', 'Scenario 6: Line marked SYNCHRONIZED');
  assert.strictEqual(line6?.vapi_assistant_id, 'asst-org6-repaired', 'Scenario 6: Line assistant ID preserved');

  // Assertions for Scenario 7:
  const ova7 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org7]);
  assert.strictEqual(ova7?.provisioning_status, 'READY', 'Scenario 7: Pre-existing consistent READY preserved');
  assert.strictEqual(ova7?.vapi_assistant_id, 'asst-org7-auth', 'Scenario 7: Pre-existing ID intact');
  const line7 = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line7`]);
  assert.strictEqual(line7?.sync_status, 'SYNCHRONIZED', 'Scenario 7: Line marked SYNCHRONIZED');

  // Assertions for Scenario 8:
  const ova8 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org8]);
  assert.strictEqual(ova8?.provisioning_status, 'RECONCILIATION_REQUIRED', 'Scenario 8: Conflict transitions to RECONCILIATION_REQUIRED');
  assert.strictEqual(ova8?.vapi_assistant_id, 'asst-org8-authoritative', 'Scenario 8: CRITICAL - Pre-existing READY assistant ID must NOT be overwritten!');
  assert(ova8?.error_message?.includes('Pre-existing READY assistant'), 'Scenario 8: Audit error explains conflict');
  const line8 = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line8`]);
  assert.strictEqual(line8?.vapi_assistant_id, 'asst-org8-line-conflict', 'Scenario 8: Line assistant ID strictly preserved');
  assert.strictEqual(line8?.sync_status, 'PENDING', 'Scenario 8: Line marked PENDING');

  // Assertions for Scenario 9:
  const ova9 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org9]);
  assert.strictEqual(ova9?.provisioning_status, 'CLAIMED', 'Scenario 9: Active claim must remain CLAIMED');
  assert.strictEqual(ova9?.claim_token, 'active-token-org9', 'Scenario 9: Claim token untouched');
  const line9 = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line9`]);
  assert.strictEqual(line9?.sync_status, 'PENDING', 'Scenario 9: Line marked PENDING');
  assert.strictEqual(line9?.vapi_assistant_id, 'asst-org9-line', 'Scenario 9: Line assistant preserved');

  // Assertions for Scenario 10:
  const ova10 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org10]);
  assert.strictEqual(ova10?.provisioning_status, 'READY', 'Scenario 10: Expired claim reclaimed to READY');
  assert.strictEqual(ova10?.vapi_assistant_id, 'asst-org10-line', 'Scenario 10: Assistant ID populated from line');
  assert.strictEqual(ova10?.claim_token, null, 'Scenario 10: Expired claim token cleared');
  assert.strictEqual(ova10?.claim_expires_at, null, 'Scenario 10: Expired claim expiry cleared');
  const line10 = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line10`]);
  assert.strictEqual(line10?.sync_status, 'SYNCHRONIZED', 'Scenario 10: Line marked SYNCHRONIZED');

  // Assertions for Scenario 11:
  const ova11 = await db.getOne<any>('SELECT * FROM organization_voice_assistants WHERE organization_id = $1', [org11]);
  assert.strictEqual(ova11?.provisioning_status, 'READY', 'Scenario 11: Mixed lines backfilled to READY based on consistent non-null ID');
  assert.strictEqual(ova11?.vapi_assistant_id, 'asst-org11-valid', 'Scenario 11: Assistant ID matches consistent non-null line');
  const line11a = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line11_a`]);
  const line11b = await db.getOne<any>('SELECT * FROM voice_phone_numbers WHERE id = $1', [`${prefix}_line11_b`]);
  assert.strictEqual(line11a?.sync_status, 'SYNCHRONIZED', 'Scenario 11: Valid line marked SYNCHRONIZED');
  assert.strictEqual(line11b?.sync_status, 'PENDING', 'Scenario 11: NULL line marked PENDING');
  assert.strictEqual(line11a?.vapi_assistant_id, 'asst-org11-valid', 'Scenario 11: Line 11a ID preserved');
  assert.strictEqual(line11b?.vapi_assistant_id, null, 'Scenario 11: Line 11b NULL preserved');

  // -------------------------------------------------------------------------
  // Scenario 12: Idempotency & Repeatability Verification
  // -------------------------------------------------------------------------
  console.log('Testing Idempotency on Second Execution...');
  const snapshotBefore = await db.query<any>(
    `SELECT organization_id, vapi_assistant_id, provisioning_status, claim_token 
     FROM organization_voice_assistants 
     WHERE organization_id LIKE $1 
     ORDER BY organization_id`,
    [`${prefix}%`]
  );

  const linesSnapshotBefore = await db.query<any>(
    `SELECT id, organization_id, phone_number, vapi_assistant_id, sync_status 
     FROM voice_phone_numbers 
     WHERE organization_id LIKE $1 
     ORDER BY id`,
    [`${prefix}%`]
  );

  // Re-run backfill via CLI execute mode
  await runVoiceBackfillCli(['--execute']);

  const snapshotAfter = await db.query<any>(
    `SELECT organization_id, vapi_assistant_id, provisioning_status, claim_token 
     FROM organization_voice_assistants 
     WHERE organization_id LIKE $1 
     ORDER BY organization_id`,
    [`${prefix}%`]
  );

  const linesSnapshotAfter = await db.query<any>(
    `SELECT id, organization_id, phone_number, vapi_assistant_id, sync_status 
     FROM voice_phone_numbers 
     WHERE organization_id LIKE $1 
     ORDER BY id`,
    [`${prefix}%`]
  );

  assert.deepStrictEqual(
    snapshotBefore.rows,
    snapshotAfter.rows,
    'Scenario 12: Re-running backfill must result in identical organization_voice_assistants records (Idempotency)'
  );

  assert.deepStrictEqual(
    linesSnapshotBefore.rows,
    linesSnapshotAfter.rows,
    'Scenario 12: Re-running backfill must preserve all voice_phone_numbers records (Idempotency)'
  );

  // Re-running dry-run after backfill should propose zero new mutations on reconciled orgs
  const postDryRun = await VoiceBackfillService.dryRun(db);
  const reconciledItems = postDryRun.items.filter(i => i.organizationId.startsWith(prefix));
  for (const item of reconciledItems) {
    assert(
      item.proposedAction.startsWith('NO_OP'),
      `Post-backfill dry-run action for ${item.organizationId} should be NO_OP, got: ${item.proposedAction}`
    );
  }

  // -------------------------------------------------------------------------
  // Data Protection Verification across ALL scenarios
  // -------------------------------------------------------------------------
  const allTestLines = await db.query<any>(
    `SELECT id, organization_id, phone_number, vapi_assistant_id 
     FROM voice_phone_numbers 
     WHERE organization_id LIKE $1`,
    [`${prefix}%`]
  );

  assert(allTestLines.rows.length >= 13, 'All 13 test phone lines must still exist');
  for (const line of allTestLines.rows) {
    assert(line.phone_number.startsWith('+1555'), 'Phone numbers must never be modified');
    assert(line.id.startsWith(prefix), 'Phone line IDs must never be modified');
  }

  console.log('✅ ALL 12 VOICE BACKFILL & MIGRATION SCENARIOS VERIFIED SUCCESSFULLY');
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('voice-backfill-and-migration.test'))) {
  runVoiceBackfillAndMigrationTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

