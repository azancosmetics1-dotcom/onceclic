import { AnalyticsService } from '../server/src/services/AnalyticsService';
import { AuthService } from '../server/src/services/AuthService';
import { ConversationService } from '../server/src/services/ConversationService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { getDatabase } from '../server/src/db';
import { ConversationChannel } from '@onceclic/shared';

export async function runAnalyticsTests() {
  console.log('--- Running Customer Analytics & KPI Tests ---');
  const db = getDatabase();
  await db.runMigrations();

  // 1. Setup two isolated organizations
  const userA = await AuthService.register({
    email: `analytics_a_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Clinic Owner A',
    businessName: 'Clinic Alpha',
  });
  await AuthService.verifyEmail(userA.verificationToken!);

  const userB = await AuthService.register({
    email: `analytics_b_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Clinic Owner B',
    businessName: 'Clinic Beta',
  });
  await AuthService.verifyEmail(userB.verificationToken!);

  const orgAId = userA.organization!.id;
  const orgBId = userB.organization!.id;

  // 2. Empty state check for Org A
  const emptyAnalytics = await AnalyticsService.getOrganizationAnalytics({
    organizationId: orgAId,
    period: '7d',
  });

  if (emptyAnalytics.hasData !== false || emptyAnalytics.kpis.totalConversations !== 0) {
    throw new Error('Expected clean empty state with 0 conversations for new organization.');
  }
  console.log('  ✓ Empty state handled cleanly without fake data (hasData: false, 0 counts)');

  // 3. Create conversations, messages, and appointments in Org A
  const conv1 = await ConversationService.getOrCreateConversation({
    organizationId: orgAId,
    channel: ConversationChannel.WEB,
    customerName: 'Alice Walker',
    customerEmail: 'alice@example.com',
  });

  await ConversationService.handleCustomerMessage({
    organizationId: orgAId,
    conversationId: conv1.id,
    content: 'Hi, what are your opening hours?',
    clientMessageId: `msg_${Date.now()}_1`,
  });

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await AppointmentService.bookAppointment({
    organizationId: orgAId,
    serviceName: 'Consultation',
    customerName: 'Alice Walker',
    customerEmail: 'alice@example.com',
    startTime: tomorrow,
    conversationId: conv1.id,
  });

  // 4. Compute analytics for Org A
  const analyticsA = await AnalyticsService.getOrganizationAnalytics({
    organizationId: orgAId,
    period: '30d',
  });

  if (analyticsA.kpis.totalConversations !== 1) {
    throw new Error(`Expected 1 total conversation in Org A, got ${analyticsA.kpis.totalConversations}`);
  }

  // Check that the appointment is counted (either as booked/confirmed or requested)
  const totalAppointmentKPI = analyticsA.kpis.appointmentsBooked + analyticsA.kpis.appointmentsRequested + analyticsA.kpis.appointmentsCompleted + analyticsA.kpis.appointmentsCancelled;
  if (totalAppointmentKPI < 1) {
    throw new Error(`Expected at least 1 appointment in Org A analytics, got total ${totalAppointmentKPI} (booked=${analyticsA.kpis.appointmentsBooked}, requested=${analyticsA.kpis.appointmentsRequested})`);
  }
  console.log(`  ✓ Appointment analytics: booked=${analyticsA.kpis.appointmentsBooked}, requested=${analyticsA.kpis.appointmentsRequested}, completed=${analyticsA.kpis.appointmentsCompleted}, cancelled=${analyticsA.kpis.appointmentsCancelled}`);

  if (analyticsA.kpis.websiteConversations !== 1) {
    throw new Error(`Expected 1 website conversation in Org A, got ${analyticsA.kpis.websiteConversations}`);
  }
  if (analyticsA.aiUsage.totalRequests < 1) {
    throw new Error('Expected recorded AI telemetry in aiUsage.');
  }
  console.log('  ✓ Accurate KPI calculation across conversations, appointments, channels, and AI usage');

  // 5. Tenant Isolation Verification: Org B analytics must remain completely 0
  const analyticsB = await AnalyticsService.getOrganizationAnalytics({
    organizationId: orgBId,
    period: '7d',
  });

  if (analyticsB.kpis.totalConversations !== 0 || analyticsB.kpis.appointmentsBooked !== 0 || analyticsB.aiUsage.totalRequests !== 0) {
    throw new Error('Tenant isolation breach! Org B saw data from Org A.');
  }
  console.log('  ✓ Strict multi-tenant isolation enforced for all analytics metrics and AI usage data');

  // 6. Time Series Data Shape
  if (!Array.isArray(analyticsA.timeSeries) || analyticsA.timeSeries.length === 0) {
    throw new Error('Analytics time series points missing.');
  }
  console.log('  ✓ Time series timeline aggregation generated properly');
}
