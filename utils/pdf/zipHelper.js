// utils/pdf/zipHelper.js
const AWS         = require('aws-sdk');
const archiver    = require('archiver');
const { PassThrough } = require('stream');
const {
  buildSurgePacketKey,
  generatePreSignedUrl,
  getBucketForKey                // ← NEW import
} = require('../s3');

const s3 = new AWS.S3({ signatureVersion: 'v4' });

/**
 * Build a ZIP of packet PDFs & upload to S3.
 * Returns a presigned URL.
 */
async function buildZipAndUpload({ surgeId, householdIds }) {
const Surge = require('../../models/Surge');
const { buildFilename, slugify } = require('../filenameHelper');

const surgeDoc   = await Surge.findById(surgeId).select('name').lean();
const surgeSlug  = slugify(surgeDoc?.name || `surge-${surgeId}`);
const zipFilename = `${surgeSlug}.zip`;
const zipKey      = `surges/${surgeId}/zips/${Date.now()}_${zipFilename}`;
  const zipStream = new PassThrough();
  const uploader  = s3.upload({
    Bucket: getBucketForKey(zipKey),   // ← surge bucket
    Key:    zipKey,
    Body:   zipStream,
    ContentDisposition: `attachment; filename="${zipFilename}"`
  });

  const archive  = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { throw err; });
  archive.pipe(zipStream);

  // Stream each PDF from S3 directly into the archive
    // Build a map of householdId → friendly name in one DB query
      const { getDisplayName } = require('../household/nameHelper');
      const nameMap = {};
      await Promise.all(
        householdIds.map(async id => {
          nameMap[id] = await getDisplayName(id);
        })
      );
  
    for (const hhId of householdIds) {
      const pdfKey = buildSurgePacketKey(surgeId, hhId);
      const bucket = getBucketForKey(pdfKey);
  
      try {
        const pdfStream = s3.getObject({ Bucket: bucket, Key: pdfKey })
                            .createReadStream()
                            .on('error', err => console.warn(`[Surge ZIP] Missing ${pdfKey}:`, err.code));
  
        const { buildFilename } = require('../filenameHelper');
        const entryName = buildFilename({
          householdName: nameMap[hhId] || hhId,
          surgeName:     '',           // omit surge for inner files
          ext:           'pdf'
        });
  
        archive.append(pdfStream, { name: entryName });
      } catch (err) {
        console.warn(`[Surge ZIP] Failed to append ${pdfKey}:`, err);
      }
    }


  await archive.finalize();        // signals end of zip
  await uploader.promise();        // wait till uploaded

  return generatePreSignedUrl(zipKey);    // 5‑min URL
}

module.exports = { buildZipAndUpload };
