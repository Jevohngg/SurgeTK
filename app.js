/****************************************************
 * app.js (Updated with Rate Limiting & Helmet)
 ****************************************************/

require('dotenv').config();

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const MongoStore = require('connect-mongo');
const session = require('express-session');
const sharedSession = require('socket.io-express-session'); // Import shared session middleware
const CompanyID = require('./models/CompanyID'); // Import the CompanyID model
const http = require('http');
const { Server } = require('socket.io'); // Import Socket.io Server
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logError } = require('./utils/errorLogger'); // your custom logger
const { ensureAuthenticated } = require('./middleware/authMiddleware');
const { ensureOnboarded } = require('./middleware/onboardingMiddleware');
const householdController = require('./controllers/householdController');



// Create the Express app
const app = express();

// app.use(
//   helmet({
//     // Keep your CSP directives:
//     contentSecurityPolicy: {
//       useDefaults: true,
//       directives: {
//         "default-src": ["'self'"],
//         "script-src": [
//           "'self'",
//           "https://cdn.jsdelivr.net",
//           "https://unpkg.com",
//           "https://js.stripe.com",
//           "https://code.jquery.com",
//           "'unsafe-inline'",
//         ],
//         "style-src": [
//           "'self'",
//           "https://fonts.googleapis.com",
//           "https://cdnjs.cloudflare.com",
//           "https://cdn.jsdelivr.net",
//           "https://unpkg.com",
//           "'unsafe-inline'",
//         ],
//         "font-src": [
//           "'self'",
//           "https://fonts.gstatic.com",
//           "https://cdnjs.cloudflare.com",
//           "https://cdn.jsdelivr.net",
//           "https://unpkg.com",
//           "data:",
//         ],
//         "img-src": [
//           "'self'",
//           "data:",
//           "https://invictus-avatar-images.s3.us-east-2.amazonaws.com",
//         ],
//         "frame-src": [
//           "'self'",
//           "https://www.youtube.com",
//           "https://js.stripe.com",
//         ],
//       },
//     },

//     // Completely disable HSTS by setting maxAge: 0
//     // and disabling subdomains + preload
//     // so your browser won't be told to force HTTPS
//     hsts: {
//       maxAge: 0,
//       includeSubDomains: false,
//       preload: false,
//     },

//     // Disable crossOriginEmbedderPolicy for dev
//     crossOriginEmbedderPolicy: false,
//   })
// );



// If behind a reverse proxy (e.g., Heroku, Nginx) in production, trust it so secure cookies work
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                    // change to whatever threshold you want
  standardHeaders: true,     // Returns rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,      // Disable the `X-RateLimit-*` headers

  // This function is called each time a request is blocked due to the limit
  handler: async (req, res, next, options) => {
    // 1) Log the event as CRITICAL
    //    You can use your `logError` utility or the errorHandler
    await logError(req, 'Too many login attempts from this IP', {
      severity: 'critical',
      statusCode: 429
    });

    // 2) Show the user some "scary" or clear message
    //    For a normal HTML response:
    return res.status(429).render('error', {
      message: 'Too many login attempts detected. Your IP has been logged. Please try again later. Contact support@surgetk.com',
      error: {}
    });
  }
});



// Attach it to the /login path
app.use('/login', loginLimiter);

// Create an HTTP server
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_IO_ORIGIN || "http://localhost:3000", // or your actual front-end origin
    methods: ["GET", "POST"]
  },
  // >>> ADD THESE <<<
  // Increase the ping interval and ping timeout.
  // This helps prevent mid-import disconnects when the server is busy or the network is slow.
  pingInterval: 95000, // ms between pings (default ~ 25 seconds)
  pingTimeout: 9000000   // ms before a ping is considered failed (default ~ 20 seconds)
});

// Make Socket.io accessible in your routes if needed
app.locals.io = io;

// Map to store import progress per user
app.locals.importProgress = new Map();

// Session middleware configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,  // keep your secret from .env
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.NODE_ENV === 'production'
      ? process.env.MONGODB_URI_PROD
      : process.env.MONGODB_URI_DEV
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,  // 1 day
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
});

app.use(sessionMiddleware);

const limitedAccessMiddleware = require('./middleware/limitedAccessMiddleware');

app.use((req, res, next) => {
  // List any routes or path patterns that DO NOT require authentication:
  const unprotectedPaths = [
    '/login',
    '/signup',
    '/forgot-password',
    '/verify-email',
    '/reset-password',
    '/verify-reset-code',
    '/logout',
    '/login/2fa',
    '/forgot-password/verify',
    '/resend-verification-email',
    '/webhooks/stripe',
    '/billing-limited',
    /^\/api\/value-add\/[^/]+\/view$/,    // regex to match `/api/value-add/:id/view`
    /^\/api\/value-add\/[^/]+\/download$/,
    /^\/api\/value-add\/[^/]+\/view\/[^/]+$/,     // /api/value-add/:id/view/:snapshotId
    /^\/api\/value-add\/[^/]+\/download\/[^/]+$/,
    
  ];

  // Allow static files, e.g. /public/... or /css/... or any accounts
  if (
    req.path.startsWith('/public/') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/images/')
  ) {
    return next();
  }

  // 1) If user isn't logged in and is requesting a route that isn't unprotected, redirect to /login
  const isUnprotected = unprotectedPaths.some((pattern) => {
    return typeof pattern === 'string' ? pattern === req.path : pattern.test(req.path);
  });
  
  if (!req.session.user && !isUnprotected) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  

  // 2) If user is logged in and tries to go to /login or /signup anyway, redirect to dashboard
  if (req.session.user && (req.path === '/login' || req.path === '/signup')) {
    return res.redirect('/dashboard');
  }

  next();
});





// Share session middleware with Socket.io
io.use(sharedSession(sessionMiddleware, {
  autoSave: true
}));

// MongoDB connection URI
const MONGODB_URI =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGODB_URI_PROD
    : process.env.MONGODB_URI_DEV;

// Set Pug as the template engine
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

const ErrorLog = require('./models/ErrorLog');
const handleStripeWebhook = require('./routes/stripeWebhook');

app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);



// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

// Function to insert hardcoded company IDs for development
const insertHardcodedCompanyIDs = async () => {
  const companyIds = [
    { companyId: 'ABC123' },
    { companyId: 'XYZ456' },
    { companyId: 'DEFG123' },
    { companyId: 'HIJK123' },
  ];

  try {
    console.log('Attempting to insert hardcoded company IDs...');

    for (let id of companyIds) {
      // Convert the companyId to lowercase before searching and inserting
      const companyIdLower = id.companyId.toLowerCase();

      // Check if the companyId already exists in a case-insensitive way
      const existing = await CompanyID.findOne({ companyId: companyIdLower });

      if (!existing) {
        await CompanyID.create({ companyId: companyIdLower }); // Insert as lowercase
        console.log(`Inserted company ID: ${companyIdLower}`);
      } else {
        console.log(`Company ID already exists: ${companyIdLower}`);
      }
    }
  } catch (err) {
    console.error('Error inserting company IDs:', err);
  }
};

app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const sessionUser = req.session.user;

    // 1) Check single permission first:
    if (sessionUser.permission === 'admin') {
      sessionUser.role = 'admin';
      sessionUser.permissions = { admin: true, advisor: false, assistant: false };
    }
    // 2) If not, but roles includes admin => also set admin
    else if (Array.isArray(sessionUser.roles) && sessionUser.roles.includes('admin')) {
      sessionUser.role = 'admin';
      sessionUser.permissions = { admin: true, advisor: false, assistant: false };
    }
    // 3) If user has advisor permission or roles => set advisor
    else if (sessionUser.permission === 'advisor' ||
      (Array.isArray(sessionUser.roles) && sessionUser.roles.includes('advisor'))) {
      sessionUser.role = 'advisor';
      sessionUser.permissions = { admin: false, advisor: true, assistant: false };
    }
    // 4) If user has assistant permission or roles => set assistant
    else if (sessionUser.permission === 'assistant' ||
      (Array.isArray(sessionUser.roles) && sessionUser.roles.includes('assistant'))) {
      sessionUser.role = 'assistant';
      sessionUser.permissions = { admin: false, advisor: false, assistant: true };
    }
    else {
      // Fallback if none of the above conditions are met
      sessionUser.role = 'unassigned';
      sessionUser.permissions = { admin: false, advisor: false, assistant: false };
    }

    // Check if user can view errors
    const isAllowedEmail = ALLOWED_ERROR_LOG_EMAILS.includes(sessionUser.email?.toLowerCase());
    res.locals.canViewErrors = isAllowedEmail && sessionUser.permissions?.admin;
  } else {
    res.locals.canViewErrors = false;
  }

  next();
});

// Add this array of allowed emails (modify as needed)
const ALLOWED_ERROR_LOG_EMAILS = [
  'jevohngentry@gmail.com',
  'grayson@techjump.io',
  // Add more emails as needed
];

// app.js (add this test route)
app.get('/test-error', (req, res, next) => {
  // Simulate an error
  const err = new Error('This is a test error!');
  err.status = 500;
  err.customData = { test: 'example' }; // Add some custom data to see in the stack
  throw err; // Throw the error to be caught by the error handler
});

app.get('/admin/errors', async (req, res, next) => {
  try {
    // Check if user is logged in
    if (!req.session.user) {
      console.log('No user in session, redirecting to login');
      return res.redirect('/login');
    }

    // Check permissions
    const isAdmin = req.session.user.permissions?.admin;
    const isAllowedEmail = ALLOWED_ERROR_LOG_EMAILS.includes(req.session.user.email?.toLowerCase());
    
    if (!isAdmin || !isAllowedEmail) {
      console.log(`Unauthorized access attempt to /admin/errors by user: ${req.session.user.email}`);
      const err = new Error('Unauthorized access to error logs');
      err.status = 403;
      return next(err);
    }

    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';

    // Build the match condition for search
    let matchCondition = {};
    if (search) {
      matchCondition = {
        $or: [
          { 'userId.email': { $regex: search, $options: 'i' } },
          { errorMessage: { $regex: search, $options: 'i' } },
          { url: { $regex: search, $options: 'i' } },
          { method: { $regex: search, $options: 'i' } }
        ]
      };
    }

    // Aggregation pipeline
    const aggregationPipeline = [
      {
        $lookup: {
          from: 'users', // Ensure this matches your User collection name
          localField: 'userId',
          foreignField: '_id',
          as: 'userId'
        }
      },
      {
        $unwind: {
          path: '$userId',
          preserveNullAndEmptyArrays: true // Include errors without userId
        }
      },
      {
        $match: matchCondition
      },
      {
        $sort: { timestamp: -1 }
      },
      {
        $facet: {
          paginatedErrors: [
            { $skip: (page - 1) * limit },
            { $limit: limit }
          ],
          totalCount: [
            { $count: 'count' }
          ]
        }
      }
    ];

    // Execute aggregation
    const result = await ErrorLog.aggregate(aggregationPipeline);

    // Extract paginated errors and total count
    const errors = result[0].paginatedErrors;
    const totalCount = result[0].totalCount[0]?.count || 0;

    // Calculate total pages
    const totalPages = Math.ceil(totalCount / limit);

    // Debugging logs
    console.log('Total count from aggregation:', totalCount);
    console.log('Total pages calculated:', totalPages);

    // Fetch company data
    const user = req.session.user;
    console.log('User data:', user);
    const companyData = await CompanyID.findOne({ companyId: user.companyId });
    if (companyData?.companyName && !user.companyName) {
      user.companyName = companyData.companyName;
    }

    // Calculate variables
    const isAdminAccess = user.roles.includes('admin') || user.permission === 'admin';
    const onboardingProgress = companyData?.onboardingProgress || {
      uploadLogo: false,
      selectBrandColor: false,
      inviteTeam: false,
      connectCRM: false,
      importHouseholds: false,
      importAccounts: false
    };

    // Render with all required variables
    res.render('admin/errors', {
      errors,
      title: 'Error Dashboard | SurgeTk',
      user,
      companyData,
      avatar: user.avatar,
      sessionMaxAge: req.session.cookie.maxAge,
      showWelcomeModal: false,
      isAdminAccess,
      onboardingProgress,
      videoId: process.env.YOUTUBE_VIDEO_ID || 'DEFAULT_VIDEO_ID',
      isAuthenticated: true,
      currentPage: page,
      totalPages,
      limit,
      search,
      totalCount
    });
  } catch (err) {
    console.error('Error in /admin/errors route:', err);
    next(err);
  }
});

// Insert hardcoded company IDs only in development environment
if (process.env.NODE_ENV === 'development') {
  console.log('Development environment detected. Inserting hardcoded company IDs...');
  insertHardcodedCompanyIDs();
} else {
  console.log('Not in development environment. Skipping hardcoded company IDs.');
}

app.use(limitedAccessMiddleware);

// Import routes
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const adminRoutes = require('./routes/adminRoutes'); 
const notificationRoutes = require('./routes/notificationRoutes');
const apiHouseholdRoutes = require('./routes/apiHouseholdRoutes');
const viewHouseholdRoutes = require('./routes/viewHouseholdRoutes');
const accountRoutes = require('./routes/accountRoutes');
const teamRoutes = require('./routes/teamRoutes');
const valueAddRoutes = require('./routes/valueAddRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes');
const billingRoutes = require('./routes/billingRoutes');
const limitedBillingRoutes = require('./routes/limitedBillingRoutes');
const integrationsRoutes = require('./routes/integrations');
const newImportRoutes = require('./routes/newImportRoutes');
const assetRoutes     = require('./routes/assetRoutes');
const liabilityRoutes = require('./routes/liabilityRoutes');







app.use((req, res, next) => {
  res.locals.currentRoute = req.path;
  next();
});

// Mount API Routes at /api/households
app.use('/api/households', apiHouseholdRoutes);


// 1) If user visits /households/:id, redirect to /client-info
app.get('/households/:id', ensureAuthenticated, ensureOnboarded, (req, res) => {
  const { id } = req.params;
  return res.redirect(`/households/${id}/client-info`);
});

// 2) /households/:id/client-info
app.get(
  '/households/:id/client-info',
  ensureAuthenticated,
  ensureOnboarded,
  householdController.renderHouseholdDetailsPage
);

// 3) /households/:id/accounts
app.get(
  '/households/:id/accounts',
  ensureAuthenticated,
  ensureOnboarded,
  householdController.renderHouseholdDetailsPage
);

// 4) /households/:id/value-adds
app.get(
  '/households/:id/value-adds',
  ensureAuthenticated,
  ensureOnboarded,
  householdController.renderHouseholdDetailsPage
);

app.get(
  '/households/:id/assets',
  ensureAuthenticated,
  ensureOnboarded,
  householdController.renderHouseholdDetailsPage
);

app.get(
  '/households/:id/liabilities',
  ensureAuthenticated,
  ensureOnboarded,
  householdController.renderHouseholdDetailsPage
);




// Mount View Routes at root
app.use('/', viewHouseholdRoutes);

// Use the routes
app.use('/api', accountRoutes);
app.use('/', userRoutes);
app.use('/', dashboardRoutes);
app.use('/settings', billingRoutes);

app.use('/', adminRoutes);
app.use('/', notificationRoutes);
// app.use('/', teamRoutes);
app.use('/settings/team', teamRoutes);
app.use('/api/value-add', valueAddRoutes);
app.use('/onboarding', onboardingRoutes);
app.use('/', settingsRoutes);
app.use('/', limitedBillingRoutes);
app.use('/api/integrations', integrationsRoutes);


app.use('/api/new-import', newImportRoutes);

app.use('/api', assetRoutes);
app.use('/api', liabilityRoutes);
app.use('/api', require('./routes/clientRoutes'));
const importEligibilityRoutes = require('./routes/importEligibility');
app.use('/api/import', importEligibilityRoutes);



// app.post('/webhooks/stripe', billingRoutes);

// app.js
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

// Socket.io Connection Handling
io.on('connection', (socket) => {
  const session = socket.handshake.session;

  if (session && session.user) {
    const userId = session.user._id.toString();
    socket.join(userId);
    console.log(`User ${userId} connected and joined room ${userId}`);

    // Access app.locals directly
    const progressMap = app.locals.importProgress;
    if (progressMap && progressMap.has(userId)) {
      const progressData = progressMap.get(userId);
      // Emit the current progress to the client
      socket.emit('importProgress', progressData);
    }

    // Handle progressClosed event
    socket.on('progressClosed', () => {
      // Remove the user's progress data
      if (progressMap.has(userId)) {
        progressMap.delete(userId);
        console.log(`Progress data for user ${userId} has been cleared.`);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected`);
    });
  } else {
    console.log('Unauthenticated socket connection attempt.');
    socket.disconnect();
  }
});

app.use(require('./middleware/errorHandler'));

// Connect to MongoDB and start the server
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => {
    console.log('Connected to MongoDB');

    // Start the server after successful connection
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => { // Use 'server' instead of 'app' to listen
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit the process if the connection fails
  });



  

// app.use((req, res, next) => {
//   const err = new Error('Not Found');
//   err.status = 404;
//   next(err);
// });

app.use((req, res, next) => {
  console.warn(`404 - Not Found: ${req.method} ${req.originalUrl}`);
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

