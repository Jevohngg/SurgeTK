// app.js

require('dotenv').config();

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const CompanyID = require('./models/CompanyID'); // Import the CompanyID model
const app = express();

// Apply session middleware
app.use(session({
  secret: process.env.SESSION_SECRET, // Ensure secret is set in your .env file
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour session expiry
}));

// Determine which MongoDB URI to use
const MONGODB_URI = process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI_DEV;

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Set Pug as the template engine
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded form data
app.use(express.json()); // Parse JSON data
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

// Function to insert hardcoded company IDs for development
const insertHardcodedCompanyIDs = async () => {
  const companyIds = [
    { companyId: 'ABC123' },
    { companyId: 'XYZ456' },
    { companyId: 'DEFG123' },
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

// Check if in development environment
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

// Use the routes
app.use('/', userRoutes);
app.use('/', dashboardRoutes);
app.use('/', settingsRoutes);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
