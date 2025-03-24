// app.js

require('dotenv').config();

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const sharedSession = require('socket.io-express-session'); // Import shared session middleware
const CompanyID = require('./models/CompanyID'); // Import the CompanyID model
const http = require('http');
const { Server } = require('socket.io'); // Import Socket.io Server

const app = express();

// Create an HTTP server
const server = http.createServer(app);

// Initialize Socket.io server
const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_IO_ORIGIN || "http://localhost:3000", // Update based on your frontend's origin
    methods: ["GET", "POST"]
  }
});

// Make Socket.io accessible in your routes if needed
app.locals.io = io;

// Map to store import progress per user
app.locals.importProgress = new Map();

// Session middleware configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET, // Ensure secret is set in your .env file
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } 
});

// Apply session middleware to Express
app.use(sessionMiddleware);



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
  ];

  // Allow static files, e.g. /public/... or /css/... or any assets
  // If your static files come from app.use(express.static(...)) above, it’s usually open by default.
  // If needed, you can add checks to skip them as well:
  if (
    req.path.startsWith('/public/') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/images/')
  ) {
    return next();
  }

  // 1) If user isn't logged in and is requesting a route that isn't unprotected, redirect to /login
  if (!req.session.user && !unprotectedPaths.includes(req.path)) {
    // Store the original URL they are trying to get to, e.g. /settings/team
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
      // fallback if none of the above
      sessionUser.role = 'unassigned';
      sessionUser.permissions = { admin: false, advisor: false, assistant: false };
    }
  }

  next();
});


// Insert hardcoded company IDs only in development environment
if (process.env.NODE_ENV === 'development') {
  console.log('Development environment detected. Inserting hardcoded company IDs...');
  insertHardcodedCompanyIDs();
} else {
  console.log('Not in development environment. Skipping hardcoded company IDs.');
}

// Import Routes
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










// Mount API Routes at /api/households
app.use('/api/households', apiHouseholdRoutes);

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


app.post('/webhooks/stripe', billingRoutes);



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
