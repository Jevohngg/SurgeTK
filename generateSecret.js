const crypto = require('crypto');

// Generate a 64-byte random secret in hexadecimal format
const secret = crypto.randomBytes(64).toString('hex');
console.log(secret);
