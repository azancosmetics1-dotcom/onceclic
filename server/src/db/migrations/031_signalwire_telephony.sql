-- =========================================================
-- ONCEClic Database Schema Migration 031
-- SignalWire Telephony Provider & Carrier Interconnection
-- =========================================================

-- 1. Add SignalWire columns to voice_phone_numbers
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS signalwire_number_sid VARCHAR(255);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS signalwire_order_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_voice_phone_sw_sid ON voice_phone_numbers(signalwire_number_sid);
CREATE INDEX IF NOT EXISTS idx_voice_phone_sw_order ON voice_phone_numbers(signalwire_order_id);
