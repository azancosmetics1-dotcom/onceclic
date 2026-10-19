-- =========================================================
-- ONCEClic Database Schema Migration 018
-- Telnyx Order ID / Phone-Number Resource ID Separation
-- =========================================================
--
-- BACKGROUND:
--   The Telnyx POST /v2/number_orders response contains two distinct identifiers:
--     - data.id                       → The number ORDER ID (e.g. "12ade33a-...")
--     - data.phone_numbers[0].id      → A number_order_phone_number tracking ID
--     - data.phone_numbers[0].phone_number → The confirmed E.164 phone number string
--
--   The resource ID required for PATCH /v2/phone_numbers/{id} (SIP routing) is a
--   DIFFERENT, permanent identifier that only becomes available after the number is
--   fully provisioned and appears in the account's inventory.
--
--   Previously, telnyx_phone_number_id incorrectly stored the order ID (data.id),
--   which caused the PATCH /v2/phone_numbers/{id} call to return HTTP 404 in live
--   Telnyx because order IDs are not phone-number resource IDs.
--
-- THIS MIGRATION:
--   1. Adds telnyx_order_id  → stores the Telnyx number_order ID (data.id)
--   2. telnyx_phone_number_id is now used for the phone number resource ID only
--      (populated after a GET /v2/phone_numbers lookup resolves the resource ID,
--       or NULL if the resource ID has not yet been confirmed)
--
-- BACKWARD COMPATIBILITY:
--   Existing telnyx_phone_number_id values (which were erroneously the order ID)
--   are migrated to telnyx_order_id so the order reference is not lost. The
--   telnyx_phone_number_id column is cleared for those rows to prevent the wrong
--   ID from being used in PATCH calls — it will be backfilled on next retry.

ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS telnyx_order_id VARCHAR(255);

-- Migrate existing order IDs stored in telnyx_phone_number_id to telnyx_order_id.
-- Only migrate rows that look like UUIDs (order IDs) rather than real phone number
-- resource IDs, which are typically long numeric strings in Telnyx's system.
UPDATE voice_phone_numbers
SET
  telnyx_order_id       = telnyx_phone_number_id,
  telnyx_phone_number_id = NULL
WHERE telnyx_phone_number_id IS NOT NULL
  AND telnyx_phone_number_id LIKE '%-%-%-%-%';

CREATE INDEX IF NOT EXISTS idx_voice_phone_telnyx_order ON voice_phone_numbers(telnyx_order_id);
