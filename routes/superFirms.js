// routes/superFirms.js
const express = require('express');
const router = express.Router();

module.exports = ({ User, CompanyID, requireSuper }) => {
  // List firms with displayName + creatorEmail
  router.get('/super/firms', requireSuper, async (req, res) => {
    const user = req.session.user;
    const sessionMaxAge = req.session.cookie?.maxAge;
    const showWelcome = req.session.showWelcomeModal || false;

    // Normalize the companyId we read from the session
    const userCompanyId = (user?.companyId || '').toString();
    const userCompanyIdLower = userCompanyId.toLowerCase();
    const isAdminAccess =
    (Array.isArray(user?.roles) && user.roles.includes('admin')) ||
    user?.permission === 'admin';


    // Find the firm's CompanyID record using the lowercased key (schema lowercases on save)
    const companyData = await CompanyID.findOne({ companyId: userCompanyIdLower });
    const firms = await CompanyID.aggregate([
      {
        $project: {
          _id: 1,
          name: 1,
          companyName: 1,
          companyId: 1,     // string code like "abc123"
          createdAt: 1,
          createdBy: 1      // optional: ObjectId(user)
        }
      },
      {
        // Join to users by string companyId OR by ObjectId firmId fallback
        $lookup: {
          from: 'users',
          let: { firmCompanyId: '$companyId', firmObjectId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$companyId', '$$firmCompanyId'] }, // string match
                    { $eq: ['$firmId', '$$firmObjectId'] }      // objectId match (if you use it)
                  ]
                }
              }
            },
            {
              // Derive a robust isAdmin flag from multiple possible fields
              $addFields: {
                _isAdmin: {
                  $or: [
                    { $eq: ['$role', 'admin'] },
                    { $eq: ['$permission', 'admin'] },
                    { $eq: [{ $ifNull: ['$permissions.admin', false] }, true] },
                    { $in: ['admin', { $ifNull: ['$roles', []] }] }
                  ]
                }
              }
            },
            { $sort: { _isAdmin: -1, createdAt: 1 } }, // admins first, then oldest
            { $project: { _id: 1, email: 1, name: 1, _isAdmin: 1, createdAt: 1 } }
          ],
          as: 'firmUsers'
        }
      },
      {
        // If createdBy exists, prefer that user as the creator
        $addFields: {
          _creatorFromCreatedBy: {
            $first: {
              $filter: {
                input: '$firmUsers',
                as: 'u',
                cond: { $eq: ['$$u._id', '$createdBy'] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          creator: {
            $ifNull: ['$_creatorFromCreatedBy', { $arrayElemAt: ['$firmUsers', 0] }]
          },
          displayName: {
            $ifNull: ['$name', { $ifNull: ['$companyName', '$companyId'] }]
          }
        }
      },
      {
        $project: {
          _id: 1,
          companyId: 1,
          displayName: 1,
          creatorEmail: '$creator.email',
          createdAt: 1
        }
      },
      { $sort: { displayName: 1 } }
    ]);

    res.render('super/firms', { 
        firms,
        title: 'Firms',
        user,
        companyData: companyData || {},
        avatar: user?.avatar || null,
        isAdminAccess,

    });
  });

  // Confirm page (optional)
  router.get('/super/firms/:firmId', requireSuper, async (req, res) => {
    const firm = await CompanyID.findById(req.params.firmId)
      .select('_id name companyName companyId')
      .lean();
    if (!firm) return res.status(404).send('Firm not found');

    const displayName = firm.name || firm.companyName || firm.companyId || '(unnamed)';
    res.render('super/firm-confirm', { firm: { ...firm, displayName } });
  });


    // Allow exiting ghost mode even if req.user is the impersonated admin
    function allowExitGhost(req, res, next) {
        // If we're currently ghosting in this session, always allow exit
        if (req.session && req.session.ghost) return next();
    
        // Otherwise, allow true super-super admins as well (using real identity)
        const real = req.originalUser || req.session.user || req.user || null;
        if (real && isSuperSuperAdmin(real)) return next();
    
        return res.status(403).send('Forbidden');
      }

// Start Ghost Mode (impersonate an admin inside the firm)
router.post('/super/firms/:firmId/ghost', requireSuper, async (req, res) => {
    const firmId = req.params.firmId;
    const firm = await CompanyID.findById(firmId).lean();
    if (!firm) return res.status(404).send('Firm not found');
  
    // Find an admin inside this firm (fall back to any user if needed)
    const adminUser =
      await User.findOne({
        $and: [
          {
            $or: [
              { role: 'admin' },
              { permission: 'admin' },
              { 'permissions.admin': true },
              { roles: 'admin' },
              { isAdmin: true }
            ]
          },
          {
            $or: [
              { companyId: firm.companyId }, // string code
              { firmId: firm._id }           // objectId link (if present)
            ]
          }
        ]
      })
        .select('_id email name companyId firmId permission roles permissions avatar createdAt')
        .lean()
      ||
      await User.findOne({
        $or: [
          { companyId: firm.companyId },
          { firmId: firm._id }
        ]
      }).select('_id email name companyId firmId permission roles permissions avatar createdAt').lean();
  
    if (!adminUser) {
      return res.status(404).send('No user found in that firm to impersonate.');
    }
  
    // Save your real identity once (if not already saved)
    if (!req.session._realUser) {
      req.session._realUser = req.session.user;
    }
  
    // Replace the session's current user with the impersonated admin
    const startedAt = new Date().toISOString();
    req.session.user = {
      ...adminUser,
      _isGhost: true,
      _ghost: {
        by: String(req.session._realUser?._id || ''),
        emailBy: req.session._realUser?.email || '',
        firmId: adminUser.companyId || adminUser.firmId,
        startedAt
      }
    };
  
    // Keep ghost metadata for banner + context
    req.session.ghost = {
      impersonatedUserId: String(adminUser._id),
      firmId: adminUser.companyId || adminUser.firmId,
      firmName: (firm.name || firm.companyName || firm.companyId || null),
      startedAt
    };
  
    // Ensure session persists before redirect (paranoid but helpful)
    req.session.save(() => res.redirect('/'));
  });
  

  router.post('/super/ghost/exit', allowExitGhost, (req, res) => {
    if (req.session) {
      if (req.session._realUser) {
        req.session.user = req.session._realUser; // restore original identity
      }
      req.session._realUser = undefined;
      req.session.ghost = null;
      return req.session.save(() => res.redirect('/'));
    }
    return res.redirect('/');
  });
  

  return router;
};
