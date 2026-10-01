import assert from 'assert';
import { db } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { ResendEmailService } from '../server/src/services/ResendEmailService';
import { AuditAction } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

export async function runOwnerNotificationTests() {
  console.log('--- Running Business Owner Appointment Notification Tests ---');

  // Track all dispatched emails for assertions
  const dispatchedEmails: Array<{
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
  }> = [];

  const originalSendEmail = ResendEmailService.sendEmail;

  ResendEmailService.sendEmail = async (options) => {
    dispatchedEmails.push(options);
    return {
      success: true,
      id: `mock_email_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      isSimulated: true,
    };
  };

  try {
    // ==========================================================
    // 1. CLINIC APPOINTMENT BOOKING & OWNER NOTIFICATION TEST
    // ==========================================================
    console.log('1. Testing Clinic New-Appointment Flow...');
    dispatchedEmails.length = 0;

    const clinicOwnerEmail = `clinic_owner_${Date.now()}@example.com`;
    const clinicAuth = await AuthService.register({
      email: clinicOwnerEmail,
      password: 'password123',
      fullName: 'Dr. Gregory House',
      businessName: 'Princeton Diagnostics Clinic',
    });
    const clinicOrgId = clinicAuth.organization!.id;

    // Reset dispatched emails after registration
    dispatchedEmails.length = 0;

    await db.execute(
      `UPDATE organizations SET business_type = $1 WHERE id = $2`,
      ['Dental & Medical Clinic', clinicOrgId]
    );

    await db.execute(
      `UPDATE business_settings SET services = $1 WHERE organization_id = $2`,
      [
        JSON.stringify([
          { id: 'srv_diag', name: 'Comprehensive Consultation', durationMinutes: 45, price: 150 },
        ]),
        clinicOrgId,
      ]
    );

    const clinicApptTime = new Date(Date.now() + 86400000).toISOString();
    const clinicApptEndTime = new Date(Date.now() + 86400000 + 45 * 60000).toISOString();

    const clinicAppt = await AppointmentService.bookAppointment({
      organizationId: clinicOrgId,
      serviceName: 'Comprehensive Consultation',
      customerName: 'John Patient',
      customerEmail: 'patient.john@example.com',
      customerPhone: '+1-555-0192',
      startTime: clinicApptTime,
      endTime: clinicApptEndTime,
      notes: 'Initial checkup for toothache',
    });

    assert.strictEqual(clinicAppt.status, 'CONFIRMED', 'Clinic appointment status must be CONFIRMED');

    // Verify both emails were dispatched
    const clinicCustomerEmail = dispatchedEmails.find((e) =>
      (Array.isArray(e.to) ? e.to : [e.to]).includes('patient.john@example.com')
    );
    const clinicOwnerAlert = dispatchedEmails.find((e) =>
      (Array.isArray(e.to) ? e.to : [e.to]).includes(clinicOwnerEmail) &&
      !e.subject.includes('Verify your ONCEClic')
    );

    assert.ok(clinicCustomerEmail, 'Customer confirmation email must be sent');
    assert.ok(clinicOwnerAlert, 'Business owner alert email must be sent');

    assert.ok(
      clinicOwnerAlert.subject.includes('New Patient Appointment') ||
      clinicOwnerAlert.subject.includes('Comprehensive Consultation'),
      `Owner alert subject should be industry-specific: ${clinicOwnerAlert.subject}`
    );
    assert.ok(clinicOwnerAlert.html?.includes('John Patient'), 'Owner alert HTML must contain patient name');
    assert.ok(clinicOwnerAlert.html?.includes('patient.john@example.com'), 'Owner alert HTML must contain customer email');
    assert.ok(clinicOwnerAlert.html?.includes('+1-555-0192'), 'Owner alert HTML must contain customer phone');
    assert.ok(clinicOwnerAlert.html?.includes('$150'), 'Owner alert HTML must contain configured service price');
    assert.ok(clinicOwnerAlert.html?.includes('/app/appointments'), 'Owner alert HTML must contain dashboard appointments link');
    assert.ok(clinicOwnerAlert.html?.includes('Initial checkup for toothache'), 'Owner alert HTML must contain customer notes');

    // Verify audit logs for both events
    const clinicOwnerAudit = await db.getOne(
      'SELECT id FROM audit_logs WHERE organization_id = $1 AND entity_id = $2 AND action = $3',
      [clinicOrgId, clinicAppt.id, AuditAction.OWNER_NEW_BOOKING_EMAIL_SENT]
    );
    const clinicCustomerAudit = await db.getOne(
      'SELECT id FROM audit_logs WHERE organization_id = $1 AND entity_id = $2 AND action = $3',
      [clinicOrgId, clinicAppt.id, AuditAction.BOOKING_CONFIRMATION_EMAIL_SENT]
    );

    assert.ok(clinicOwnerAudit, 'Audit log for OWNER_NEW_BOOKING_EMAIL_SENT must exist');
    assert.ok(clinicCustomerAudit, 'Audit log for BOOKING_CONFIRMATION_EMAIL_SENT must exist');

    console.log('  ✓ Clinic appointment generated customer confirmation and owner notification with pricing & notes');

    // ==========================================================
    // 2. RESTAURANT TABLE RESERVATION & OWNER NOTIFICATION TEST
    // ==========================================================
    console.log('2. Testing Restaurant Table Reservation Flow...');
    dispatchedEmails.length = 0;

    const restOwnerEmail = `rest_owner_${Date.now()}@example.com`;
    const restAuth = await AuthService.register({
      email: restOwnerEmail,
      password: 'password123',
      fullName: 'Chef Luigi',
      businessName: 'Trattoria Bella',
    });
    const restOrgId = restAuth.organization!.id;

    // Reset dispatched emails after registration
    dispatchedEmails.length = 0;

    await db.execute(
      `UPDATE organizations SET business_type = $1 WHERE id = $2`,
      ['Italian Restaurant & Bar', restOrgId]
    );

    await db.execute(
      `UPDATE business_settings SET reservation_settings = $1 WHERE organization_id = $2`,
      [
        JSON.stringify({
          pricingType: 'deposit',
          depositAmount: 30,
          reservationFee: 0,
        }),
        restOrgId,
      ]
    );

    const restAppt = await AppointmentService.bookAppointment({
      organizationId: restOrgId,
      serviceName: 'Dinner Table',
      customerName: 'Marcus Diner',
      customerEmail: 'marcus@example.com',
      startTime: new Date(Date.now() + 172800000).toISOString(),
      notes: 'Party size: 4. Window table preferred.',
    });

    assert.strictEqual(restAppt.status, 'CONFIRMED');

    const restOwnerAlert = dispatchedEmails.find((e) =>
      (Array.isArray(e.to) ? e.to : [e.to]).includes(restOwnerEmail) &&
      !e.subject.includes('Verify your ONCEClic')
    );
    assert.ok(restOwnerAlert, 'Restaurant owner alert email must be dispatched');
    assert.ok(
      restOwnerAlert.subject.includes('New Table Reservation') || restOwnerAlert.subject.includes('Reservation'),
      `Subject should use restaurant terminology: ${restOwnerAlert.subject}`
    );
    assert.ok(restOwnerAlert.html?.includes('4 Guests'), 'Owner alert HTML must include party size');
    assert.ok(restOwnerAlert.html?.includes('$30'), 'Owner alert HTML must include deposit amount');
    assert.ok(restOwnerAlert.html?.includes('Marcus Diner'), 'Owner alert HTML must include guest name');

    console.log('  ✓ Restaurant reservation generated owner notification with party size, deposit, and guest details');

    // ==========================================================
    // 3. SALON SERVICE BOOKING & OWNER NOTIFICATION TEST
    // ==========================================================
    console.log('3. Testing Salon Service Booking Flow...');
    dispatchedEmails.length = 0;

    const salonOwnerEmail = `salon_owner_${Date.now()}@example.com`;
    const salonAuth = await AuthService.register({
      email: salonOwnerEmail,
      password: 'password123',
      fullName: 'Sophia Hair',
      businessName: 'Sophia Beauty Lounge',
    });
    const salonOrgId = salonAuth.organization!.id;

    // Reset dispatched emails after registration
    dispatchedEmails.length = 0;

    await db.execute(
      `UPDATE organizations SET business_type = $1 WHERE id = $2`,
      ['Hair & Nail Salon', salonOrgId]
    );

    await db.execute(
      `UPDATE business_settings SET services = $1 WHERE organization_id = $2`,
      [
        JSON.stringify([
          { id: 'srv_balayage', name: 'Balayage & Styling', durationMinutes: 90, price: 200 },
        ]),
        salonOrgId,
      ]
    );

    const salonAppt = await AppointmentService.bookAppointment({
      organizationId: salonOrgId,
      serviceName: 'Balayage & Styling',
      customerName: 'Elena Client',
      customerEmail: 'elena@example.com',
      startTime: new Date(Date.now() + 259200000).toISOString(),
    });

    assert.strictEqual(salonAppt.status, 'CONFIRMED');

    const salonOwnerAlert = dispatchedEmails.find((e) =>
      (Array.isArray(e.to) ? e.to : [e.to]).includes(salonOwnerEmail) &&
      !e.subject.includes('Verify your ONCEClic')
    );
    assert.ok(salonOwnerAlert, 'Salon owner alert email must be dispatched');
    assert.ok(salonOwnerAlert.html?.includes('90 min'), 'Owner alert HTML must include duration');
    assert.ok(salonOwnerAlert.html?.includes('$200'), 'Owner alert HTML must include price');
    assert.ok(salonOwnerAlert.html?.includes('Elena Client'), 'Owner alert HTML must include client name');

    console.log('  ✓ Salon service booking generated owner notification with service duration and pricing');

    // ==========================================================
    // 4. MISSING OWNER EMAIL & MISSING OPTIONAL DATA TESTS
    // ==========================================================
    console.log('4. Testing Missing Data & Fallback Recipient Resolution...');
    dispatchedEmails.length = 0;

    // Org with no owner membership, but organization.email configured
    const fallbackOrgId = uuidv4();
    const fallbackOrgEmail = `business_contact_${Date.now()}@example.com`;
    await db.execute(
      `INSERT INTO organizations (id, name, slug, business_type, email, is_active, created_at, updated_at)
       VALUES ($1, 'Fallback Business', $2, 'Consulting', $3, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [fallbackOrgId, `fallback-${Date.now()}`, fallbackOrgEmail]
    );

    const recipient1 = await AppointmentService.getOwnerRecipient(fallbackOrgId);
    assert.ok(recipient1, 'Recipient resolution should fall back to organization email');
    assert.strictEqual(recipient1.email, fallbackOrgEmail);

    const fallbackAppt = await AppointmentService.bookAppointment({
      organizationId: fallbackOrgId,
      serviceName: 'General Consultation',
      customerName: 'Sam Fallback',
      customerEmail: 'sam@example.com',
      startTime: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.strictEqual(fallbackAppt.status, 'CONFIRMED');

    const fallbackAlert = dispatchedEmails.find((e) =>
      (Array.isArray(e.to) ? e.to : [e.to]).includes(fallbackOrgEmail)
    );
    assert.ok(fallbackAlert, 'Notification should be delivered to organization email when membership is absent');

    // Org with NO email at all
    dispatchedEmails.length = 0;
    const noEmailOrgId = uuidv4();
    await db.execute(
      `INSERT INTO organizations (id, name, slug, business_type, is_active, created_at, updated_at)
       VALUES ($1, 'No Email Business', $2, 'Consulting', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [noEmailOrgId, `no-email-${Date.now()}`]
    );

    const recipient2 = await AppointmentService.getOwnerRecipient(noEmailOrgId);
    assert.strictEqual(recipient2, null, 'Recipient resolution should return null if no owner/org email exists');

    const noEmailAppt = await AppointmentService.bookAppointment({
      organizationId: noEmailOrgId,
      serviceName: 'Inquiry Session',
      customerName: 'Dave Visitor',
      customerEmail: 'dave@example.com',
      startTime: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.strictEqual(noEmailAppt.status, 'CONFIRMED', 'Booking must succeed even when owner email is missing');

    console.log('  ✓ Missing owner email safely handled without failing appointment booking');

    // ==========================================================
    // 5. RESEND FAILURE SAFETY & INDEPENDENT ERROR ISOLATION
    // ==========================================================
    console.log('5. Testing Independent Resend Failure Safety...');

    // Mock Resend to throw exception
    ResendEmailService.sendEmail = async (options) => {
      const toStr = String(options.to);
      if (toStr.includes('owner')) {
        throw new Error('Resend API Network Timeout (504 Gateway Timeout)');
      }
      return { success: true, id: 'mock_ok' };
    };

    const failSafeAppt = await AppointmentService.bookAppointment({
      organizationId: clinicOrgId,
      serviceName: 'Emergency Consultation',
      customerName: 'Frank Emergency',
      customerEmail: 'frank@example.com',
      startTime: new Date(Date.now() + 3600000).toISOString(),
    });

    assert.strictEqual(failSafeAppt.status, 'CONFIRMED', 'Appointment must remain CONFIRMED despite email delivery failure');

    // Verify appointment is in database
    const dbAppt = await AppointmentService.getAppointmentById(clinicOrgId, failSafeAppt.id);
    assert.ok(dbAppt, 'Appointment must be committed in DB');
    assert.strictEqual(dbAppt.status, 'CONFIRMED');

    console.log('  ✓ Resend owner notification failure does NOT roll back or invalidate appointment');

    // Restore standard mock
    ResendEmailService.sendEmail = async (options) => {
      dispatchedEmails.push(options);
      return { success: true, id: `mock_${Date.now()}`, isSimulated: true };
    };

    // ==========================================================
    // 6. MULTI-TENANT ISOLATION FOR OWNER NOTIFICATIONS
    // ==========================================================
    console.log('6. Testing Multi-Tenant Isolation for Owner Notifications...');
    dispatchedEmails.length = 0;

    const orgATenant = await AuthService.register({
      email: `tenantA_owner_${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Tenant A Owner',
      businessName: 'Tenant A MedSpa',
    });
    const orgBTenant = await AuthService.register({
      email: `tenantB_owner_${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Tenant B Owner',
      businessName: 'Tenant B AutoCare',
    });

    const orgAId = orgATenant.organization!.id;
    const orgBId = orgBTenant.organization!.id;

    // Clear verification emails
    dispatchedEmails.length = 0;

    // Book appointment in Org A
    await AppointmentService.bookAppointment({
      organizationId: orgAId,
      serviceName: 'Facial Treatment',
      customerName: 'Secret Customer A',
      customerEmail: 'secretA@example.com',
      startTime: new Date(Date.now() + 86400000).toISOString(),
    });

    // Check emails received
    const orgAOwnerEmails = dispatchedEmails.filter((e) => {
      const recips = (Array.isArray(e.to) ? e.to : [e.to]).map((r) => r.toLowerCase());
      return recips.some((r) => r.includes('tenanta_owner'));
    });
    const orgBOwnerEmails = dispatchedEmails.filter((e) => {
      const recips = (Array.isArray(e.to) ? e.to : [e.to]).map((r) => r.toLowerCase());
      return recips.some((r) => r.includes('tenantb_owner'));
    });

    assert.strictEqual(orgAOwnerEmails.length, 1, 'Org A owner must receive exactly 1 new booking alert');
    assert.strictEqual(orgBOwnerEmails.length, 0, 'Org B owner must receive ZERO notifications for Org A bookings');

    console.log('  ✓ Strict Tenant Isolation: Org A booking only notifies Org A owner. Org B receives nothing.');

    // ==========================================================
    // 7. IDEMPOTENCY / DUPLICATE EMAIL PREVENTION TEST
    // ==========================================================
    console.log('7. Testing Idempotency & Duplicate Notification Prevention...');
    dispatchedEmails.length = 0;

    const testAppt = await AppointmentService.bookAppointment({
      organizationId: orgAId,
      serviceName: 'Skin Consultation',
      customerName: 'Idempotency User',
      customerEmail: 'idemp@example.com',
      startTime: new Date(Date.now() + 180000000).toISOString(),
    });

    const initialOwnerDispatches = dispatchedEmails.filter((e) => {
      const recips = (Array.isArray(e.to) ? e.to : [e.to]).map((r) => r.toLowerCase());
      return recips.some((r) => r.includes('tenanta_owner'));
    }).length;

    assert.strictEqual(initialOwnerDispatches, 1, 'Initial booking should dispatch 1 owner notification');

    // Simulate duplicate retry of sendOwnerBookingAlert
    await AppointmentService.sendOwnerBookingAlert({
      appointment: testAppt,
      organizationId: orgAId,
      businessName: 'Tenant A MedSpa',
      businessType: 'MedSpa',
    });

    const postRetryOwnerDispatches = dispatchedEmails.filter((e) => {
      const recips = (Array.isArray(e.to) ? e.to : [e.to]).map((r) => r.toLowerCase());
      return recips.some((r) => r.includes('tenanta_owner'));
    }).length;

    assert.strictEqual(
      postRetryOwnerDispatches,
      1,
      'Duplicate invocation must be prevented by database audit log idempotency'
    );

    console.log('  ✓ Idempotency verified: Duplicate alert invocations do not send repeated emails');

    // ==========================================================
    // 8. EMAIL SECURITY & SANITIZATION TEST
    // ==========================================================
    console.log('8. Testing Email Security & Zero-Secret Exposure...');

    const allDispatchedContent = dispatchedEmails.map((e) => `${e.subject} ${e.html || ''} ${e.text || ''}`).join(' ');

    const forbiddenSubstrings = [
      'sk_',
      'Bearer',
      'password_hash',
      'DATABASE_URL',
      'JWT_SECRET',
      'GOOGLE_CLIENT_SECRET',
      'COMPOSIO_API_KEY',
      'RESEND_API_KEY',
      'SYSTEM PROMPT',
      'ai_budget',
      'estimatedCostUsd',
    ];

    for (const forbidden of forbiddenSubstrings) {
      if (allDispatchedContent.includes(forbidden)) {
        throw new Error(`Security breach: Owner notification contains sensitive secret or internal prompt: "${forbidden}"`);
      }
    }

    console.log('  ✓ Email security verified: Zero internal keys, tokens, or system prompts in owner emails');

    console.log('====================================================');
    console.log('  ALL OWNER NOTIFICATION TESTS PASSED!');
    console.log('====================================================');
  } finally {
    ResendEmailService.sendEmail = originalSendEmail;
  }
}

if (process.argv[1] && process.argv[1].includes('owner-notification.test')) {
  runOwnerNotificationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
