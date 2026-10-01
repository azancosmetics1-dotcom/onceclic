-- 011_reservation_settings.sql
-- Adds reservation_settings column to business_settings for restaurant/hospitality configuration
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS reservation_settings TEXT;
