import { AuthService } from '../server/src/services/AuthService';
import { AppointmentService } from '../server/src/services/AppointmentService';

export async function runAppointmentTests() {
  console.log('--- Running Appointment & Double-Booking Tests ---');

  const auth = await AuthService.register({
    email: `appt_owner_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Appt Tester',
    businessName: 'Apex Dental',
  });

  const orgId = auth.organization!.id;

  // 1. Check slots for a future Tuesday (e.g. 2026-09-01)
  const dateStr = '2026-09-01'; // Tuesday
  const slots = await AppointmentService.getAvailableSlots(orgId, dateStr, 30);

  if (slots.length === 0) {
    throw new Error('Expected available slots for business day (Tuesday).');
  }
  console.log(`  ✓ Available slot generator returned ${slots.length} valid slots for business day`);

  // 2. Book an appointment for 10:00 AM UTC
  const slotStart = `${dateStr}T10:00:00.000Z`;
  const slotEnd = `${dateStr}T10:30:00.000Z`;

  const appt1 = await AppointmentService.bookAppointment({
    organizationId: orgId,
    serviceName: 'Teeth Cleaning',
    customerName: 'Alice First',
    customerEmail: 'alice@example.com',
    startTime: slotStart,
    endTime: slotEnd,
  });

  if (!appt1.id || appt1.status !== 'CONFIRMED') {
    throw new Error('Appointment booking failed.');
  }
  console.log('  ✓ Customer 1 successfully booked appointment slot 10:00 AM - 10:30 AM');

  // 3. Concurrency / Double-Booking Prevention Test: Customer 2 attempts to book exact same slot
  let doubleBookingRejected = false;
  try {
    await AppointmentService.bookAppointment({
      organizationId: orgId,
      serviceName: 'Dental Checkup',
      customerName: 'Bob Second',
      customerEmail: 'bob@example.com',
      startTime: slotStart,
      endTime: slotEnd,
    });
  } catch (err: any) {
    doubleBookingRejected = err.message.includes('already been booked');
  }

  if (!doubleBookingRejected) {
    throw new Error('Double Booking Failure: Two customers were able to book the exact same time slot!');
  }
  console.log('  ✓ Double booking strictly prevented by transactional lock / conflict check');

  // 4. Overlapping slot prevention (e.g. 10:15 AM - 10:45 AM)
  let overlapRejected = false;
  try {
    await AppointmentService.bookAppointment({
      organizationId: orgId,
      serviceName: 'Consultation',
      customerName: 'Charlie Overlap',
      customerEmail: 'charlie@example.com',
      startTime: `${dateStr}T10:15:00.000Z`,
      endTime: `${dateStr}T10:45:00.000Z`,
    });
  } catch (err: any) {
    overlapRejected = err.message.includes('already been booked');
  }

  if (!overlapRejected) {
    throw new Error('Double Booking Failure: Overlapping appointment was allowed!');
  }
  console.log('  ✓ Partial overlapping slot booking strictly prevented');
}
