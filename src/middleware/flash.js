function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function pullFlash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

module.exports = { setFlash, pullFlash };
