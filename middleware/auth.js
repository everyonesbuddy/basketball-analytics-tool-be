const jwt = require("jsonwebtoken");

// Sign-in for the personal OS. Tokens last 30 days (it's your own device).
const AUDIENCE = "personal-os";
const secret = () => process.env.JWT_SECRET || "";

function signToken(user) {
  if (!secret()) throw Object.assign(new Error("JWT_SECRET is not set"), { statusCode: 503 });
  return jwt.sign({ sub: String(user._id), email: user.email }, secret(), { expiresIn: "30d", audience: AUDIENCE });
}

function requireAuth(req, res, next) {
  if (!secret()) return res.status(503).json({ success: false, error: { message: "Sign-in isn't set up yet (JWT_SECRET missing)." } });
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: { message: "Sign in first." } });
  try {
    const payload = jwt.verify(token, secret(), { audience: AUDIENCE });
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ success: false, error: { message: "Your session ended. Sign in again." } });
  }
}

module.exports = { signToken, requireAuth };
