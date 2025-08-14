// middleware/returnTo.js
'use strict';

/**
 * Paths we never want to treat as "destinations" after login.
 * Adjust to your app’s static/asset prefixes if different.
 */
const IGNORE_PREFIXES = [
  '/.well-known/',
  '/favicon',
  '/api/',
  '/socket.io/',
  '/static/',
  '/public/',
  '/assets/',
  '/images/',
  '/img/',
  '/css/',
  '/js/',
  '/dist/',
  '/__webpack_hmr',
  '/health',
  '/robots.txt',
  '/manifest.json'
];

function isIgnoredPath(pathname) {
  return IGNORE_PREFIXES.some(p => pathname.startsWith(p));
}

function isSafeRelativeUrl(url) {
  if (typeof url !== 'string') return false;
  // must be relative and not protocol-relative like //evil.com
  if (!url.startsWith('/')) return false;
  if (url.startsWith('//')) return false;
  return true;
}

/**
 * Only store returnTo for top-level, user-initiated page navigations.
 * We check:
 *  - GET
 *  - Accept contains text/html
 *  - Not XHR/fetch for assets
 *  - Not ignored prefixes
 */
function isTopLevelHtmlNav(req) {
  if (req.method !== 'GET') return false;

  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) return false;

  // Express sets req.xhr=true for Ajax requests
  if (req.xhr) return false;

  // Modern browsers send these; guard when present
  const secFetchDest = req.headers['sec-fetch-dest'];
  if (secFetchDest && secFetchDest !== 'document') return false;

  const secFetchMode = req.headers['sec-fetch-mode'];
  if (secFetchMode && secFetchMode !== 'navigate') return false;

  const secFetchUser = req.headers['sec-fetch-user'];
  if (secFetchUser && secFetchUser !== '?1') return false;

  const url = req.originalUrl || req.url || '/';
  if (isIgnoredPath(url)) return false;

  // Don’t capture auth routes themselves
  if (url === '/login' || url.startsWith('/auth/')) return false;

  return true;
}

/**
 * Mount this AFTER session + passport.session(), BEFORE your route protection.
 */
function storeReturnTo(req, res, next) {
  try {
    if (!(req.user || (req.session && req.session.user)) && isTopLevelHtmlNav(req)) {

      req.session.returnTo = req.originalUrl || '/';
    }
  } catch (e) {
    // don’t break requests if something odd happens
  }
  next();
}

/**
 * Use this immediately after successful login.
 * Ensures we never redirect to a probe/asset or unsafe URL.
 */
function pickSafeRedirect(req, fallback = '/dashboard') {
  let rt = req.session ? req.session.returnTo : '';
  if (req.session) delete req.session.returnTo;

  if (!isSafeRelativeUrl(rt)) return fallback;

  const hashless = rt.split('#')[0] || '';
  const pathOnly = hashless.split('?')[0] || '';

  if (!pathOnly || pathOnly === '/') return fallback;
  if (pathOnly === '/login' || pathOnly.startsWith('/auth/')) return fallback;
  if (isIgnoredPath(pathOnly)) return fallback;

  // 🚦 NEW: If stored returnTo is merely "/dashboard" but our caller prefers a different default,
  // prefer the caller's fallback (e.g., "/households").
  if (pathOnly === '/dashboard' && fallback && fallback !== '/dashboard') {
    return fallback;
  }

  // looks good
  return rt;
}


module.exports = {
  storeReturnTo,
  pickSafeRedirect,
};
