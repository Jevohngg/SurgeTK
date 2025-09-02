// controllers/importUndoController.js
const mongoose = require('mongoose');
const ImportReport = require('../models/ImportReport');

// Domain models (extend as needed)
const Client          = require('../models/Client');
const Account         = require('../models/Account');
const Insurance       = require('../models/Insurance');
const Liability       = require('../models/Liability');
const Asset           = require('../models/Asset');
const Household       = require('../models/Household');
const Beneficiary     = require('../models/Beneficiary');
const ImportedAdvisor = require('../models/ImportedAdvisor');
const path = require('path');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User'); // used to resolve actor + companyId
const CompanyID = require('../models/CompanyID'); // <-- add this



const modelMap = {
  Client,
  Account,
  Insurance,
  Liability,
  Household,
  Beneficiary,
  ImportedAdvisor,
  Asset,
};

function asObjectIdOrNull(val) {
    if (!val) return null;
    // If already a proper ObjectId instance
    if (val instanceof mongoose.Types.ObjectId) return val;
    // If string that looks like a valid ObjectId
    if (typeof val === 'string' && mongoose.Types.ObjectId.isValid(val)) {
      return new mongoose.Types.ObjectId(val);
    }
    return null;
  }
  
  async function resolveCompanyObjectId({ user, report, session }) {
    // 1) Prefer firmId on the user (your app uses this throughout and it’s an ObjectId)
    const firmId = asObjectIdOrNull(user?.firmId);
    if (firmId) return firmId;
  
    // 2) If user.companyId is already an ObjectId, accept it
    const userCompanyOid = asObjectIdOrNull(user?.companyId);
    if (userCompanyOid) return userCompanyOid;
  
    // 3) Fallback: look up CompanyID by the report’s string tenant key (report.companyId)
    //     ImportReport.companyId in your app stores the lowercase string key.
    if (report?.companyId) {
      const company = await CompanyID.findOne({ companyId: String(report.companyId).toLowerCase().trim() })
        .select('_id')
        .session(session);
      if (company?._id) return company._id;
    }
  
    // 4) Last resort: try to treat report.companyId as an ObjectId if somehow valid
    const reportCompanyOid = asObjectIdOrNull(report?.companyId);
    if (reportCompanyOid) return reportCompanyOid;
  
    return null;
  }
  

  async function logUndoActivity({ report, status, session }) {
    try {
      // Who performed undo
      const user = await User.findById(report.undo?.byUser)
        .select('_id email firstName lastName name roles companyId firmId')
        .lean();
      if (!user) return;
  
      const companyObjectId = await resolveCompanyObjectId({ user, report, session });
      if (!companyObjectId) {
        console.warn('[undo] activity log skipped – could not resolve company ObjectId for', {
          userId: user?._id, userCompanyId: user?.companyId, userFirmId: user?.firmId, reportCompanyKey: report?.companyId
        });
        return; // don’t block undo on logging problems
      }
  
      // Human display like "Insurance import • file.xlsx"
      const display =
        `${report.importType || 'Import'}${
          report.originalFileKey ? ` • ${path.basename(report.originalFileKey)}` : ''
        }`;
  
      await ActivityLog.create([{
        companyId: companyObjectId,           // <-- ObjectId, not the short company key
        actor: {
          _id:   user._id,
          email: user.email,
          name:  `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || user.email,
          roles: user.roles || []
        },
        entity: { type: 'ImportReport', id: report._id, display },
  
        // Keep action as "import" so it groups with other import events; mark revert in meta/changes
        action: 'import',
        changes: {
          before: null,
          after:  { undo: { status } },
          diff:   { undo: status }
        },
        meta: {
          notes: 'reverted',
          extra: {
            event: 'undo-done',
            importType: report.importType
          }
        }
      }], { session });
    } catch (e) {
      // non-fatal — do not break undo flow due to logging
      console.error('[undo] activity log failed:', e);
    }
  }
  
    

// firm helpers — mirrors your import code
const firmKey = (req) => {
  const raw = (req.session?.user?.companyId ?? req.session?.user?.firmId ?? '').toString();
  return raw.trim().toLowerCase();
};
const getFirmId = (req) => (req.session?.user?.firmId ? String(req.session.user.firmId) : null);

// --- SSE plumbing (importId -> Set(res)) ---
let sseClients = new Map();
function publishProgress(importId, payload) {
  const key = String(importId);
  const set = sseClients.get(key);
  if (!set) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) res.write(data);
}

function docBelongsToFirm(doc, { companyKey, firmId }) {
  if (!doc) return false;
  if (doc.firmId && firmId) return String(doc.firmId) === String(firmId);
  if (doc.companyId) return String(doc.companyId).toLowerCase() === String(companyKey);
  return false;
}


// Deep guard: if the doc doesn't carry firm/company fields but has a household,
// resolve the Household and verify it belongs to the same firm.
async function docBelongsToFirmDeep(doc, { companyKey, firmId, session }) {
    // Fast path
    if (docBelongsToFirm(doc, { companyKey, firmId })) return true;
  
    // Household-backed guard
    if (doc.household) {
      const hh = await Household.findById(doc.household)
        .select('firmId companyId')
        .session(session);
      if (hh) {
        if (hh.firmId && firmId && String(hh.firmId) === String(firmId)) return true;
        if (hh.companyId && String(hh.companyId).toLowerCase() === String(companyKey)) return true;
      }
    }
  
    // Owner-backed guard (Assets/Liabilities often have owners only)
    if (Array.isArray(doc.owners) && doc.owners.length > 0) {
      const client = await Client.findById(doc.owners[0])
        .select('firmId companyId household')
        .session(session);
      if (client) {
        if (client.firmId && firmId && String(client.firmId) === String(firmId)) return true;
        if (client.companyId && String(client.companyId).toLowerCase() === String(companyKey)) return true;
        if (client.household) {
          const hh = await Household.findById(client.household)
            .select('firmId companyId')
            .session(session);
          if (hh) {
            if (hh.firmId && firmId && String(hh.firmId) === String(firmId)) return true;
            if (hh.companyId && String(hh.companyId).toLowerCase() === String(companyKey)) return true;
          }
        }
      }
    }
  
    return false;
  }
  

// --- leave your imports/modelMap/helpers as-is ---

// SSE stream
exports.streamSSE = async (req, res) => {
    const { importId } = req.params;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();
  
    const key = String(importId);
    if (!sseClients.has(key)) sseClients.set(key, new Set());
    sseClients.get(key).add(res);
  
    // Send the latest known state immediately so the bar isn't stuck at 0.
    try {
      const r = await ImportReport.findById(importId).select('undo').lean();
      const u = r?.undo || {};
      const seed = {
        status: u.status || 'idle',
        progress: typeof u.progress === 'number' ? u.progress : 0,
        error: u.error || null,
      };
      res.write(`data: ${JSON.stringify(seed)}\n\n`);
    } catch (_) {}
  
    req.on('close', () => {
      const set = sseClients.get(key);
      if (set) {
        set.delete(res);
        if (!set.size) sseClients.delete(key);
      }
    });
  };
  
  // POST /api/new-import/:importId/undo
  exports.start = async (req, res, next) => {
    try {
      const { importId } = req.params;
      const companyKey = firmKey(req);
      const firmId     = getFirmId(req);
      const userId     = req.session?.user?._id;
  
      // Must exist & belong to firm
      const report = await ImportReport.findOne({ _id: importId, companyId: companyKey }).lean(false);
      if (!report) return res.status(404).json({ error: 'Import not found for this firm.' });
  
      if (report.undo?.status === 'running') return res.status(202).json({ message: 'Undo already in progress.' });
      if (report.undo?.status === 'done')    return res.status(409).json({ error: 'This import has already been undone.' });
  
      // Enforce “last import only”
      const last = await ImportReport.findOne({ companyId: companyKey }).sort({ createdAt: -1 }).select('_id').lean();
      if (!last || String(last._id) !== String(importId)) {
        return res.status(400).json({ error: 'Only the most recent import for this firm can be undone.' });
      }
  
      // Mark running (and emit a seed progress event)
      await ImportReport.updateOne(
        { _id: importId, companyId: companyKey },
        { $set: { 'undo.status': 'running', 'undo.progress': 0, 'undo.startedAt': new Date(), 'undo.byUser': userId } }
      );
      publishProgress(importId, { status: 'running', progress: 0 });
  
      // Respond immediately so the browser can open the SSE stream
      res.status(202).json({ ok: true });
  
      // Now do the undo work asynchronously (detached from this response)
      setImmediate(async () => {
        try {
          await performUndo({ reportId: importId, companyKey, firmId });
        } catch (err) {
          // already recorded + published inside performUndo
          console.error('[undo] failed:', err);
        }
      });
    } catch (err) {
      next(err);
    }
  };
  

exports.status = async (req, res) => {
  try {
    const companyKey = firmKey(req);
    const { importId } = req.params;
    const rep = await ImportReport.findOne({ _id: importId, companyId: companyKey }, 'undo').lean();
    if (!rep) return res.status(404).json({ error: 'not found' });
    const { undo = {} } = rep;
    res.json({
      status: undo.status || 'unknown',
      progress: typeof undo.progress === 'number' ? undo.progress : 0,
      error: undo.error || null
    });
  } catch (e) {
    res.status(500).json({ status: 'failed', progress: 0, error: e.message });
  }
};

async function performUndo({ reportId, companyKey, firmId }) {
    const all = await ImportReport.findOne(
      { _id: reportId, companyId: companyKey },
      'changes'
    ).lean();
  
    const changes = [...(all?.changes || [])].sort((a, b) => b.opIndex - a.opIndex);
    const total = Math.max(changes.length, 1);
  
    const CHUNK = 100;       // tune this (50–200 works well)
    let done = 0;
  
    while (done < total) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const end = Math.min(done + CHUNK, total);
          for (let i = done; i < end; i++) {
            const ch = changes[i];
            const Model = modelMap[ch.model];
            if (!Model) throw new Error(`Unknown model in undo: ${ch.model}`);
  
            // -- the same inverse logic you already have, BUT with { session } on the target docs only
            if (ch.op === 'create') {
              const doc = await Model.findById(ch.docId).session(session);
              if (doc) {
                if (!await docBelongsToFirmDeep(doc, { companyKey, firmId, session })) {
                  throw new Error(`Firm guard failed for ${ch.model} ${ch.docId}.`);
                }
                await Model.deleteOne({ _id: ch.docId }, { session });
              }
            } else if (ch.op === 'update') {
              if (ch.before?.companyId && String(ch.before.companyId).toLowerCase() !== companyKey) {
                throw new Error(`Cross-firm safety on ${ch.model} ${ch.docId}`);
              }
              if (ch.before?.firmId && firmId && String(ch.before.firmId) !== String(firmId)) {
                throw new Error(`Cross-firm safety on ${ch.model} ${ch.docId}`);
              }
              const filter = (typeof ch.after?.__v === 'number')
                ? { _id: ch.docId, __v: ch.after.__v }
                : { _id: ch.docId };
              await Model.replaceOne(filter, ch.before, { session, upsert: false });
            } else if (ch.op === 'delete') {
              if (!ch.before) throw new Error(`Missing BEFORE snapshot for delete on ${ch.model} ${ch.docId}`);
              if (ch.before?.companyId && String(ch.before.companyId).toLowerCase() !== companyKey) {
                throw new Error(`Cross-firm safety on ${ch.model} ${ch.docId}`);
              }
              if (ch.before?.firmId && firmId && String(ch.before.firmId) !== String(firmId)) {
                throw new Error(`Cross-firm safety on ${ch.model} ${ch.docId}`);
              }
              await Model.create([ ch.before ], { session });
            }
          }
        }, /* txnOptions */ { writeConcern: { w: 'majority' } });
      } finally {
        await session.endSession();
      }
  
      // only after chunk commit, bump counters & progress OUTSIDE any txn
      done = Math.min(done + CHUNK, total);
      const progress = Math.round((done / total) * 100);
      await ImportReport.updateOne(
        { _id: reportId },
        { $set: { 'undo.progress': progress } }
      );
      publishProgress(reportId, { status: 'running', progress });
    }
  
    // Mark done (outside any txn)
    await ImportReport.updateOne(
      { _id: reportId },
      { $set: { 'undo.status': 'done', 'undo.progress': 100, 'undo.finishedAt': new Date() } }
    );
    publishProgress(reportId, { status: 'done', progress: 100 });
  
    // Log activity (no need to be in a txn)
    const fresh = await ImportReport.findById(reportId);
    if (fresh) await logUndoActivity({ report: fresh, status: 'done' });
  }
  
