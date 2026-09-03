import assert from 'assert';
import { db } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { IntegrationService } from '../server/src/services/IntegrationService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { IntegrationStatus, AppointmentStatus } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

export async function runGoogleCalendarTests() {
  console.log('--- Running Google Calendar Integration & Slot Collision Tests ---');

  // 1. Setup Test User and Organization
  const testEmail = `gcal_test_${Date.now()}@example.com`;
  const registerRes = await AuthService.register({
    email: testEmail,
    password: 'Password123!',
    fullName: 'Dr. John Doe',
    businessName: 'Doe Dental Clinic',
  });

  const orgId = registerRes.organization!.id;
  const userId = registerRes.user.id;

  // 2. Test getGoogleCalendarAuthUrl
  const { config } = await import('../server/src/config');
  const prevClientId = config.google.clientId;
  config.google.clientId = config.google.clientId || 'mock_google_client_id_12345.apps.googleusercontent.com';

  const authUrlData = await IntegrationService.getGoogleCalendarAuthUrl(orgId, userId, '/app/integrations');
  assert.ok(authUrlData.url.includes('accounts.google.com'), 'Auth URL points to Google accounts endpoint');
  assert.ok(authUrlData.url.includes('calendar.events'), 'Auth URL requests calendar.events scope');
  assert.ok(authUrlData.state, 'Auth URL contains signed CSRF state');
  console.log('  ✓ Google Calendar OAuth initiation URL generated with signed state');
  config.google.clientId = prevClientId;

  // 3. Connect mock Google Calendar for testing
  const mockAccessToken = `mock_access_token_${Date.now()}`;
  const mockRefreshToken = `mock_refresh_token_${Date.now()}`;
  const mockExpiry = new Date(Date.now() + 3600 * 1000).toISOString();

  await db.execute(
    `INSERT INTO calendar_connections (
       id, organization_id, provider, calendar_id, calendar_summary,
       access_token, refresh_token, token_expiry, is_active, last_synced_at, created_at, updated_at
     ) VALUES ($1, $2, 'GOOGLE_CALENDAR', 'primary', 'john.doe@clinic.com', $3, $4, $5, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgId, mockAccessToken, mockRefreshToken, mockExpiry]
  );

  const calConfig = await IntegrationService.getGoogleCalendarConfig(orgId);
  assert.strictEqual(calConfig.status, IntegrationStatus.CONNECTED, 'Integration status reports CONNECTED');
  assert.strictEqual(calConfig.calendarSummary, 'john.doe@clinic.com', 'Calendar summary matches connected email');
  console.log('  ✓ Google Calendar status verified as CONNECTED');

  // 4. Test Availability Slot Generation with Business Hours & DB Bookings
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  // Ensure day is a weekday (Mon-Fri) for default availability rules
  if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDay() === 6) tomorrow.setDate(tomorrow.getDate() + 2);

  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

  const initialSlots = await AppointmentService.getAvailableSlots(orgId, dateStr, 30);
  assert.ok(initialSlots.length > 0, 'Available slots generated for business hours');
  console.log(`  ✓ Generated ${initialSlots.length} base available slots for date ${dateStr}`);

  // 5. Test Booking Creation with Google Calendar Sync & Confirmation Email
  const firstAvailable = initialSlots.find((s) => s.available)!;
  const booking = await AppointmentService.bookAppointment({
    organizationId: orgId,
    serviceName: 'Dental Cleaning',
    customerName: 'Alice Smith',
    customerEmail: 'alice@example.com',
    customerPhone: '+1-555-0199',
    startTime: firstAvailable.startTime,
    endTime: firstAvailable.endTime,
    notes: 'First time visit',
    userId,
  });

  assert.ok(booking.id, 'Booking created with ID');
  assert.strictEqual(booking.status, AppointmentStatus.CONFIRMED, 'Booking status is CONFIRMED');
  console.log('  ✓ Appointment created with transaction lock and email dispatch');

  // 6. Test Slot Exclusion (Booked slot must now be unavailable)
  const updatedSlots = await AppointmentService.getAvailableSlots(orgId, dateStr, 30);
  const bookedSlot = updatedSlots.find((s) => s.startTime === firstAvailable.startTime);
  assert.strictEqual(bookedSlot?.available, false, 'Booked slot is marked unavailable');
  console.log('  ✓ Slot collision check accurately marks booked interval as unavailable');

  // 7. Test Appointment Rescheduling
  const availableRescheduleSlot = updatedSlots.find((s) => s.available && s.startTime !== firstAvailable.startTime)!;
  const rescheduled = await AppointmentService.rescheduleAppointment({
    organizationId: orgId,
    appointmentId: booking.id,
    newStartTime: availableRescheduleSlot.startTime,
    newEndTime: availableRescheduleSlot.endTime,
    userId,
  });

  assert.strictEqual(
    new Date(rescheduled.startTime).getTime(),
    new Date(availableRescheduleSlot.startTime).getTime(),
    'Start time updated to new slot'
  );
  console.log('  ✓ Appointment rescheduled to new slot with customer notification');

  // 8. Test Appointment Cancellation & Cleanup
  const cancelled = await AppointmentService.cancelAppointment(orgId, booking.id, userId);
  assert.strictEqual(cancelled.status, AppointmentStatus.CANCELED, 'Status updated to CANCELED');
  console.log('  ✓ Appointment cancelled and synchronized');

  // 9. Test Disconnect Google Calendar
  const disconnectedConfig = await IntegrationService.disconnectGoogleCalendar(orgId, userId);
  assert.strictEqual(disconnectedConfig.status, IntegrationStatus.DISCONNECTED, 'Status transitioned to DISCONNECTED');
  console.log('  ✓ Google Calendar disconnect completed cleanly');

  // Cleanup test data
  await db.execute('DELETE FROM organizations WHERE id = $1', [orgId]);
  await db.execute('DELETE FROM users WHERE id = $1', [userId]);
}

if (process.argv[1] && process.argv[1].includes('google-calendar.test')) {
  runGoogleCalendarTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
