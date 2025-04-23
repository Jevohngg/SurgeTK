// utils/s3Upload.js
const AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

/**
 * Upload a buffer to S3
 * @param {Buffer} buffer - The binary data to upload
 * @param {String} contentType - e.g. 'image/jpeg' or 'image/png'
 * @param {String} [folder='clientPhotos'] - folder name in your S3 bucket
 * @returns {Promise<String>} - The final public S3 URL
 */
async function uploadBufferToS3(buffer, contentType, folder = 'clientPhotos') {
  // You might generate a more descriptive filename here if you prefer
  const fileExtension = contentType.split('/')[1] || 'jpg';
  const fileName = `${folder}/${Date.now()}.${fileExtension}`;

  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  };

  const data = await s3.upload(params).promise();
  return data.Location; // The uploaded file's URL
}

module.exports = { uploadBufferToS3 };
