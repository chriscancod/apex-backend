// ╔══════════════════════════════════════════════════════════════════╗
// ║  ** NODE.JS BACKEND FILE **                                      ║
// ║  FILE: jarvis-security.js                                        ║
// ║  WHERE: ~/Desktop/nightcode/  (your Railway project folder)      ║
// ║  THEN:  Add 2 lines from server-patch.js into your server.js     ║
// ║  WHAT:  Security routes — lockdown alerts, status, clear         ║
// ╚══════════════════════════════════════════════════════════════════╝
// jarvis-security.js
// Add this to your existing Railway backend
// Route: POST /api/jarvis/security
// Route: GET  /api/jarvis/security/status
// Route: POST /api/jarvis/security/clear

const express = require('express')
const router  = express.Router()

// In-memory store (replace with DB if needed)
let securityState = {
  lockdown:  false,
  reason:    '',
  timestamp: null,
  alerts:    []  // Last 50 alerts
}

// POST /api/jarvis/security
// Called by JARVIS on Mac when unauthorized voice detected
router.post('/', (req, res) => {
  const { event, reason, timestamp, location, severity } = req.body

  const alert = { event, reason, timestamp, location, severity, id: Date.now() }
  securityState.alerts.unshift(alert)
  securityState.alerts = securityState.alerts.slice(0, 50)

  if (event === 'LOCKDOWN') {
    securityState.lockdown  = true
    securityState.reason    = reason || 'Unauthorized access'
    securityState.timestamp = timestamp || new Date().toISOString()
    console.log(`[JARVIS SECURITY] LOCKDOWN: ${reason}`)
  } else if (event === 'CLEAR') {
    securityState.lockdown  = false
    securityState.reason    = ''
    console.log('[JARVIS SECURITY] Lockdown cleared')
  }

  res.json({ ok: true, state: securityState.lockdown ? 'LOCKDOWN' : 'CLEAR' })
})

// GET /api/jarvis/security/status
// Swift app polls this to know current state
router.get('/status', (req, res) => {
  res.json({
    lockdown:  securityState.lockdown,
    reason:    securityState.reason,
    timestamp: securityState.timestamp,
    alerts:    securityState.alerts.slice(0, 10)
  })
})

// POST /api/jarvis/security/clear
// Swift app sends this when Christopher taps "Authorize" or "All Clear"
router.post('/clear', (req, res) => {
  securityState.lockdown  = false
  securityState.reason    = ''
  securityState.timestamp = null
  console.log('[JARVIS SECURITY] Cleared from Swift app')
  res.json({ ok: true })
})

// GET /api/jarvis/security/alerts
// Full alert history
router.get('/alerts', (req, res) => {
  res.json({ alerts: securityState.alerts })
})

module.exports = router
