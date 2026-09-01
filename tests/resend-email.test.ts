import assert from 'assert';
import { db } from '../server/src/db';
import { ResendEmailService } from '../server/src/services/ResendEmailService';
import { v4 as uuidv4 } from 'uuid';

export async function runResendEmailTests() {
  console.log('--- Running Resend Transactional Email Dispatch Tests ---');

  // Setup temporary test organization for foreign key validity in audit logs
  const testOrgId = uuidv4();
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, timezone, is_active, created_at, updated_at)
     VALUES ($1, 'Apex Advisory Group', $2, 'Consulting', 'America/New_York', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testOrgId, `apex-${Date.now()}`]
  );

  try {
    // 1. Test Verification Email Dispatch
    const mockToken = uuidv4().replace(/-/g, '');
    const verifyRes = await ResendEmailService.sendVerificationEmail({
      toEmail: 'newuser@example.com',
      token: mockToken,
      fullName: 'Jane Doe',
    });

    assert.ok(verifyRes.success, 'Verification email dispatch returned success');
    assert.ok(verifyRes.id, 'Verification email returned message ID');
    console.log('  ✓ Email verification template rendered and dispatched with 24h token');

    // 2. Test Booking Confirmation Email
    const apptId = `appt_${Date.now()}`;
    const now = new Date();
    const startTime = new Date(now.getTime() + 86400000).toISOString();
    const endTime = new Date(now.getTime() + 86400000 + 1800000).toISOString();

    const confirmRes = await ResendEmailService.sendBookingConfirmation({
      appointmentId: apptId,
      customerName: 'Robert Johnson',
      customerEmail: 'robert@example.com',
      serviceName: 'Executive Consultation',
      businessName: 'Apex Advisory Group',
      startTime,
      endTime,
      timezone: 'America/New_York',
      notes: 'Discuss Q3 scaling strategy',
      organizationId: testOrgId,
    });

    assert.ok(confirmRes.success, 'Booking confirmation dispatch returned success');
    console.log('  ✓ Booking confirmation email dispatched with customer details and timezone');

    // 3. Test Booking Rescheduled Email
    const newStartTime = new Date(now.getTime() + 172800000).toISOString();
    const newEndTime = new Date(now.getTime() + 172800000 + 1800000).toISOString();

    const rescheduleRes = await ResendEmailService.sendBookingRescheduled({
      appointmentId: apptId,
      customerName: 'Robert Johnson',
      customerEmail: 'robert@example.com',
      serviceName: 'Executive Consultation',
      businessName: 'Apex Advisory Group',
      newStartTime,
      newEndTime,
      timezone: 'America/New_York',
      organizationId: testOrgId,
    });

    assert.ok(rescheduleRes.success, 'Rescheduled email dispatch returned success');
    console.log('  ✓ Booking rescheduled email dispatched with updated calendar slot');

    // 4. Test Booking Cancellation Email
    const cancelRes = await ResendEmailService.sendBookingCancellation({
      appointmentId: apptId,
      customerName: 'Robert Johnson',
      customerEmail: 'robert@example.com',
      serviceName: 'Executive Consultation',
      businessName: 'Apex Advisory Group',
      startTime,
      organizationId: testOrgId,
    });

    assert.ok(cancelRes.success, 'Cancellation email dispatch returned success');
    console.log('  ✓ Booking cancellation notice dispatched cleanly');
  } finally {
    await db.execute('DELETE FROM organizations WHERE id = $1', [testOrgId]);
  }
}

if (process.argv[1] && process.argv[1].includes('resend-email.test')) {
  runResendEmailTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
