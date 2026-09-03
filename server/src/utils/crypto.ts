import crypto from 'crypto';
import { config } from '../config';

/**
 * AES-256-GCM Authenticated Encryption Utility
 * Ensures encrypted-at-rest token security with tamper-proofing.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Retrieves and validates the 32-byte master encryption key.
 */
export function getEncryptionKey(): Buffer {
  const rawKey = process.env.EMAIL_ENCRYPTION_KEY || config.encryption?.emailKey;

  if (rawKey && !rawKey.includes('placeholder')) {
    // Support 32-byte raw string, 64-char hex, or 44-char base64
    if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }
    const base64Buf = Buffer.from(rawKey, 'base64');
    if (base64Buf.length === 32) {
      return base64Buf;
    }
    const utf8Buf = Buffer.from(rawKey, 'utf8');
    if (utf8Buf.length === 32) {
      return utf8Buf;
    }
    // Deterministically hash longer/shorter keys to 32 bytes using SHA-256
    return crypto.createHash('sha256').update(rawKey).digest();
  }

  // In production, strictly fail if EMAIL_ENCRYPTION_KEY is missing
  if (config.nodeEnv === 'production') {
    throw new Error(
      '[Crypto] FATAL: EMAIL_ENCRYPTION_KEY is required in production. Must be a secure 32-byte secret.'
    );
  }

  // Fallback dev/test key (derived from jwtSecret or static dev string)
  const devSeed = config.jwtSecret || 'onceclic_dev_encryption_secret_key_32b';
  return crypto.createHash('sha256').update(devSeed).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (in hex)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Expects format: iv:authTag:ciphertext (in hex)
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext;

  // Check if string matches our iv:tag:payload format
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    // If not in encrypted format (e.g. legacy plaintext), return as-is or handle safely
    return ciphertext;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  if (ivHex.length !== IV_LENGTH * 2 || authTagHex.length !== AUTH_TAG_LENGTH * 2) {
    return ciphertext;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err: any) {
    throw new Error(`[Crypto Decryption Failed]: Integrity check failed or invalid key (${err.message})`);
  }
}

/**
 * Helper to check if a string is encrypted in the iv:tag:data format
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === AUTH_TAG_LENGTH * 2;
}
