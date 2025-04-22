// utils/encryption.js
const crypto = require('crypto');

// Your secret key for encryption/decryption
// For production, store this in an .env variable like process.env.ENCRYPTION_KEY
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32 bytes for AES-256

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns an object { encryptedData, iv, authTag } or 
 * you can combine authTag & iv in a single string.
 */
function encryptString(plaintext) {
  // 1) generate a random 16-byte IV
  const iv = crypto.randomBytes(16);

  // 2) create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);

  // 3) encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // 4) get the auth tag
  const authTag = cipher.getAuthTag();

  // Return all the pieces we need to decrypt
  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts data using AES-256-GCM
 */
function decryptString(ciphertext, ivBase64, authTagBase64) {
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encryptString,
  decryptString,
};
