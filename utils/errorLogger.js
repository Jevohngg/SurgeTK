// utils/errorLogger.js
const ErrorLog = require('../models/ErrorLog');

// Function to sanitize req.body by removing password fields
const sanitizeBody = (body) => {
  const sanitized = { ...body }; // Create a shallow copy of req.body
  // Define sensitive fields to exclude
  const sensitiveFields = ['password', 'confirmPassword', 'newPassword'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      delete sanitized[field]; // Remove the field entirely
    }
  });
  return sanitized;
};

const logError = async (req, message, options = {}) => {
  const {
    severity = 'warning', // Default to warning for user errors
    statusCode = 400,     // Default to 400 for user errors
    stackTrace = null     // Optional stack trace
  } = options;

  try {
    // Sanitize req.body to exclude sensitive information
    const sanitizedBody = sanitizeBody(req.body);

    const errorLog = new ErrorLog({
      userId: req.session?.user?._id || null,
      username: req.session?.user?.name || 'Anonymous',
      errorMessage: message,
      stackTrace,
      url: req.originalUrl,
      method: req.method,
      statusCode,
      requestBody: sanitizedBody, // Use sanitized body
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      severity
    });

    const savedError = await errorLog.save();
    console.log(`[${severity.toUpperCase()}] Error logged: ${message}, ID: ${savedError._id}`);

    // Notify admins via Socket.io if critical
    if (req.app.locals.io && severity === 'critical') {
      const adminUsers = await require('../models/User').find({ roles: 'admin' }).select('_id');
      adminUsers.forEach(admin => {
        req.app.locals.io.to(admin._id.toString()).emit('newError', {
          message,
          timestamp: errorLog.timestamp,
          url: req.originalUrl
        });
      });
    }

    return savedError;
  } catch (loggingError) {
    console.error('Failed to log error:', loggingError);
  }
};

module.exports = { logError };