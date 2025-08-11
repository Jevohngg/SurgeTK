// utils/s3.js
/* ────────────────────────────────────────────────────────────────────────────
 *  One helper file for both “imports” and “surge” objects.
 *  ‑ IMPORTS_S3_BUCKET_NAME  →  legacy CSV / XLSX uploads
 *  ‑ SURGE_S3_BUCKET_NAME    →  Surge PDFs (uploads + packets + zips)
 * -------------------------------------------------------------------------- */

const AWS    = require('aws-sdk');
const mime   = require('mime-types');
const dotenv = require('dotenv');

dotenv.config();

/* ── Required env vars ───────────────────────────────────────────────────── */
const requiredEnvVars = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'IMPORTS_S3_BUCKET_NAME',
  'SURGE_S3_BUCKET_NAME'           // ← NEW – make sure it is set in .env
];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

/* ── AWS init ────────────────────────────────────────────────────────────── */
AWS.config.update({
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:          process.env.AWS_REGION
});
const s3 = new AWS.S3({ signatureVersion: 'v4' });

/* ── Small helper – decide bucket by key prefix ──────────────────────────── */
const getBucketForKey = (key) =>
  key.startsWith('surges/')
    ? process.env.SURGE_S3_BUCKET_NAME
    : process.env.IMPORTS_S3_BUCKET_NAME;

/* ───────────────────────────────────────────────────────────────────────────
 * uploadFile()
 *  • Behaviour unchanged for legacy imports (userId → imports/{userId}/…)
 *  • **NEW**: if the 3rd arg *looks like a full S3 path* (contains “/”),
 *    we treat it as an absolute key and upload to the correct bucket.
 * ------------------------------------------------------------------------ */
const uploadFile = async (fileBuffer, originalName, userIdOrAbsKey) => {
  const timestamp         = Date.now();
  const safeName          = (originalName || 'unknownFile').replace(/\s+/g, '_');
  const isAbsoluteKey     = userIdOrAbsKey.includes('/');
  const bucketName        = isAbsoluteKey
    ? getBucketForKey(userIdOrAbsKey)
    : process.env.IMPORTS_S3_BUCKET_NAME;
  const s3Key             = isAbsoluteKey
    ? userIdOrAbsKey                              // Surge path already built
    : `imports/${userIdOrAbsKey}/${timestamp}_${safeName}`;

  const params = {
    Bucket: bucketName,
    Key:    s3Key,
    Body:   fileBuffer,
    ContentType: mime.lookup(safeName) || 'application/octet-stream'
  };

  console.log('[S3] upload →', params);
  await s3.upload(params).promise();
  return s3Key;                                   // caller stores the key
};

/* ── Pre‑signed URL helper (works for both buckets) ─────────────────────── */
 const defaultOverridesForKey = (key) => {
    const isPacketPdf =
      key.startsWith('surges/') &&
      key.includes('/packets/') &&
      key.endsWith('.pdf');
    if (isPacketPdf) {
      return {
        ResponseContentType: 'application/pdf',
        ResponseContentDisposition: 'inline'
      };
    }
    return {};
  };

  const generatePreSignedUrl = (s3Key, expires = 300, overrides = {}) =>
    s3.getSignedUrl('getObject', {
      Bucket:  getBucketForKey(s3Key),
      Key:     s3Key,
      Expires: expires,
      ...defaultOverridesForKey(s3Key),
      ...overrides
    });

/* ── Delete object helper (bucket‑aware) ─────────────────────────────────── */
const deleteFile = async (s3Key) => {
  await s3.deleteObject({
    Bucket: getBucketForKey(s3Key),
    Key:    s3Key
  }).promise();
  console.log(`[S3] deleted → ${s3Key}`);
};

/* ── Surge‑specific key builders (paths only) ───────────────────────────── */
const buildSurgeUploadKey  = (surgeId, uploadId)   =>
  `surges/${surgeId}/uploads/${uploadId}.pdf`;
const buildSurgePacketKey  = (surgeId, householdId)=>
  `surges/${surgeId}/packets/${householdId}.pdf`;

/* ── Exports ─────────────────────────────────────────────────────────────── */
module.exports = {
  uploadFile,
  generatePreSignedUrl,
  deleteFile,
  buildSurgeUploadKey,
  buildSurgePacketKey,
  getBucketForKey

};
