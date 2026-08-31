import { AuthService } from '../server/src/services/AuthService';
import { ConversationService } from '../server/src/services/ConversationService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { ConversationChannel, KnowledgeSourceType } from '@onceclic/shared';

export async function runTenantIsolationTests() {
  console.log('--- Running Multi-Tenant Isolation Tests ---');

  // 1. Create Organization A
  const orgA = await AuthService.register({
    email: `orgA_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Alice OrgA',
    businessName: 'Organization Alpha',
  });

  // 2. Create Organization B
  const orgB = await AuthService.register({
    email: `orgB_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Bob OrgB',
    businessName: 'Organization Beta',
  });

  const orgAId = orgA.organization!.id;
  const orgBId = orgB.organization!.id;

  // 3. Create appointment in Org A
  const apptA = await AppointmentService.bookAppointment({
    organizationId: orgAId,
    serviceName: 'Alpha Consultation',
    customerName: 'Customer Alpha',
    customerEmail: 'alpha.customer@example.com',
    startTime: new Date(Date.now() + 86400000).toISOString(),
  });

  // 4. Create conversation in Org A
  const convA = await ConversationService.getOrCreateConversation({
    organizationId: orgAId,
    channel: ConversationChannel.WEB,
    customerName: 'Customer Alpha',
    customerEmail: 'alpha.customer@example.com',
  });

  // 5. Create knowledge source in Org A
  const knowA = await KnowledgeService.addSource({
    organizationId: orgAId,
    sourceType: KnowledgeSourceType.FAQ,
    title: 'Secret Alpha FAQ',
    rawContent: 'Alpha Secret Strategy',
  });

  // Test: Org B queries appointments -> Must NOT see Org A appointment
  const apptsB = await AppointmentService.listAppointments({ organizationId: orgBId });
  const hasApptA = apptsB.some((a) => a.id === apptA.id || a.customerEmail === 'alpha.customer@example.com');
  if (hasApptA) {
    throw new Error('Tenant Isolation Failure: Organization B can see Organization A appointments!');
  }
  console.log('  ✓ Organization B cannot access Organization A appointments');

  // Test: Org B queries conversations -> Must NOT see Org A conversation
  const convsB = await ConversationService.listConversations({ organizationId: orgBId });
  const hasConvA = convsB.some((c) => c.id === convA.id);
  if (hasConvA) {
    throw new Error('Tenant Isolation Failure: Organization B can see Organization A conversations!');
  }
  console.log('  ✓ Organization B cannot access Organization A conversations');

  // Test: Org B queries knowledge -> Must NOT see Org A knowledge
  const knowB = await KnowledgeService.listSources(orgBId);
  const hasKnowA = knowB.some((k) => k.title === 'Secret Alpha FAQ');
  if (hasKnowA) {
    throw new Error('Tenant Isolation Failure: Organization B can see Organization A knowledge sources!');
  }
  console.log('  ✓ Organization B cannot access Organization A knowledge sources');

  // Test: Org B attempts to delete Org A knowledge -> Must return false
  const deleted = await KnowledgeService.deleteSource(orgBId, knowA.id);
  if (deleted) {
    throw new Error('Tenant Isolation Failure: Organization B was able to delete Organization A knowledge source!');
  }
  console.log('  ✓ Organization B cannot modify or delete Organization A data');
}
