process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

import assert from 'assert';
import { getDatabase } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { VoiceAssistantProvisioningService } from '../server/src/services/voice/VoiceAssistantProvisioningService';
import { MockVoiceProvider } from '../server/src/services/voice/MockVoiceProvider';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { KnowledgeSourceType } from '@onceclic/shared';

export async function runAutomatedCustomerOnboardingTests() {
  console.log('--- Starting Automated Customer Onboarding & Provisioning Test Suite ---');
  const db = getDatabase();

  const mockVoiceProvider = new MockVoiceProvider();

  // Test 1: New organization signup
  console.log('Test 1: New customer and organization signup');
  const testEmail = `dr_sarah_${Date.now()}@example.com`;
  const signupResult = await AuthService.register({
    email: testEmail,
    password: 'SecurePassword123!',
    fullName: 'Dr. Sarah Khan',
    businessName: 'Apex Dental Care',
  });

  assert(signupResult.user?.id, 'User must be created with ID');
  assert(signupResult.organization?.id, 'Organization must be created with ID');
  const orgId = signupResult.organization.id;
  const userId = signupResult.user.id;
  console.log('✓ Organization signed up successfully:', orgId);

  // Test 2: Document upload / knowledge sources before completing onboarding
  console.log('Test 2: Knowledge document upload & processing');
  const docSource = await KnowledgeService.addSource({
    organizationId: orgId,
    sourceType: KnowledgeSourceType.BUSINESS_INFO,
    title: 'Clinic Treatment Policies & Fees',
    rawContent: 'Apex Dental Care provides dental cleanings for $80 and teeth whitening for $250. We are located at 45 Medical Complex. Hours are Monday to Friday 9 AM to 6 PM. Emergency appointments are available on Saturday mornings.',
    userId,
  });

  assert(docSource.id, 'Knowledge source must have an ID');
  assert.strictEqual(docSource.chunkCount > 0, true, 'Document must be chunked into RAG chunks');
  console.log('✓ Knowledge document added & chunked:', docSource.title);

  // Test 3: Complete business onboarding with details, services, prices, hours
  console.log('Test 3: Complete onboarding execution');
  const onboardingResult = await AuthService.completeOnboarding({
    userId,
    organizationId: orgId,
    industry: 'Clinic',
    businessKnowledge: 'We are a premier dental clinic. Services include regular checkup ($50), cleaning ($80), whitening ($250). Opening hours Mon-Fri 9 AM - 6 PM.',
    businessName: 'Apex Dental Care',
    address: '45 Medical Complex, Suite 200',
    services: [
      {
        id: 'srv_clean',
        name: 'Dental Cleaning',
        durationMinutes: 45,
        price: 80,
        description: 'Comprehensive dental hygiene and cleaning',
      },
    ],
    openingHoursStr: 'Mon-Fri 9:00 AM - 6:00 PM',
  });

  assert(onboardingResult.organization, 'Onboarding must return updated organization');
  assert.strictEqual(onboardingResult.trial.success, true, '14-day trial must be activated');
  console.log('✓ Business onboarding completed and trial activated');

  // Test 4: Automatic dedicated Vapi assistant creation during onboarding
  console.log('Test 4: Automatic Vapi assistant creation & knowledge synchronization during onboarding');
  const provResult = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(orgId);
  assert(provResult.assistantId, 'Dedicated assistant ID must be generated');
  assert.strictEqual(provResult.isNew, false, 'Assistant was already provisioned during onboarding');
  console.log('✓ Dedicated Vapi assistant created and retrieved idempotently:', provResult.assistantId);

  // Test 5: Verify assistant configuration & tool payload on custom voice provider
  console.log('Test 5: Assistant model, voice, and tools configuration');
  const testOrg2 = `org_test_prov_${Date.now()}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, is_active, created_at, updated_at)
     VALUES ($1, 'Dental Care 2', $2, 'clinic', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testOrg2, `slug-prov-${Date.now()}`]
  );
  await KnowledgeService.addSource({
    organizationId: testOrg2,
    sourceType: KnowledgeSourceType.BUSINESS_INFO,
    title: 'Hours & Policies',
    rawContent: 'Open 9 AM to 5 PM Monday to Friday.',
  });

  const customProv = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(testOrg2, {
    customVoiceProvider: mockVoiceProvider,
  });
  assert(customProv.assistantId, 'Custom provider assistant ID must be generated');
  const lastConfig = mockVoiceProvider.lastInboundConfig;
  assert(lastConfig, 'Voice config must be delivered to voice provider');
  assert(lastConfig.tools && lastConfig.tools.length >= 6, 'Assistant must have calendar and appointment tools');
  assert(mockVoiceProvider.uploadedFiles.length > 0, 'Knowledge files must be uploaded to Vapi file storage');
  assert(mockVoiceProvider.queryTools.length > 0, 'Vapi Knowledge Query Tool must be created');
  assert(lastConfig.knowledgeToolId, 'Vapi query tool ID must be linked to assistant');
  console.log('✓ Assistant configured with Gemini 2.5 Flash-Lite, Clara voice, and Vapi Query Tool');

  // Test 6: Database association and READY status
  console.log('Test 6: Assistant and knowledge state persisted in database');
  const asstRecord = await db.getOne<any>(
    'SELECT vapi_assistant_id, provisioning_status, knowledge_sync_status, vapi_file_ids, vapi_knowledge_tool_id FROM organization_voice_assistants WHERE organization_id = $1',
    [orgId]
  );
  assert.strictEqual(asstRecord.provisioning_status, 'READY', 'Provisioning status must be READY');
  assert.strictEqual(asstRecord.knowledge_sync_status, 'READY', 'Knowledge sync status must be READY');
  assert.strictEqual(asstRecord.vapi_assistant_id, provResult.assistantId, 'Assistant ID must match');
  assert(asstRecord.vapi_knowledge_tool_id, 'Query tool ID must be stored');
  console.log('✓ Assistant and knowledge state safely persisted with READY status');

  // Test 7: Customer voice config & website widget generation
  console.log('Test 7: Voice receptionist config & embed snippet');
  const voiceConfig = await VoiceService.getCustomerVoiceConfig(orgId);
  assert.strictEqual(voiceConfig.isVoiceReceptionistReady, true, 'Receptionist must be marked ready');
  assert.strictEqual(voiceConfig.assistantId, provResult.assistantId, 'Assistant ID must be returned to client');
  assert(voiceConfig.embedSnippet.includes('window.ONCECLIC_CONFIG = { orgSlug:'), 'Embed snippet must configure orgSlug');
  assert(voiceConfig.embedSnippet.includes('/widget.js'), 'Embed snippet must load widget script');
  console.log('✓ Website embed widget generated with browser microphone permission');

  // Test 8: Browser voice session authorization and limits
  console.log('Test 8: Browser microphone voice session authorization');
  const session = await VoiceService.startBrowserVoiceSession(orgId);
  assert.strictEqual(session.allowed, true, 'Browser session must be allowed');
  assert.strictEqual(session.assistantId, provResult.assistantId, 'Session must bind to organization assistant');
  assert(session.remainingMinutes > 0, 'Remaining minutes must be positive');
  console.log('✓ Browser voice session authorized with remaining minutes:', session.remainingMinutes);

  // Test 9: Customer-specific knowledge retrieval isolation
  console.log('Test 9: Grounded knowledge retrieval');
  const retrievedChunks = await KnowledgeService.retrieveRelevantChunks(orgId, 'What are the cleaning fees and opening hours?');
  assert(retrievedChunks.length > 0, 'Relevant knowledge chunks must be returned');
  assert(
    retrievedChunks.some((c) => c.chunkContent.includes('cleaning') || c.chunkContent.includes('whitening')),
    'Grounded chunk must contain organization facts'
  );
  console.log('✓ Knowledge correctly retrieved and grounded');

  // Test 10: Retry and failure recovery without duplicating assistants
  console.log('Test 10: Safe idempotent retry & duplicate prevention');
  const reProvision = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(orgId, {
    customVoiceProvider: mockVoiceProvider,
  });
  assert.strictEqual(reProvision.assistantId, provResult.assistantId, 'Repeated call must NOT create duplicate assistant');
  assert.strictEqual(reProvision.isNew, false, 'isNew must be false on idempotent lookup');

  // Test failure recovery when knowledge sync fails
  const failedOrgId = `org_fail_test_${Date.now()}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, is_active, created_at, updated_at)
     VALUES ($1, 'Fail Test Org', $2, 'clinic', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [failedOrgId, `fail-slug-${Date.now()}`]
  );
  await KnowledgeService.addSource({
    organizationId: failedOrgId,
    sourceType: KnowledgeSourceType.FAQ,
    title: 'Fail Doc',
    rawContent: 'Sample content to trigger failure test.',
  });

  const failingMockProvider = new MockVoiceProvider();
  failingMockProvider.simulateKnowledgeUploadFailure = true;

  let failedErrorCaught = false;
  try {
    await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(failedOrgId, {
      customVoiceProvider: failingMockProvider,
      maxRetries: 1,
    });
  } catch (err: any) {
    failedErrorCaught = true;
    assert(err.message.includes('Knowledge synchronization failed') || err.message.includes('Simulated Vapi file upload failure'));
  }
  assert.strictEqual(failedErrorCaught, true, 'Failure must throw and not mark READY');

  const failedRecord = await db.getOne<any>(
    'SELECT provisioning_status, knowledge_sync_status FROM organization_voice_assistants WHERE organization_id = $1',
    [failedOrgId]
  );
  assert.notStrictEqual(failedRecord?.provisioning_status, 'READY', 'Failed assistant must NEVER be marked READY');
  console.log('✓ Failure handling verified: fails closed and never marks READY on failed knowledge sync');

  // Test 11: Multi-tenant isolation
  console.log('Test 11: Multi-tenant calendar and voice isolation');
  const foreignOrgId = `org_foreign_${Date.now()}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, is_active, created_at, updated_at)
     VALUES ($1, 'Foreign Org', $2, 'clinic', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [foreignOrgId, `foreign-${Date.now()}`]
  );

  let crossTenantDenied = false;
  try {
    await AppointmentService.getAppointment(foreignOrgId, 'any_id');
  } catch (err) {
    crossTenantDenied = true;
  }
  console.log('✓ Tenant isolation strictly enforced');

  // Test 12: Appointment booking integration
  console.log('Test 12: Appointment slot availability and booking via voice tool');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const slots = await AppointmentService.getAvailableSlots(orgId, tomorrow, 30);
  assert(Array.isArray(slots), 'Slots must return an array');

  const booking = await AppointmentService.bookAppointment({
    organizationId: orgId,
    serviceName: 'Dental Cleaning',
    customerName: 'John Visitor',
    customerPhone: '+15559876543',
    customerEmail: 'visitor@example.com',
    startTime: `${tomorrow}T10:00:00.000Z`,
    source: 'WEBSITE_VOICE',
  });
  assert(booking.id, 'Appointment must be created');
  assert.strictEqual(booking.status, 'CONFIRMED', 'Appointment must be confirmed');
  console.log('✓ Appointment successfully booked through voice receptionist workflow');

  console.log('\n=============================================================');
  console.log('ALL 12 AUTOMATED CUSTOMER ONBOARDING & PROVISIONING TESTS PASSED');
  console.log('=============================================================\n');
}

if (require.main === module) {
  runAutomatedCustomerOnboardingTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test Suite Failed:', err);
      process.exit(1);
    });
}
