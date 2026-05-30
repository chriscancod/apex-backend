require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const OpenAI     = require('openai');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY not set');
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 2 });

const APP_SECRET = process.env.APP_SECRET || null;
function requireAuth(req, res, next) {
  if (!APP_SECRET) return next();
  const secret = req.headers['x-app-secret'];
  if (!secret || secret !== APP_SECRET) return res.status(401).json({ error: 'Unauthorized.' });
  next();
}

const globalLimiter = rateLimit({ windowMs: 15*60*1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
const aiLimiter     = rateLimit({ windowMs: 15*60*1000, max: 30,  standardHeaders: true, legacyHeaders: false, message: { error: 'AI limit reached. Try again soon.' } });
app.use(globalLimiter);

const FAST  = 'gpt-4.1-mini';
const SMART = 'gpt-4.1-mini';

async function ask(system, user, json = false, maxTokens = 800, model = FAST) {
  const res = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    response_format: json ? { type: 'json_object' } : undefined,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return res.choices[0].message.content;
}

function str(val, fallback = '')      { return typeof val !== 'string' ? fallback : val.trim().slice(0, 2000); }
function strShort(val, fallback = '') { return typeof val !== 'string' ? fallback : val.trim().slice(0, 200); }
function safeArray(val, limit = 20)   { return !Array.isArray(val) ? [] : val.slice(0, limit).map(i => String(i).trim().slice(0, 200)); }
function log(route, status, ms, extra = '') { console.log(`[${new Date().toISOString()}] ${route} ${status} ${ms}ms ${extra}`); }

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({
  status: 'NIGHT_INC_ONLINE', version: '3.1.0',
  apps: ['APX','INDEX','NEXUS','KINETIC','AURA','DECK','WARDROBE'],
}));

// ══════════════════════════════════════════════════════════════════════════════
// APX — POST /schedule
// ══════════════════════════════════════════════════════════════════════════════
app.post('/schedule', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const username    = strShort(req.body.username,    'OPERATOR');
    const tasks       = safeArray(req.body.tasks, 12);
    const wakeTime    = strShort(req.body.wakeTime,    '6:30 AM');
    const sleepTime   = strShort(req.body.sleepTime,   '10:30 PM');
    const notes       = strShort(req.body.notes,       '');
    const date        = strShort(req.body.date,        '');
    const currentTime = strShort(req.body.currentTime, '');
    const currentDay  = strShort(req.body.currentDay,  '');
    const profileAge          = strShort(req.body.profileAge,          '');
    const profileSchool       = strShort(req.body.profileSchool,       '');
    const profileSports       = strShort(req.body.profileSports,       '');
    const profilePracticeDays = strShort(req.body.profilePracticeDays, '');
    const profilePracticeTime = strShort(req.body.profilePracticeTime, '');
    const profileBusiness     = strShort(req.body.profileBusiness,     '');
    const profileGoals        = strShort(req.body.profileGoals,        '');
    const profileOther        = strShort(req.body.profileOther,        '');
    const profileSchedule     = str(req.body.profileSchedule, '');
    const profileContext      = str(req.body.profileContext,   '');

    const taskList = tasks.length ? tasks.map((t,i) => `${i+1}. ${t}`).join('\n') : 'General high-performance day.';
    const constraints = [];
    if (profileSchedule) constraints.push(`BATMAN PROTOCOL / FIXED SCHEDULE (use exact times for ${currentDay}):\n${profileSchedule}`);
    else if (profileContext) constraints.push(`PROFILE & SCHEDULE:\n${profileContext}`);
    if (profilePracticeDays && profilePracticeTime) constraints.push(`PRACTICE: ${profilePracticeDays} at ${profilePracticeTime} — NON-NEGOTIABLE`);
    const fixedBlock = constraints.length ? `⚠️ FIXED CONSTRAINTS — respect exactly:\n${constraints.join('\n\n')}\n` : '';
    const personalLines = [
      profileAge && `Age: ${profileAge}`, profileSchool && `School: ${profileSchool}`,
      profileSports && `Sports: ${profileSports}`, profileBusiness && `Business: ${profileBusiness}`,
      profileGoals && `Goals: ${profileGoals}`, profileOther && `Other: ${profileOther}`,
    ].filter(Boolean).join(' | ');

    const out = await ask(
      `You are APEX AI — an elite daily scheduler for high-performance people of any age, background, or lifestyle.\n\nYour job: read the user's profile, fixed schedule, and tasks — then build the best possible day around their real life.\n\nHOW TO READ THE CONTEXT:\n• If a fixed schedule is provided (class times, work shifts, practice, church, recurring commitments) — treat those as NON-NEGOTIABLE. Build everything else around them.\n• If sports or training is listed — include a workout block with specifics matching their sport/fitness level.\n• If a business or project is listed — include focused work blocks for it.\n• If a sleep time is set — that is the hard stop. Nothing after it.\n• If goals are listed — every day should move toward at least one of them.\n• Respect the user's actual life. A student has school. An athlete has practice. A founder has brand work. Read what they gave you and use it.\n\nRULES:\n1. Fixed commitments are sacred — never schedule over them\n2. Fill EVERY hour from wake to sleep — zero gaps, zero truncation\n3. Activities must be SPECIFIC — exact exercises/sets/reps, exact tasks, exact actions. Never vague.\n4. Minimum 8 blocks, as many as needed to cover the full day\n5. Return ONLY valid JSON — complete every block, never stop early\n\nCATEGORIES: ops, fitness, study, biz, church, rest`,
      `OPERATOR: ${username}\nDATE: ${date} ${currentDay} | NOW: ${currentTime}\nWAKE: ${wakeTime} → SLEEP: ${sleepTime}\n${personalLines ? `ABOUT: ${personalLines}` : ''}\n\n${fixedBlock}\nNOTES: ${notes || 'none'}\n\nTASKS TO FIT IN TODAY:\n${taskList}\n\nJSON (cover every hour ${wakeTime}→${sleepTime}, min 8 blocks):\n{"success":true,"data":{"summary":"<one punchy sentence>","totalXP":<sum>,"blocks":[{"time":"<h:mm AM/PM>","duration":"<X min>","activity":"<SPECIFIC>","category":"<ops|fitness|study|biz|church|rest>","xp":<50-300>}]}}`,
      true, 2500, SMART
    );
    let parsed;
    try { parsed = JSON.parse(out); } catch { return res.status(502).json({ success: false, data: null, error: 'AI returned invalid response.' }); }
    log('/schedule', 200, Date.now()-t0, `blocks=${parsed?.data?.blocks?.length ?? 0}`);
    res.json(parsed);
  } catch (e) {
    log('/schedule', 500, Date.now()-t0, e.message);
    res.status(500).json({ success: false, data: null, error: 'Schedule generation failed.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// APX — Finance
// ══════════════════════════════════════════════════════════════════════════════
app.post('/apx/finance/split', requireAuth, (req, res) => {
  const amt = parseFloat(req.body.income);
  if (isNaN(amt) || amt < 0 || amt > 1_000_000) return res.status(400).json({ error: 'Invalid income value.' });
  res.json({ total: amt, split: { reinvestment: +(amt*0.80).toFixed(2), investing: +(amt*0.08).toFixed(2), savings: +(amt*0.07).toFixed(2), tools: +(amt*0.03).toFixed(2), personal: +(amt*0.02).toFixed(2) } });
});

app.post('/apx/finance/advice', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const message = strShort(req.body.message, '');
    const entries = safeArray(req.body.entries, 10).map(e => (typeof e === 'object' ? `${e.type}: $${e.amount} (${e.label})` : String(e)));
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    const reply = await ask('APX finance advisor for a teen entrepreneur. Direct, specific, real numbers. Max 120 words.', `Log:\n${entries.join('\n') || 'none'}\nQuestion: ${message}`, false, 400, FAST);
    log('/apx/finance/advice', 200, Date.now()-t0);
    res.json({ advice: reply });
  } catch (e) {
    log('/apx/finance/advice', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Finance advice unavailable.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// INDEX — Curriculum
// ══════════════════════════════════════════════════════════════════════════════
app.post('/ai/curriculum/build', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const topic = strShort(req.body.topic, 'Programming');
    const depth = strShort(req.body.depth, 'beginner');
    const style = strShort(req.body.style, 'practical');
    const count = Math.min(Math.max(parseInt(req.body.lesson_count) || 5, 1), 10);
    if (!topic) return res.status(400).json({ error: 'Topic is required.' });
    const validDepths = ['beginner','intermediate','advanced'];
    const validStyles = ['practical','theoretical','project'];
    const safeDepth = validDepths.includes(depth) ? depth : 'beginner';
    const safeStyle = validStyles.includes(style) ? style : 'practical';
    const styleGuide = safeStyle==='practical' ? 'Lead with real working code/examples.' : safeStyle==='theoretical' ? 'Build intuition first with sharp analogies.' : 'Every lesson = one concrete step toward a finished project.';
    const depthGuide = safeDepth==='beginner' ? 'Zero prior knowledge assumed.' : safeDepth==='intermediate' ? 'Basics assumed. Go deep on mechanics.' : 'Strong foundation assumed. Advanced patterns.';
    const out = await ask(
      `You are INDEX — an elite curriculum builder. ${styleGuide} ${depthGuide}\nReturn ONLY valid JSON — no markdown fences, completely parseable. Complete all lessons fully.`,
      `Build a ${count}-lesson curriculum on: "${topic}"\n\nJSON:\n{"curriculum":{"id":"curriculum-1","topic":"${topic}","tagline":"<what student will DO>","total_xp":<sum>,"earned_xp":0,"lessons":[{"id":"lesson-1","title":"<title>","emoji":"<emoji>","summary":"<one sentence>","content":"<markdown 200-350 words>","key_points":["<insight>","<insight>","<insight>"],"xp":<100-200>,"completed":false,"quiz_passed":false,"quiz":[{"id":"q-1-1","question":"<question>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},{"id":"q-1-2","question":"<question>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},{"id":"q-1-3","question":"<question>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null}]}]}}\n\nRULES: exactly ${count} lessons, exactly 3 quiz questions each. Do NOT truncate.`,
      true, 6000, SMART
    );
    let parsed;
    try { parsed = JSON.parse(out); } catch { return res.status(502).json({ error: 'AI returned invalid curriculum.' }); }
    log('/ai/curriculum/build', 200, Date.now()-t0, `lessons=${parsed?.curriculum?.lessons?.length ?? 0}`);
    res.json(parsed);
  } catch (e) {
    log('/ai/curriculum/build', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Curriculum build failed.' });
  }
});

app.post('/ai/curriculum/chat', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const message        = strShort(req.body.message, '');
    const lesson_context = str(req.body.lesson_context, '').slice(0, 600);
    const topic          = strShort(req.body.topic, '');
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    const reply = await ask(`You are INDEX AI — a sharp, direct tutor for "${topic}".\nLesson context: ${lesson_context}\nBe clear and specific. Max 150 words. Never cut off mid-sentence.`, message, false, 600, FAST);
    log('/ai/curriculum/chat', 200, Date.now()-t0);
    res.json({ reply });
  } catch (e) {
    log('/ai/curriculum/chat', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Tutor unavailable.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// NEXUS — POST /api/chat
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/chat', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const system   = str(req.body.system, '').slice(0, 800);
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'Messages array is required.' });
    const history = messages.slice(-6).filter(m => m && typeof m.role==='string' && typeof m.content==='string').map(m => ({ role: ['user','assistant','system'].includes(m.role)?m.role:'user', content: String(m.content).slice(0,1000) }));
    if (!history.length) return res.status(400).json({ error: 'No valid messages provided.' });
    const completion = await openai.chat.completions.create({ model: FAST, max_tokens: 800, messages: [{ role: 'system', content: system+'\n\nAlways complete your full response. Never cut off mid-sentence.' }, ...history] });
    log('/api/chat', 200, Date.now()-t0);
    res.json({ reply: completion.choices[0].message.content });
  } catch (e) {
    log('/api/chat', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'AI unavailable.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// WARDROBE — POST /api/outfits
// Smart randomizer picks pieces. AI only writes the description.
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/outfits', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const items          = Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : [];
    const occasion       = strShort(req.body.occasion, 'casual');
    const weather        = strShort(req.body.weather,  'mild');
    const notes          = strShort(req.body.notes,    '').toLowerCase();
    const previousCombos = Array.isArray(req.body.previousCombos) ? req.body.previousCombos.slice(0, 50) : [];

    if (items.length < 2) return res.status(400).json({ error: 'Add at least 2 items to your closet.' });

    // ── Categorise items ──────────────────────────────────────────────────────
    const byRole = { top: [], bottom: [], shoes: [], layer: [] };
    const TOP_TYPES    = ['tee','hoodie','shirt','top','crewneck','longsleeve','tank','jersey','sweater','sweatshirt'];
    const BOTTOM_TYPES = ['pants','jeans','shorts','sweats','cargo','trousers','joggers','skirt','chinos','denim'];
    const SHOE_TYPES   = ['footwear','shoes','sneakers','boots','slides','sandals','jordan','nike','adidas','new balance','air force','dunks','yeezy','loafer','runner'];
    const LAYER_TYPES  = ['jacket','coat','zip','vest','blazer','windbreaker','puffer','fleece'];
    // Accessories (watch, chain, hat, bag) are separate — never counted as core pieces
    const ACCESSORY_TYPES = ['accessory','watch','chain','ring','bracelet','necklace','hat','cap','beanie','bag','backpack','tote'];

    function getName(it)  { return typeof it==='object' ? (it.name||'item') : String(it); }
    function getColor(it) { return typeof it==='object' ? (it.color||'grey') : 'grey'; }
    function getType(it)  { return typeof it==='object' ? (it.type||'') : ''; }

    for (const it of items) {
      const type     = getType(it).toLowerCase();
      const name     = getName(it).toLowerCase();
      const combined = `${type} ${name}`;

      // Skip accessories entirely from core outfit building
      if (ACCESSORY_TYPES.some(k => combined.includes(k))) continue;

      if      (SHOE_TYPES  .some(k => combined.includes(k))) byRole.shoes .push(it);
      else if (BOTTOM_TYPES.some(k => combined.includes(k))) byRole.bottom.push(it);
      else if (LAYER_TYPES .some(k => combined.includes(k))) byRole.layer .push(it);
      else if (TOP_TYPES   .some(k => combined.includes(k))) byRole.top   .push(it);
      else byRole.top.push(it); // unknown → treat as top
    }

    if (!byRole.top.length)    return res.status(400).json({ error: 'No tops found. Add a tee, hoodie, or shirt.' });
    if (!byRole.bottom.length) return res.status(400).json({ error: 'No bottoms found. Add pants or jeans.' });
    if (!byRole.shoes.length)  return res.status(400).json({ error: 'No shoes found. Add sneakers or boots.' });

    // ── Ban logic — scale overlap threshold to closet size ────────────────────
    // Small closet (≤8 tops+bottoms+shoes) → ban on ANY 1 shared piece
    // Large closet (>8) → ban on 2+ shared pieces
    const coreCount = byRole.top.length + byRole.bottom.length + byRole.shoes.length;
    const banThreshold = coreCount <= 8 ? 1 : 2;

    const bannedSets = previousCombos.map(c =>
      new Set((Array.isArray(c) ? c : [c]).map(n => n.toLowerCase().trim()))
    );

    function isBanned(pieces) {
      const nameSet = new Set(pieces.map(p => getName(p).toLowerCase().trim()));
      return bannedSets.some(banned => {
        let overlap = 0;
        for (const n of banned) { if (nameSet.has(n)) overlap++; }
        return overlap >= banThreshold;
      });
    }

    // Fisher-Yates shuffle
    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length-1; i > 0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [a[i],a[j]] = [a[j],a[i]];
      }
      return a;
    }

    // Color harmony score
    function hexToRgb(color) {
      const nameMap = { black:'#111111',white:'#f5f5f0',grey:'#888888',gray:'#888888',navy:'#1b2a4a',blue:'#2563eb',red:'#dc2626',green:'#16a34a',brown:'#92400e',beige:'#d4c5a9',cream:'#fef3c7',orange:'#ea580c',purple:'#7c3aed',pink:'#f472b6',yellow:'#eab308',olive:'#4d7c0f',tan:'#d97706',camel:'#b45309',rust:'#b45309',burgundy:'#7f1d1d',charcoal:'#374151',slate:'#64748b',khaki:'#bdb76b',stone:'#a8a29e','off white':'#f0ede8','light grey':'#cccccc','dark grey':'#444444' };
      let hex = color.toLowerCase().startsWith('#') ? color : (nameMap[color.toLowerCase()] || '#888888');
      hex = hex.replace('#','');
      if (hex.length===3) hex = hex.split('').map(c=>c+c).join('');
      const n = parseInt(hex,16);
      return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
    }
    function harmonyScore(pieces) {
      if (pieces.length < 2) return 70;
      const rgbs = pieces.map(p => hexToRgb(getColor(p)));
      let total=0, pairs=0;
      for (let i=0;i<rgbs.length;i++) for (let j=i+1;j<rgbs.length;j++) {
        const d = Math.sqrt((rgbs[i].r-rgbs[j].r)**2+(rgbs[i].g-rgbs[j].g)**2+(rgbs[i].b-rgbs[j].b)**2)/441.7;
        total += d<0.15 ? 95 : d>0.55 ? 88 : Math.max(30, 85-d*100);
        pairs++;
      }
      return Math.round(total/pairs);
    }

    // Notes filter
    function passesNoteFilter(pieces) {
      if (!notes) return true;
      const text = pieces.map(p=>`${getName(p)} ${getColor(p)}`).join(' ').toLowerCase();
      const noMatch = notes.match(/no\s+(\w+)/g);
      if (noMatch) for (const m of noMatch) { if (text.includes(m.replace('no ',''))) return false; }
      if (notes.includes('all black')||notes.includes('dark')) {
        if (['white','cream','beige','yellow','pink','light'].some(c=>text.includes(c))) return false;
      }
      return true;
    }

    // ── Pick best non-banned combo in up to 60 attempts ───────────────────────
    let best = null, bestScore = -1;

    for (let attempt=0; attempt<60; attempt++) {
      const top    = shuffle(byRole.top)[0];
      const bottom = shuffle(byRole.bottom)[0];
      const shoes  = shuffle(byRole.shoes)[0];
      // Layer: only 25% of the time to avoid always including the same jacket
      const layer  = byRole.layer.length && Math.random() > 0.75 ? shuffle(byRole.layer)[0] : null;

      const pieces = [top, bottom, shoes, layer].filter(Boolean);
      if (isBanned(pieces)) continue;
      if (!passesNoteFilter(pieces)) continue;

      const score = harmonyScore(pieces);
      if (score > bestScore) {
        bestScore = score;
        best = pieces;
        if (score >= 88) break; // good enough — stop early
      }
    }

    // Exhausted closet fallback — ignore ban, pick anything
    if (!best) {
      console.log(`[WARDROBE] All combos banned (${previousCombos.length} seen) — ignoring ban`);
      const top    = shuffle(byRole.top)[0];
      const bottom = shuffle(byRole.bottom)[0];
      const shoes  = shuffle(byRole.shoes)[0];
      best = [top, bottom, shoes];
      bestScore = harmonyScore(best);
    }

    const pieceNames = best.map(getName);
    const confidence = Math.min(bestScore/100, 1.0);

    // ── AI writes description only (not picks) ────────────────────────────────
    const closetSummary = best.map(p=>`${getName(p)} (${getColor(p)}, ${getType(p)})`).join(', ');
    const description = await ask(
      `You are a fashion stylist. Given a specific outfit, write a creative name, vibe, why it works, and one wearing tip. Be specific and confident. Return ONLY valid JSON.`,
      `Occasion: ${occasion}. Weather: ${weather}.${notes ? ` User note: "${notes}".` : ''}\nOutfit: ${closetSummary}\n\nJSON:\n{"name":"<2-4 word name>","vibe":"<one sentence mood>","why_it_works":"<color/silhouette logic>","stylist_tip":"<one actionable tip>"}`,
      true, 250, FAST
    );

    let desc = { name:'CLEAN BUILD', vibe:'', why_it_works:'', stylist_tip:'' };
    try { desc = JSON.parse(description); } catch (_) {}

    log('/api/outfits', 200, Date.now()-t0, `score=${bestScore} pieces=${best.length} banned=${previousCombos.length} threshold=${banThreshold}`);
    res.json({
      outfit: {
        name:         desc.name         || 'CLEAN BUILD',
        pieces:       pieceNames,
        vibe:         desc.vibe         || '',
        why_it_works: desc.why_it_works || '',
        stylist_tip:  desc.stylist_tip  || '',
        confidence,
      },
      source: 'smart_randomizer',
    });

  } catch (e) {
    log('/api/outfits', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Outfit generation failed. Please try again.' });
  }
});

// ─── 404 & error handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err.message);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Night.inc backend → port ${PORT}`);
  console.log(`Auth: ${APP_SECRET ? 'ENABLED' : 'DISABLED'}`);
});
