// utils/s3.js
const AWS = require('aws-sdk');
const mime = require('mime-types');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Verify required environment variables are set
const requiredEnvVars = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'IMPORTS_S3_BUCKET_NAME',
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}`
  );
  process.exit(1);
}

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// Initialize S3 instance
const s3 = new AWS.S3({
  signatureVersion: 'v4',
});

/**
 * Uploads a file buffer to S3.
 * @param {Buffer} fileBuffer - The file's in-memory buffer.
 * @param {String} originalName - The original filename (e.g. "myfile.xlsx").
 * @param {String} userId - The user's ID or "anonymous".
 * @returns {String} The S3 key (path in the bucket).
 */
const uploadFile = async (fileBuffer, originalName, userId) => {
  // A timestamp-based name helps avoid collisions
  const timestamp = Date.now();

  // If originalName is missing, fallback to "unknown"
  const safeOriginalName = originalName || 'unknownFile';
  const sanitizedFileName = safeOriginalName.replace(/\s+/g, '_');

  const bucketName = process.env.IMPORTS_S3_BUCKET_NAME;
  const s3Key = `imports/${userId}/${timestamp}_${sanitizedFileName}`;

  console.log('Uploading to S3 with params:');
  console.log({
    Bucket: bucketName,
    Key: s3Key,
    ContentType: mime.lookup(safeOriginalName) || 'application/octet-stream',
  });

  const params = {
    Bucket: bucketName,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mime.lookup(safeOriginalName) || 'application/octet-stream',
  };

  try {
    await s3.upload(params).promise();
    console.log(`File uploaded successfully. S3 Key: ${s3Key}`);
    return s3Key; 
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    throw new Error('Failed to upload file to S3.');
  }
};

/**
 * Generates a pre-signed URL for downloading a file from S3.
 * @param {String} s3Key - The S3 file key.
 * @returns {String} - A pre-signed URL valid for 5 minutes.
 */
const generatePreSignedUrl = (s3Key) => {
  const params = {
    Bucket: process.env.IMPORTS_S3_BUCKET_NAME,
    Key: s3Key,
    Expires: 300,
  };

  try {
    const url = s3.getSignedUrl('getObject', params);
    console.log(`Generated pre-signed URL for S3 Key ${s3Key}: ${url}`);
    return url;
  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    throw new Error('Failed to generate pre-signed URL.');
  }
};

module.exports = {
  uploadFile,
  generatePreSignedUrl,
};
