import crypto from 'crypto';
import { logger } from './logger';

// Encryption algorithm: AES-256-GCM (authenticated encryption)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Get encryption key from environment variable
 * The key should be a 32-byte hex string (64 characters)
 * Generate one with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. ' +
      'Generate one with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (keyHex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      `Current length: ${keyHex.length}`
    );
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns: iv:authTag:encryptedData (all base64 encoded, colon-separated)
 */
export function encrypt(plaintext: string): string {
  try {
    const key = getEncryptionKey();

    // Generate random initialization vector
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt the data
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Get authentication tag (GCM mode provides authenticated encryption)
    const authTag = cipher.getAuthTag();

    // Return format: iv:authTag:encrypted (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  } catch (error) {
    logger.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt a string encrypted with encrypt()
 * Input format: iv:authTag:encryptedData (all base64 encoded, colon-separated)
 */
export function decrypt(ciphertext: string): string {
  try {
    const key = getEncryptionKey();

    // Split the ciphertext into components
    const parts = ciphertext.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format. Expected format: iv:authTag:encrypted');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    // Validate lengths
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: ${iv.length}, expected ${IV_LENGTH}`);
    }

    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length: ${authTag.length}, expected ${AUTH_TAG_LENGTH}`);
    }

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt the data
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Check if a string appears to be encrypted (has our format)
 */
export function isEncrypted(value: string): boolean {
  // Check if it has the format: base64:base64:base64
  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }

  // Validate that each part is valid base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return parts.every(part => base64Regex.test(part));
}

/**
 * Encrypt access token for storage
 */
export function encryptAccessToken(token: string): string {
  if (!token) {
    throw new Error('Cannot encrypt empty token');
  }

  return encrypt(token);
}

/**
 * Decrypt access token from storage
 */
export function decryptAccessToken(encryptedToken: string): string {
  if (!encryptedToken) {
    throw new Error('Cannot decrypt empty token');
  }

  // Handle migration: if token is not encrypted, return as-is (for backward compatibility)
  // This allows gradual migration of existing tokens
  if (!isEncrypted(encryptedToken)) {
    logger.warn('Unencrypted access token detected - migration needed');
    return encryptedToken;
  }

  return decrypt(encryptedToken);
}

/**
 * Hash a value for comparison purposes (one-way)
 * Useful for logging/debugging without exposing sensitive data
 */
export function hashForLogging(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16);
}
