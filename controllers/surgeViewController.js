// controllers/surgeViewController.js
const Surge   = require('../models/Surge');
const Company = require('../models/CompanyID');

/**
 * GET /surge – list page
 */
exports.renderSurgeListPage = async (req, res) => {
  const user = req.session.user;
  const companyData = await Company.findOne({ companyId: user.companyId });

  res.render('surge/list', {
    title: 'Surge – Packet Batches',
    user,
    companyData,
    avatar: user.avatar
  });
};

/**
 * GET /surge/:id – composer / detail page
 */
exports.renderSurgeDetailPage = async (req, res, next) => {
  try {
    const { id }    = req.params;
    const firmId    = req.session.user.firmId;
    const user      = req.session.user;

    // 1) Fetch + firm‐scope in one query, then lean to POJO
    const surgeDoc = await Surge
      .findOne({ _id: id, firmId })
      .lean();

    if (!surgeDoc) {
      return res
        .status(404)
        .render('error', {
          message: 'Surge not found',
          user
        });
    }

    // 2) Normalize for front-end
    surgeDoc.valueAdds = Array.isArray(surgeDoc.valueAdds)
      ? surgeDoc.valueAdds
      : [];
    surgeDoc.uploads   = Array.isArray(surgeDoc.uploads)
      ? surgeDoc.uploads
      : [];

    // ─── New: build human-readable dateRange ──────────────────────────
// ─── New: build human-readable dateRange (force UTC) ─────────────
let dateRange = '';
if (surgeDoc.startDate && surgeDoc.endDate) {
  const fmtOpts = {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
    timeZone: 'UTC'               // ← add this
  };
  const startFmt = new Date(surgeDoc.startDate)
                     .toLocaleDateString('en-US', fmtOpts);
  const endFmt   = new Date(surgeDoc.endDate)
                     .toLocaleDateString('en-US', fmtOpts);
  dateRange = `${startFmt} – ${endFmt}`;
}

    // ────────────────────────────────────────────────────────────────

    // 3) Fetch company data for header/logo
    const companyData = await Company.findOne({ companyId: user.companyId });

    // 4) Render Pug with surge object + dateRange
    return res.render('surge/detail', {
      title:      `${surgeDoc.name} – SurgeTk`,
      user,
      companyData,
      avatar:     user.avatar,
      surge:      surgeDoc,
      dateRange   // <-- now available in Pug
    });
  } catch (err) {
    next(err);
  }
};
