// utils/s3.js

const AWS = require('aws-sdk');
const mime = require('mime-types'); // Ensure mime-types is installed: npm install mime-types
const dotenv = require('dotenv');

// Load environment variables from .env file
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
  process.exit(1); // Exit the process if env variables are missing
}

// Configure AWS SDK with credentials and region
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Ensure this is set in your environment variables
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // Ensure this is set in your environment variables
  region: process.env.AWS_REGION, // Ensure this is set in your environment variables
});

// Initialize S3 instance with explicit SigV4
const s3 = new AWS.S3({
  signatureVersion: 'v4', // Explicitly set the signature version to SigV4
});

/**
 * Uploads a file to S3.
 * @param {Buffer} fileBuffer - The file buffer.
 * @param {String} originalName - The original file name.
 * @param {String} userId - The ID of the user uploading the file.
 * @returns {String} - The S3 file key.
 */
const uploadFile = async (fileBuffer, originalName, userId) => {
  const timestamp = Date.now();
  const sanitizedFileName = originalName.replace(/\s+/g, '_'); // Replace spaces with underscores
  const s3Key = `imports/${userId}/${timestamp}_${sanitizedFileName}`;

  const bucketName = process.env.IMPORTS_S3_BUCKET_NAME;

  console.log('Uploading to S3:', {
    Bucket: bucketName,
    Key: s3Key,
    ContentType: mime.lookup(originalName) || 'application/octet-stream',
  });

  const params = {
    Bucket: bucketName, // Ensure this is correctly set
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mime.lookup(originalName) || 'application/octet-stream',
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
 * @returns {String} - The pre-signed URL.
 */
const generatePreSignedUrl = (s3Key) => {
  const params = {
    Bucket: process.env.IMPORTS_S3_BUCKET_NAME,
    Key: s3Key,
    Expires: 300, // URL expires in 5 minutes
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
