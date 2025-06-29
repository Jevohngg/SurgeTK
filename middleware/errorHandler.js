// middleware/errorHandler.js
const ErrorLog = require('../models/ErrorLog');

const errorHandler = async (err, req, res, next) => {

  // ── If this was an API call, always return JSON ──
  if (req.originalUrl.startsWith('/api/')) {
    return res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }

  console.log('=== ERROR HANDLER TRIGGERED ===');
  console.log('Error details:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.session?.user || 'No session user'
  });



  try {
    // Log the error to the database
    const errorLog = new ErrorLog({
      userId: req.session?.user?._id || null,
      username: req.session?.user?.name || 'Anonymous',
      errorMessage: err.message,
      stackTrace: err.stack,
      url: req.originalUrl,
      method: req.method,
      statusCode: err.status || 500,
      requestBody: req.body,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      severity: err.status === 403 ? 'warning' : 'critical' // Mark unauthorized access as warning
    });

    const savedError = await errorLog.save();
    console.log('Error saved successfully with ID:', savedError._id);

    // Notify admins via Socket.io (only for critical errors)
    if (req.app.locals.io && errorLog.severity === 'critical') {
      const adminUsers = await require('../models/User').find({ roles: 'admin' }).select('_id');
      console.log('Notifying admins:', adminUsers.length);
      adminUsers.forEach(admin => {
        req.app.locals.io.to(admin._id.toString()).emit('newError', {
          message: err.message,
          timestamp: errorLog.timestamp,
          url: req.originalUrl
        });
      });
    }

    // Handle 403 (Unauthorized) differently
    if (err.status === 403) {
      // Render a minimal unauthorized page without sensitive info
      return res.status(403).render('unauthorized', {
        message: 'You do not have permission to access this page.',
        title: 'Access Denied'
      });
    }

    // For other errors, render the error page but hide stack traces in production
    res.status(err.status || 500).render('error', {
      message: err.message,
      error: process.env.NODE_ENV === 'development' ? err : {} // Only show stack trace in development
    });
  } catch (loggingError) {
    console.error('Error logging failed:', loggingError);
    res.status(500).render('error', {
      message: 'Internal Server Error',
      error: {}
    });
  }
};

module.exports = errorHandler;