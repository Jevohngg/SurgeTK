// utils/pdf/packetBuilder.js
const puppeteer               = require('puppeteer');
const { PDFDocument }         = require('pdf-lib');
const AWS                     = require('aws-sdk');
const path                    = require('path');
const os                      = require('os');
const fs                      = require('fs');
const ValueAdd                = require('../../models/ValueAdd');
const Surge                   = require('../../models/Surge');
const { generateHouseholdWarnings } = require('./warningHelper');
const { buildSurgePacketKey } = require('../s3');
const { getDisplayName }      = require('../household/nameHelper');
const { buildFilename }       = require('../filenameHelper');
const { seedValueAdds }       = require('../valueAdd/seedHelper');   // ← already imported

// Use a single bucket for all Surge objects.
// Falls back to IMPORTS_S3_BUCKET_NAME if a dedicated one isn’t set.
const s3     = new AWS.S3({ signatureVersion: 'v4' });
const BUCKET = process.env.SURGE_S3_BUCKET_NAME ||
               process.env.IMPORTS_S3_BUCKET_NAME;

const DEBUG_SURGE = process.env.DEBUG_SURGE === '1';
console.log(`⚡️ [SurgePDF] packetBuilder loaded — BUCKET=${BUCKET}`);


/**
 * Render one Value‑Add to PDF and gather diagnostics when DEBUG_SURGE=1.
 */
async function renderValueAddPdf(valueAddId, host, cookieHeader = '') {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  /* 1️⃣  pass the existing session cookie so Puppeteer is authenticated */
  if (cookieHeader) {
    const domain = new URL(host).hostname;
    await page.setCookie(...cookieHeader.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return { name, value: rest.join('='), domain, path: '/' };
    }));
  }

  /* 2️⃣  surface console output & network failures while debugging */
  if (DEBUG_SURGE) {
    page.on('console', msg =>
      console.log(`[VA ${valueAddId}] browser ${msg.type()}: ${msg.text()}`));
    page.on('requestfailed', req =>
      console.warn(`[VA ${valueAddId}] request‑fail ${req.url()} → ${req.failure().errorText}`));
  }

  /* 3️⃣  navigate to the rendered HTML view of the Value‑Add */
  const url  = `${host}/api/value-add/${valueAddId}/view`;
  const resp = await page.goto(url, { waitUntil: 'networkidle2' });

  if (DEBUG_SURGE) {
    console.log(`[VA ${valueAddId}] HTTP ${resp?.status()} ${url}`);
  }

  /* 4️⃣  wait for either of the known root selectors to appear (10 s max) */
  try {
    await page.waitForSelector('.value-add-page, .report-wrapper', { timeout: 10000 });
  } catch {
    if (DEBUG_SURGE) console.warn(`[VA ${valueAddId}] selector timeout (continuing anyway)`);
  }

  /* 5️⃣  dump screenshot + html snapshot if debugging */
  if (DEBUG_SURGE) {
    const tmpBase = path.join(os.tmpdir(), `va_${valueAddId}_${Date.now()}`);
    await page.screenshot({ path: `${tmpBase}.png`, fullPage: true });
    fs.writeFileSync(`${tmpBase}.html`, await page.content());
    console.log(`[VA ${valueAddId}] diagnostics → ${tmpBase}.{png,html}`);
  }

  /* 6️⃣  print to PDF */
  const buf = await page.pdf({ format: 'Letter', printBackground: true });
  if (DEBUG_SURGE) console.log(`[VA ${valueAddId}] PDF bytes: ${buf.length}`);

  await browser.close();
  return buf;
}


/* ──────────────────────────────────────────────────────────────────────────
 * Concatenate an array of PDF buffers, preserving page order.
 * ────────────────────────────────────────────────────────────────────────── */
async function concatPdfBuffers(buffers) {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src   = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  return await merged.save();
}


/* ──────────────────────────────────────────────────────────────────────────
 * Build, upload, and persist ONE household’s packet.
 *
 * Emits granular progress via the optional `progressCb` (preferred)
 * and retains the legacy `emitFn` “done” ping for backward compatibility.
 *
 * @param {Object}   surge        Surge Mongoose doc (populated)
 * @param {String}   householdId  Household ObjectId string
 * @param {String}   host         e.g. "https://app.surgetk.com"
 * @param {Function} progressCb   (inc:number=1) => void  ← NEW (optional)
 * @param {Function} emitFn       Legacy socket emit callback (“done” only)
 * @param {String}   cookieHeader Raw Cookie header for auth in headless‑chrome
 * @returns {Boolean}             true = success (for queue accounting)
 * ------------------------------------------------------------------------ */
async function buildPacketJob({
  surge,
  householdId,
  host,
  progressCb = () => {},
  emitFn     = () => {},
  cookieHeader
}) {
  console.log(`⚡️ [SurgePDF] buildPacketJob() start for household ${householdId}`);

  /* ------------------------------------------------------------------ *
   * −1.  **Auto‑seed missing Value‑Add docs**  
   *      Ensures every household has all the Value‑Adds requested by
   *      this Surge before we try to render anything.
   * ------------------------------------------------------------------ */
  try {
    await seedValueAdds({
      householdId,
      types: surge.valueAdds.map(v => v.type)
    });
  } catch (seedErr) {
    console.error(`[SurgePDF] seedValueAdds error for household ${householdId}:`, seedErr);
  }

  /* ------------------------------------------------------------------ *
   * 0.  Determine the definitive order array
   *     • If surge.order exists and is non‑empty → use it (mixed tokens)
   *     • Otherwise fall back to legacy logic: all VAs then uploads
   * ------------------------------------------------------------------ */
  const orderArr =
    Array.isArray(surge.order) && surge.order.length
      ? surge.order
      : [
          ...surge.valueAdds.map(v => v.type),
          ...surge.uploads.map(u => u._id.toString())
        ];

  /* Quick lookup maps */
  const vaByType = new Map(surge.valueAdds.map(v => [v.type, v]));
  const upById   = new Map(surge.uploads.map(u => [u._id.toString(), u]));

  const buffers        = [];
  const vaSnapshotData = [];

  /* ------------------------------------------------------------------ *
   * 1.  Iterate over orderArr, rendering VAs or fetching uploads
   * ------------------------------------------------------------------ */
  for (const token of orderArr) {
    /* ===== Value‑Add token (not a 24‑char ObjectId) =================== */
    if (!/^[0-9a-fA-F]{24}$/.test(token)) {
      const vaCard = vaByType.get(token);
      if (vaCard) {
        try {
          // DEBUG: list VA docs for the household
          const allForHouse = await ValueAdd.find({ household: householdId }).lean();
          console.log(
            `[SurgePDF] HOUSEHOLD ${householdId} has ${allForHouse.length} VA docs: [${allForHouse
              .map(v => v.type)
              .join(', ')}]`
          );

          const va = await ValueAdd.findOne({ household: householdId, type: token });
          console.log(`⚡️ [SurgePDF]   found VA doc for type=${token}?`, !!va);
          if (va) {
            const pdfBuf = await renderValueAddPdf(va._id, host, cookieHeader);
            buffers.push(pdfBuf);

            console.log(
              `⚡️ [SurgePDF]   PDF buffer length for ${token}: ${pdfBuf.length}`
            );
            if (DEBUG_SURGE && pdfBuf.length < 2000) {
              const warnPath = path.join(os.tmpdir(), `EMPTY_${va._id}.pdf`);
              fs.writeFileSync(warnPath, pdfBuf);
              console.warn(
                `[Surge] ⚠️  VERY small PDF (${pdfBuf.length} bytes) saved to ${warnPath}`
              );
            }

            vaSnapshotData.push({
              type:     va.type,
              data:     va.currentData,
              warnings: va.warnings || []
            });
          }
        } catch (err) {
          console.error(`[Surge] Failed VA ${token} for household ${householdId}:`, err);
        }
      }
      progressCb(1);            // tick after each VA attempt (success or fail)
      continue;
    }

    /* ===== Upload token (24‑char ObjectId) ============================ */
    const up = upById.get(token);
    if (up) {
      try {
        const s3Obj = await s3
          .getObject({ Bucket: BUCKET, Key: up.s3Key })
          .promise();
        buffers.push(s3Obj.Body);
      } catch (err) {
        console.error(`[Surge] Missing upload ${up.s3Key}:`, err);
      }
    }
    progressCb(1);              // tick after each upload attempt
  }

  /* ------------------------------------------------------------------ *
   * 2.  Merge Value‑Adds + uploads in the gathered order
   * ------------------------------------------------------------------ */
  const mergedBuffer = await concatPdfBuffers(buffers);

  /* ------------------------------------------------------------------ *
   * 3.  Friendly filename & S3 upload
   * ------------------------------------------------------------------ */
  const prettyName = buildFilename({
    householdName: await getDisplayName(householdId),
    surgeName:     surge.name,
    ext:           'pdf'
  });

  const packetKey = buildSurgePacketKey(surge._id, householdId);
  await s3.putObject({
    Bucket:             BUCKET,
    Key:                packetKey,
    Body:               mergedBuffer,
    ContentType:        'application/pdf',
    ContentDisposition: `attachment; filename="${prettyName}"`
  }).promise();

  /* ------------------------------------------------------------------ *
   * 4.  Persist SurgeSnapshot
   * ------------------------------------------------------------------ */
  const SurgeSnapshot = require('../../models/SurgeSnapshot');
  await SurgeSnapshot.create({
    surgeId:           surge._id,
    household:         householdId,
    packetKey,
    packetSize:        mergedBuffer.length,
    preparedAt:        new Date(),
    valueAddSnapshots: vaSnapshotData,
    warnings:          await generateHouseholdWarnings({ householdId, surge })
  });

  /* ------------------------------------------------------------------ *
   * 5.  Legacy “done” emit for compatibility
   * ------------------------------------------------------------------ */
  emitFn({
    surgeId:     surge._id.toString(),
    householdId: householdId.toString(),
    status:      'done'
  });

  console.log(`⚡️ [SurgePDF] finished packet for household ${householdId}`);
  return true;                                   // queue bookkeeping
}

module.exports = { buildPacketJob };
