-- =========================================================================
-- Migration: 024_appointments_exclusion_constraint.sql
-- Description:
--   Add PostgreSQL-level exclusion constraints to prevent double-booking
--   race conditions in the appointments table.
--
--   BOOKING MODEL:
--   ─────────────
--   ONCEClic serves three industry types with different resource models:
--
--   CLINIC (AppointmentService):
--     The clinic itself is the shared resource. Only one appointment can
--     occupy any time slot org-wide. Org-level constraint is correct.
--
--   SALON (SalonService with staff_id):
--     Each STAFF MEMBER is an independent resource. Different stylists can
--     serve different customers simultaneously. The same stylist cannot
--     be double-booked. Staff-level constraint only.
--
--   RESTAURANT (SalonService without staff_id, uses party_size):
--     Tables are fungible up to capacity (enforced by maxPartySize in
--     business_settings at application level). No time-overlap constraint
--     is added for unassigned reservations — the application enforces
--     total capacity.
--
--   CONSTRAINT DESIGN:
--   ──────────────────
--   1. STAFF constraint (exclusion): same staff_id cannot have overlapping
--      CONFIRMED or REQUESTED appointments within the same organisation.
--      → Covers salons. Prevents the same stylist being double-booked.
--      → Does NOT prevent different stylists serving clients simultaneously.
--
--   2. ORG-NO-STAFF constraint (exclusion): when staff_id IS NULL,
--      only one CONFIRMED or REQUESTED appointment per org at a time.
--      → Covers clinics booked without explicit staff assignment.
--      → Restaurant reservations (NULL staff_id) are exempt — capacity is
--        managed at the application layer, not here.
--      → Apply only when industry_type = 'clinic' OR when no industry tag
--        is available (conservative default).
--
--   Because pg exclusion constraints cannot reference a column in another
--   table (business_settings.industry_type), the application code is the
--   authoritative gatekeeper for restaurant multi-reservation capacity.
--   The DB constraint only covers the staff dimension.
--
--   SAFE ROLLBACK:
--     ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_staff_no_overlap_excl;
--     DROP INDEX IF EXISTS idx_appts_staff_no_overlap;
--     -- (org-level constraint removed — see note in Step 3)
--
--   SAFE RE-RUN: All steps are idempotent via IF NOT EXISTS guards.
-- =========================================================================

-- Step 1: Enable btree_gist (idempotent)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Step 2: DROP the incorrectly-designed org-level constraint if it was
--   previously applied (migration 024 first version used this wrong constraint
--   that prevented different staff from having simultaneous appointments).
--   This is safe to run even if the constraint does not exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_overlap'
  ) THEN
    ALTER TABLE appointments DROP CONSTRAINT appointments_no_overlap;
    RAISE NOTICE 'Dropped incorrect org-level exclusion constraint appointments_no_overlap';
  END IF;
END $$;

-- Step 3: STAFF-LEVEL exclusion constraint.
--   Prevents the same staff member from being double-booked in the same
--   organisation. Half-open range [start_time, end_time) allows back-to-back
--   bookings (end of one == start of next).
--   Applies ONLY when staff_id IS NOT NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_staff_no_overlap_excl'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_staff_no_overlap_excl
      EXCLUDE USING GIST (
        organization_id WITH =,
        staff_id        WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
      )
      WHERE (staff_id IS NOT NULL AND status IN ('CONFIRMED', 'REQUESTED'));
    RAISE NOTICE 'Created staff-level exclusion constraint appointments_staff_no_overlap_excl';
  END IF;
END $$;

-- Step 4: Legacy index cleanup — drop old plain index if it exists
--   (previous version created a non-unique GiST index named appointments_staff_no_overlap)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'appointments_staff_no_overlap'
  ) THEN
    DROP INDEX appointments_staff_no_overlap;
    RAISE NOTICE 'Dropped old non-exclusive staff overlap index appointments_staff_no_overlap';
  END IF;
END $$;

-- Step 5: Covering B-tree index for fast staff schedule lookups (non-unique, for queries)
CREATE INDEX IF NOT EXISTS idx_appts_staff_schedule
  ON appointments (organization_id, staff_id, start_time, end_time)
  WHERE (staff_id IS NOT NULL AND status IN ('CONFIRMED', 'REQUESTED'));

-- Step 6: Advisory verification queries (comment out for silent runs)
-- SELECT conname, contype, pg_get_constraintdef(oid) AS def
--   FROM pg_constraint WHERE conname = 'appointments_staff_no_overlap_excl';
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_appts_staff_schedule';
-- SELECT conname FROM pg_constraint WHERE conname = 'appointments_no_overlap'; -- should be 0 rows

