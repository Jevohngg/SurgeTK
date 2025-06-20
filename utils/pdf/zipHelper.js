// utils/pdf/zipHelper.js

const AWS                     = require('aws-sdk');
const archiver                = require('archiver');
const { PassThrough }         = require('stream');
const pLimit                  = require('p-limit');
const Surge                   = require('../../models/Surge');
const { buildSurgePacketKey,
        generatePreSignedUrl,
        getBucketForKey }      = require('../s3');
const { buildFilename,
        slugify }              = require('../filenameHelper');
const { getDisplayName }      = require('../household/nameHelper');

const s3 = new AWS.S3({ signatureVersion: 'v4' });

/**
 * Wrap S3.getObject in a simple retry/backoff.
 */
async function getObjectWithRetry(params, maxAttempts = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await s3.getObject(params).promise();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) {
        console.error(`[Surge ZIP] giving up on ${params.Key}:`, err);
        throw err;
      }
      const backoff = 200 * attempt; // 200ms, 400ms, 600ms...
      console.warn(
        `[Surge ZIP] retry #${attempt} for ${params.Key} after ${backoff}ms:`,
        err.code || err.message
      );
      await new Promise(res => setTimeout(res, backoff));
    }
  }
}

/**
 * Build a ZIP of packet PDFs & upload to S3.
 * Returns a presigned URL.
 */
async function buildZipAndUpload({ surgeId, householdIds }) {
  // 1) Compute ZIP filename & key in S3
  const surgeDoc   = await Surge.findById(surgeId).select('name').lean();
  const surgeSlug  = slugify(surgeDoc?.name || `surge-${surgeId}`);
  const zipFilename = `${surgeSlug}.zip`;
  const zipKey      = `surges/${surgeId}/zips/${Date.now()}_${zipFilename}`;

  // 2) Prepare a PassThrough for streaming upload while we build
  const zipStream = new PassThrough();
  const uploadPromise = s3.upload({
    Bucket:             getBucketForKey(zipKey),
    Key:                zipKey,
    Body:               zipStream,
    ContentDisposition: `attachment; filename="${zipFilename}"`
  }).promise();

  // 3) Initialize the archiver
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { throw err; });
  archive.pipe(zipStream);

  // 4) Precompute household display names in bulk
  const nameMap = {};
  await Promise.all(
    householdIds.map(async id => {
      nameMap[id] = await getDisplayName(id);
    })
  );

  // 5) Append each PDF into the ZIP, but throttle to 5 concurrent fetches
  const limit = pLimit(5);
  await Promise.all(householdIds.map(hhId => limit(async () => {
    const pdfKey = buildSurgePacketKey(surgeId, hhId);
    const bucket = getBucketForKey(pdfKey);

    let obj;
    try {
      obj = await getObjectWithRetry({ Bucket: bucket, Key: pdfKey });
    } catch (err) {
      console.warn(`[Surge ZIP] skipping missing PDF ${pdfKey}:`, err.code || err.message);
      return;
    }

    const entryName = buildFilename({
      householdName: nameMap[hhId] || hhId,
      surgeName: '',
      ext: 'pdf'
    });

    archive.append(obj.Body, { name: entryName });
  })));

  // 6) Finalize the archive and wait for upload to complete
  await archive.finalize();
  await uploadPromise;

  // 7) Return a short-lived presigned URL for download
  return generatePreSignedUrl(zipKey);
}

module.exports = { buildZipAndUpload };
