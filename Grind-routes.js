// ═══════════════════════════════════════════════════════
// GRIND Account & Profile Routes
// Add these to your existing Railway Express server
// (apex-backend-production-5cec.up.railway.app)
// ═══════════════════════════════════════════════════════
// npm install bcryptjs jsonwebtoken (add to your package.json)

const bcrypt = require('bcryptjs')
const jwt    = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'grind_night_inc_secret_2026'

// In-memory store (swap for a real DB later)
// For Railway: use process.env to persist, or add a Postgres/Redis addon
const GRIND_USERS    = {}  // { email: { hash, name, username } }
const GRIND_PROFILES = {}  // { email: { profile, bookmarks, history } }

// ── Middleware: verify token ──────────────────────────
function grindAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' })
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET)
    next()
  } catch(e) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// ── POST /grind/account/create ────────────────────────
// Body: { email, password, name, username }
// Returns: { token, user }
module.exports.createAccount = async (req, res) => {
  const { email, password, name, username } = req.body
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: 'Valid email and 8+ char password required' })
  if (GRIND_USERS[email])
    return res.status(409).json({ error: 'Account already exists. Try logging in.' })
  const hash = await bcrypt.hash(password, 10)
  GRIND_USERS[email] = { hash, name, username, createdAt: Date.now() }
  const token = jwt.sign({ email, name, username }, JWT_SECRET, { expiresIn: '365d' })
  res.json({ token, user: { email, name, username } })
}

// ── POST /grind/account/login ─────────────────────────
// Body: { email, password }
// Returns: { token, user }
module.exports.login = async (req, res) => {
  const { email, password } = req.body
  const user = GRIND_USERS[email]
  if (!user) return res.status(404).json({ error: 'No account found' })
  const ok = await bcrypt.compare(password, user.hash)
  if (!ok) return res.status(401).json({ error: 'Wrong password' })
  const token = jwt.sign({ email, name: user.name, username: user.username }, JWT_SECRET, { expiresIn: '365d' })
  res.json({ token, user: { email, name: user.name, username: user.username } })
}

// ── POST /grind/profile/sync ──────────────────────────
// Auth: Bearer token
// Body: { profile, bookmarks, history }
module.exports.syncProfile = (req, res) => {
  const { email } = req.user
  const { profile, bookmarks, history } = req.body
  GRIND_PROFILES[email] = {
    profile:   { ...profile, token: undefined }, // don't store token
    bookmarks: bookmarks || [],
    history:   (history || []).slice(0, 100),
    updatedAt: Date.now(),
  }
  res.json({ ok: true, synced: Date.now() })
}

// ── GET /grind/profile/load ───────────────────────────
// Auth: Bearer token
// Returns: { profile, bookmarks, history }
module.exports.loadProfile = (req, res) => {
  const { email } = req.user
  const data = GRIND_PROFILES[email]
  if (!data) return res.json({ profile: null, bookmarks: [], history: [] })
  res.json(data)
}

// ══════════════════════════════════════════════════════
// WIRE INTO YOUR EXPRESS APP (server.js / index.js)
// Add these lines to your existing server file:
// ══════════════════════════════════════════════════════
/*

const grind = require('./grind-routes')  // this file

app.post('/grind/account/create', grind.createAccount)
app.post('/grind/account/login',  grind.login)
app.post('/grind/profile/sync',   grindAuth, grind.syncProfile)
app.get ('/grind/profile/load',   grindAuth, grind.loadProfile)

*/
