-- =========================================================================
-- Migration: 023_salon_and_voice_completion.sql
-- Description:
--   1. Creates salon_services table for salon service catalogue management.
--   2. Creates salon_staff table for stylist / staff scheduling.
--   3. Creates salon_staff_services join table for staff-service qualifications.
--   4. Extends appointments with staff_id, party_size, seating_preference.
--   5. Extends business_settings with industry_type, transfer_phone_number, salon_settings.
--   6. Extends voice_call_records with recording_storage_path.
--   7. Adds performance and tenant-isolation indexes.
-- =========================================================================

-- 1. Salon Services Table
CREATE TABLE IF NOT EXISTS salon_services (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    category VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    instructions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salon_services_org ON salon_services(organization_id);
CREATE INDEX IF NOT EXISTS idx_salon_services_active ON salon_services(organization_id, is_active);

-- 2. Salon Staff Table
CREATE TABLE IF NOT EXISTS salon_staff (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    working_days JSONB NOT NULL DEFAULT '[1,2,3,4,5,6]'::jsonb, -- 0=Sun, 1=Mon...
    working_hours_start VARCHAR(10) NOT NULL DEFAULT '09:00',
    working_hours_end VARCHAR(10) NOT NULL DEFAULT '18:00',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salon_staff_org ON salon_staff(organization_id);
CREATE INDEX IF NOT EXISTS idx_salon_staff_active ON salon_staff(organization_id, is_active);

-- 3. Staff-to-Service Qualifications Join Table
CREATE TABLE IF NOT EXISTS salon_staff_services (
    staff_id VARCHAR(64) NOT NULL REFERENCES salon_staff(id) ON DELETE CASCADE,
    service_id VARCHAR(64) NOT NULL REFERENCES salon_services(id) ON DELETE CASCADE,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (staff_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_salon_staff_services_org ON salon_staff_services(organization_id);
CREATE INDEX IF NOT EXISTS idx_salon_staff_services_service ON salon_staff_services(service_id);

-- 4. Extend Appointments Table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS staff_id VARCHAR(64) REFERENCES salon_staff(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS party_size INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS seating_preference VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_appointments_staff ON appointments(staff_id);
CREATE INDEX IF NOT EXISTS idx_appointments_org_staff_times ON appointments(organization_id, staff_id, start_time, end_time);

-- 5. Extend Business Settings Table
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS industry_type VARCHAR(50) DEFAULT 'clinic';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS transfer_phone_number VARCHAR(50);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS salon_settings JSONB;

CREATE INDEX IF NOT EXISTS idx_business_settings_industry ON business_settings(industry_type);

-- 6. Extend Voice Call Records with Private Storage Path
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS recording_storage_path TEXT;

