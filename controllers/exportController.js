// controllers/exportController.js
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const ExportJob = require('../models/ExportJob');
const ExportPreference = require('../models/ExportPreference');
const CompanyID = require('../models/CompanyID');
const User = require('../models/User');

const columnCatalog = require('../services/exports/columnCatalog');
const { resolveScope } = require('../services/exports/permissionScope');
const { buildListPipeline } = require('../services/exports/queryBuilder');
const { formatRow } = require('../services/exports/rowFormatter');

const { writeCsvToStream } = require('../utils/exports/csvStream');
const { writeXlsxToStream } = require('../utils/exports/xlsxStream');
const { emitProgress } = require('../utils/exports/progress');

const Account = require('../models/Account');
const Client  = require('../models/Client');
const Insurance = require('../models/Insurance');
const Liability = require('../models/Liability');
const Household = require('../models/Household');
const Asset = require('../models/Asset');

function getModelByType(exportType) {
  switch (exportType) {
    case 'accounts': return Account;
    case 'contacts': return Client;
    case 'insurance': return Insurance;
    case 'liabilities': return Liability;
    case 'assets': return Asset;
    default: return null;
  }
}


// ---------- View ----------
exports.renderExportPage = async (req, res, next) => {
  try {
    const user = req.session.user;
    const sessionMaxAge = req.session.cookie?.maxAge || null;
    const showWelcome = req.session.showWelcomeModal || false;

    // Normalize firm key from the session
    const userCompanyId = (user?.companyId || '').toString();
    const userCompanyIdLower = userCompanyId.toLowerCase();

    // Load firm record by lowercased key (schema lowercases on save)
    const companyData = await CompanyID.findOne({ companyId: userCompanyIdLower });

    // Cache companyName on the session user if missing
    if (companyData?.companyName && !user.companyName) {
      user.companyName = companyData.companyName;
      req.session.user = user;
    }

    const isAdminAccess =
      (Array.isArray(user?.roles) && user.roles.includes('admin')) ||
      user?.permission === 'admin';

    // Step 1 flags from CompanyID
    const baseProgress = (companyData && companyData.onboardingProgress)
      ? companyData.onboardingProgress
      : { uploadLogo: false, selectBrandColor: false, inviteTeam: false };

    // Step 2 (Add Your Data)
    let step2 = { createHouseholds: false, createAccounts: false, assignAdvisors: false };
    try {
      const { getAddYourDataProgress } = require('../services/onboardingProgress');
      step2 = await getAddYourDataProgress({
        companyIdStr: userCompanyId,
        companyObjectId: companyData?._id
      });
    } catch (_) { /* ignore in environments without helper */ }

    const onboardingProgress = {
      ...baseProgress,
      createHouseholds: !!step2.createHouseholds,
      createAccounts:   !!step2.createAccounts,
      assignAdvisors:   !!step2.assignAdvisors
    };

    const step1Complete =
      !!(onboardingProgress.uploadLogo &&
         onboardingProgress.selectBrandColor &&
         onboardingProgress.inviteTeam);

    const step2Complete =
      !!(onboardingProgress.createHouseholds &&
         onboardingProgress.createAccounts &&
         onboardingProgress.assignAdvisors);

    const isReady = step1Complete && step2Complete;

    // Prevent showing welcome on next render
    req.session.showWelcomeModal = false;

    res.render('reports/index', {
      title: 'Reports | SurgeTk',
      user,
      companyData: companyData || {},
      avatar: user?.avatar || null,
      sessionMaxAge,
      showWelcomeModal: showWelcome,
      isAdminAccess,
      onboardingProgress,
      step1Complete,
      step2Complete,
      isReady,
      videoId: process.env.YOUTUBE_VIDEO_ID || 'DEFAULT_VIDEO_ID',
      isAuthenticated: true
    });
  } catch (err) {
    console.error('[exports] error:', err);
    res.status(500).send('Something went wrong');
  }
};

// ---------- API: Column Catalog ----------
exports.getColumns = async (req, res) => {
  const type = String(req.query.type || '').toLowerCase();
  if (!['accounts','contacts','insurance','liabilities','assets','billing'].includes(type)) {
    return res.status(400).json({ success: false, message: 'Invalid export type' });
  }
  return res.json({ success: true, data: columnCatalog[type] });
};

// ---------- API: Scope Text ----------
exports.getScopeText = async (req, res, next) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    const { firm } = await resolveScope(req, type, null);
    const firmName = firm.companyName || req.session.user.companyId;
    const txt = `Showing all ${type} for ${firmName}.`;
    res.json({ success: true, text: txt });
  } catch (e) { next(e); }
};

// ---------- API: List (for table) ----------
exports.list = async (req, res, next) => {
  try {
    const exportType = String(req.query.type || '').toLowerCase();
    const debug = req.query.debug === '1';
    const skip  = Math.max(0, parseInt(req.query.skip || '0', 10));
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '100', 10)));
    const requested = (req.query.columns ? String(req.query.columns).split(',') : (columnCatalog[exportType]?.defaults || [])).filter(Boolean);
   const columns = filterValidColumns(exportType, requested);

    const search = req.query.search || '';
    const typedFilters = req.body?.filters || {};
    const sort = req.body?.sort || {};

    const { firm, householdIds } = await resolveScope(req, exportType, null);

    const { model, pipeline, countPipeline } = buildListPipeline({
      exportType, firmId: firm._id, householdIds, columns, search, typedFilters, sort, skip, limit, debug
    });

    const coll = model ? model.aggregate(pipeline) : Household.aggregate(pipeline);
    const rawItems = await coll.exec();

    // When debugging assets, dump the first raw doc to server logs
    if (debug && exportType === 'assets' && rawItems.length) {
      console.log('[DEBUG assets:firstRaw]', JSON.stringify(rawItems[0], null, 2));
    }
    let total = 0;
    if (model) {
      const countAgg = await model.aggregate(countPipeline).exec();
      total = countAgg[0]?.count || 0;
    } else {
      const countAgg = await Household.aggregate([...countPipeline]).exec();
      total = countAgg[0]?.count || 0;
    }

  // Single-pass formatting: pull nested values using dot paths + format dates
  const items = rawItems.map((doc) => {
      const fr = formatRow(columns, doc, { timezone: 'UTC', dateFormat: 'MM-dd-yyyy' }, exportType);
      if (doc && doc._id != null) fr._id = String(doc._id);
      return fr;
    });
    res.json({
      success: true,
      total,
      items,
      debug: debug ? { first5Raw: rawItems.slice(0, 5) } : undefined
    });
  } catch (e) {
    next(e);
  }
};

// ---------- API: Preview (first 50 rows, formatted) ----------
exports.preview = async (req, res, next) => {
  try {
    const debug = req.query?.debug === '1';
    const { exportType, columns, filters, sort, options } = req.body;
    const cols = filterValidColumns(exportType, Array.isArray(columns) && columns.length ? columns : (columnCatalog[exportType]?.defaults || []));
    const { firm, householdIds } = await resolveScope(req, exportType, null);

    const { model, pipeline } = buildListPipeline({
      exportType, firmId: firm._id, householdIds, columns: cols, search: '', typedFilters: filters || {}, sort: sort || {}, skip: 0, limit: 50, debug
    });

    const items = await (model ? model.aggregate(pipeline) : Household.aggregate(pipeline)).exec();
    const frontOpts = { ...(options || {}), timezone: options?.timezone || 'UTC', dateFormat: 'MM-dd-yyyy' };
    const formatted = items.map(r => formatRow(cols, r, frontOpts, exportType));
    res.json({ success: true, items: formatted, columns: cols });
  } catch (e) { next(e); }
};

// helper: flatten label map for selected export type
function flattenLabels(cat) {
  const out = {};
  if (!cat || !Array.isArray(cat.groups)) return out;
  for (const g of cat.groups) {
    for (const c of (g.columns || [])) {
      out[c.id] = c.label || c.id;
    }
  }
  return out;
}

// Helper: filter a list of column ids to only those defined in the catalog
function filterValidColumns(exportType, cols) {
    const cat = columnCatalog[exportType];
    if (!cat) return [];
    const valid = new Set(
      (cat.groups || []).flatMap(g => (g.columns || []).map(c => c.id))
    );
    const filtered = (cols || []).filter(c => valid.has(c));
    return filtered.length ? filtered : (cat.defaults || []);
  }

// ---------- API: Run Export (IMMEDIATE DOWNLOAD) ----------
exports.run = async (req, res, next) => {
  const body = typeof req.body?.payload === 'string'
    ? JSON.parse(req.body.payload)
    : req.body;

  try {
    const {
      exportType,
      columns,
      filters,
      sort,
      options,
      scope,
      selectedIds,
      format
    } = body;

    const fmt = (format || 'csv').toLowerCase();
    if (!['csv','xlsx'].includes(fmt)) {
      return res.status(400).json({ success: false, message: 'Invalid format' });
    }

    const preCols = Array.isArray(columns) && columns.length
      ? columns
      : (columnCatalog[exportType]?.defaults || []);
    const cols = filterValidColumns(exportType, preCols);

    const { firm, householdIds } = await resolveScope(req, exportType, null);

    await ExportPreference.findOneAndUpdate(
      { firmId: firm._id, user: req.session.user._id, exportType },
      { $set: { columns: cols, filters: filters || {}, sort: sort || {} } },
      { upsert: true }
    );

    const job = await ExportJob.create({
      firmId: firm._id,
      user: req.session.user._id,
      exportType,
      scope: scope === 'selected' ? 'selected' : 'all',
      format: fmt,
      options: options || {},
      columns: cols,
      filters: filters || {},
      sort: sort || {},
      selectedIds: Array.isArray(selectedIds) ? selectedIds : [],
      status: 'running',
      startedAt: new Date()
    });

    const { model, pipeline } = buildListPipeline({
      exportType,
      firmId: firm._id,
      householdIds,
      columns: cols,
      search: '',
      typedFilters: filters || {},
      sort: sort || {},
      skip: 0,
      limit: Number.MAX_SAFE_INTEGER
    });

    if (scope === 'selected' && exportType !== 'billing' && job.selectedIds?.length) {
      const baseMatch = { _id: { $in: job.selectedIds.map(id => new mongoose.Types.ObjectId(id)) } };
      pipeline.splice(1, 0, { $match: baseMatch });
    }

    const baseAgg = model ? model.aggregate(pipeline) : require('../models/Household').aggregate(pipeline);
    const cursor = baseAgg
      .allowDiskUse(true)
      .cursor({ batchSize: 1000 });

    // File headers
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `export_${exportType}_${timestamp}.${fmt}`;
    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Build header labels from catalog groups
    const labelMap = flattenLabels(columnCatalog[exportType] || {});
    const headerLabels = cols.map(c => labelMap[c] || c);

    let processed = 0;
    const rowsAsyncIterator = (async function* () {
      for await (const doc of cursor) {
        const row = formatRow(cols, doc, options || {}, exportType);
        processed++;
        if (processed % 2000 === 0) {
          emitProgress(req.app, req.session.user._id, { jobId: String(job._id), status: 'running', processed });
        }
        yield row;
      }
    })();

    if (fmt === 'csv') {
      await writeCsvToStream({
        stream: res,
        columns: cols,
        headerLabels,
        includeHeaders: options?.includeHeaders !== false,
        delimiter: options?.delimiter || ',',
        rowsAsyncIterator,
        onRow: (i) => emitProgress(req.app, req.session.user._id, { jobId: String(job._id), status: 'running', processed: i })
      });
    } else {
      await writeXlsxToStream({
        stream: res,
        sheetName: exportType.toUpperCase(),
        columns: cols,
        headerLabels,
        rowsAsyncIterator,
        onRow: (i) => emitProgress(req.app, req.session.user._id, { jobId: String(job._id), status: 'running', processed: i })
      });
    }

    await ExportJob.findByIdAndUpdate(job._id, {
      status: 'complete',
      rowCount: processed,
      filePath: '',
      fileName: filename,
      completedAt: new Date()
    });
  } catch (e) {
    try {
      await ExportJob.findOneAndUpdate(
        { user: req.session.user._id },
        { $set: { status: 'failed', error: e.message } },
        { sort: { createdAt: -1 } }
      );
    } catch (_) {}
    next(e);
  }
};

// ---------- API: History ----------
exports.history = async (req, res, next) => {
  try {
    const user = req.session.user;
    const userCompanyId = (user?.companyId || '').toString();
    const userCompanyIdLower = userCompanyId.toLowerCase();
    const firm = await CompanyID.findOne({ companyId: userCompanyIdLower }).select('_id');

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const jobs = await ExportJob.find({ firmId: firm._id })
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    res.json({
      success: true,
      items: jobs.map(j => ({
        id: j._id,
        when: DateTime.fromJSDate(j.createdAt).setZone('UTC').toFormat('MM-dd-yyyy'),
        who: j.user ? `${j.user.firstName || ''} ${j.user.lastName || ''}`.trim() || j.user.email : 'Unknown',
        type: j.exportType,
        scope: j.scope,
        format: j.format,
        status: j.status,
        rows: j.rowCount || '',
        fileName: j.fileName,
        downloadUrl: null
      }))
    });
  } catch (e) { next(e); }
};

// ---------- API: Download (disabled; we don't store files) ----------
exports.download = async (req, res, next) => {
  try {
    return res.status(410).json({
      success: false,
      message: 'Exports are streamed directly and are not stored on the server. Please re-run the export.'
    });
  } catch (e) { next(e); }
};
