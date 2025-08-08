// middleware/flashPump.js
module.exports = function flashPump(req, res, next) {
    res.locals.flash = req.session.flash || null;
    if (req.session.flash) delete req.session.flash;
    next();
  };
  