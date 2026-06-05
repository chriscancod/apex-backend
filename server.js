require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const OpenAI     = require('openai');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');

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
const JWT_SECRET = process.env.JWT_SECRET || 'grind_night_inc_2026';

function requireAuth(req, res, next) {
  if (!APP_SECRET) return next();
  const secret = req.headers['x-app-secret'];
  if (!secret || secret !== APP_SECRET) return res.status(401).json({ error: 'Unauthorized.' });
  next();
}

const globalLimiter = rateLimit({ windowMs: 15*60*1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
const aiLimiter     = rateLimit({ windowMs: 15*60*1000, max: 30,  standardHeaders: true, legacyHeaders: false, message: { error: 'AI limit reached. Try again soon.' } });
const grindLimiter  = rateLimit({ windowMs: 15*60*1000, max: 60,  standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
app.use(globalLimiter);

const FAST  = 'gpt-4.1-mini';
const SMART = 'gpt-4.1-mini';

async function ask(system, user, json = false, maxTokens = 800, model = FAST) {
  const res = await openai.chat.completions.create({
    model, max_tokens: maxTokens,
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
  status: 'NIGHT_INC_ONLINE', version: '3.2.0',
  apps: ['APX','INDEX','NEXUS','KINETIC','AURA','DECK','WARDROBE','GRIND'],
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
    if (profileSchedule) constraints.push(`FIXED SCHEDULE (use exact times for ${currentDay}):\n${profileSchedule}`);
    else if (profileContext) constraints.push(`PROFILE & SCHEDULE:\n${profileContext}`);
    if (profilePracticeDays && profilePracticeTime) constraints.push(`PRACTICE: ${profilePracticeDays} at ${profilePracticeTime} — NON-NEGOTIABLE`);
    const fixedBlock = constraints.length ? `⚠️ FIXED CONSTRAINTS — respect exactly:\n${constraints.join('\n\n')}\n` : '';
    const personalLines = [
      profileAge && `Age: ${profileAge}`, profileSchool && `School: ${profileSchool}`,
      profileSports && `Sports: ${profileSports}`, profileBusiness && `Business: ${profileBusiness}`,
      profileGoals && `Goals: ${profileGoals}`, profileOther && `Other: ${profileOther}`,
    ].filter(Boolean).join(' | ');

    const out = await ask(
      `You are APEX AI — an elite daily scheduler for high-performance people of any age, background, or lifestyle.

Your job: read the user's profile, fixed schedule, and tasks — then build the best possible day around their real life.

HOW TO READ THE CONTEXT:
• If a fixed schedule is provided — treat those times as NON-NEGOTIABLE. Build everything else around them.
• If sports or training is listed — include a workout block with specifics matching their sport/fitness level.
• If a business or project is listed — include focused work blocks for it.
• If a sleep time is set — that is the hard stop. Nothing after it.
• Respect the user's actual life. A student has school. An athlete has practice. A founder has brand work.

RULES:
1. Fixed commitments are sacred — never schedule over them
2. Fill EVERY hour from wake to sleep — zero gaps, zero truncation
3. Activities must be SPECIFIC — exact exercises/sets/reps, exact tasks, exact actions. Never vague.
4. Minimum 8 blocks, as many as needed to cover the full day
5. Return ONLY valid JSON — complete every block, never stop early

CATEGORIES: ops, fitness, study, biz, church, rest`,
      `OPERATOR: ${username}
DATE: ${date} ${currentDay} | NOW: ${currentTime}
WAKE: ${wakeTime} → SLEEP: ${sleepTime}
${personalLines ? `ABOUT: ${personalLines}` : ''}

${fixedBlock}
NOTES: ${notes || 'none'}

TASKS TO FIT IN TODAY:
${taskList}

JSON (cover every hour ${wakeTime}→${sleepTime}, min 8 blocks):
{"success":true,"data":{"summary":"<one punchy sentence>","totalXP":<sum>,"blocks":[{"time":"<h:mm AM/PM>","duration":"<X min>","activity":"<SPECIFIC>","category":"<ops|fitness|study|biz|church|rest>","xp":<50-300>}]}}`,
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
    const topic   = strShort(req.body.topic,  'Programming');
    const depth   = strShort(req.body.depth,  'beginner');
    const style   = strShort(req.body.style,  'practical');
    const count   = Math.min(Math.max(parseInt(req.body.lesson_count) || 10, 1), 10);

    if (!topic) return res.status(400).json({ error: 'Topic is required.' });

    const safeDepth = ['beginner','intermediate','advanced'].includes(depth) ? depth : 'beginner';
    const safeStyle = ['practical','theoretical','project'].includes(style) ? style : 'practical';

    const depthGuide = {
      beginner:     'Zero prior knowledge assumed. Plain language, everyday analogies.',
      intermediate: 'Basics assumed. Focus on mechanics, patterns, and edge cases.',
      advanced:     'Strong foundation assumed. Production thinking, internals, performance.',
    }[safeDepth];

    const styleGuide = {
      practical:   'Emphasize working code and hands-on examples.',
      theoretical: 'Build intuition first, then formalize concepts.',
      project:     'Each unit is one concrete step toward a finished project.',
    }[safeStyle];

    const out = await ask(
      `You are INDEX — an elite curriculum builder. ${depthGuide} ${styleGuide}
Write for a sharp learner who moves fast. Each unit must have ONE clear aha moment.
Return ONLY valid JSON — completely parseable, no markdown fences, never truncate.

Build a ${count}-unit course on: "${topic}"

JSON shape — COMPACT mode (no long content, just structure):
{
  "curriculum": {
    "id": "curriculum-1",
    "topic": "${topic}",
    "tagline": "<what student will DO — specific, exciting>",
    "total_xp": <sum of xp>,
    "earned_xp": 0,
    "lessons": [
      {
        "id": "lesson-1",
        "title": "<compelling title>",
        "emoji": "<single emoji>",
        "summary": "<one sentence — hint at the aha moment>",
        "content": "<2-3 sentence overview ONLY — the app will request full content separately>",
        "key_points": ["<real insight>", "<real insight>", "<real insight>"],
        "xp": <100-200>,
        "completed": false,
        "quiz_passed": false,
        "quiz": [
          {"id":"q-1-1","question":"<tests real understanding, not trivia>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},
          {"id":"q-1-2","question":"<scenario-based: You are building X and need to Y>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},
          {"id":"q-1-3","question":"<practical application or debug question>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null}
        ]
      }
    ]
  }
}

RULES:
- Exactly ${count} lessons, exactly 3 quiz questions each
- content field: 2-3 sentences MAXIMUM — just enough to preview the topic
- key_points: 3 specific, actionable insights (not generic)
- Quiz questions test understanding, not memorization
- total_xp = sum of all xp values
- Return ONLY the JSON object`,
      `Topic: "${topic}" | Depth: ${safeDepth} | Style: ${safeStyle}`,
      true, 3500, SMART
    );

    let parsed;
    try { parsed = JSON.parse(out); } catch {
      return res.status(502).json({ error: 'AI returned invalid curriculum.' });
    }

    log('/ai/curriculum/build', 200, Date.now()-t0, `lessons=${parsed?.curriculum?.lessons?.length ?? 0}`);
    res.json(parsed);
  } catch (e) {
    log('/ai/curriculum/build', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Curriculum build failed.' });
  }
});

// ── Expand a single unit's learn cards (called lazily when user opens a unit)
app.post('/ai/curriculum/expand', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const topic       = strShort(req.body.topic,        'Programming');
    const unitTitle   = strShort(req.body.unit_title,   '');
    const unitSummary = strShort(req.body.unit_summary,  '');
    const depth       = strShort(req.body.depth,        'beginner');
    const style       = strShort(req.body.style,        'practical');

    if (!unitTitle) return res.status(400).json({ error: 'unit_title is required.' });

    const out = await ask(
      `You are INDEX — an elite educator. Generate rich interactive learn cards for one unit of a course.
Each card is shown to the learner BEFORE they take the quiz. Cards must build understanding progressively.
Return ONLY valid JSON — no markdown fences, completely parseable.

Card types:
- concept: title + clear explanation (plain prose, 3-5 sentences)
- keyFact: title + bullet list (format body as "• point1\n• point2\n• point3")
- code: title + explanation + actual runnable code block
- analogy: title + real-world comparison that makes the concept click
- visual: title + explanation + visual_emojis array showing a flow or process

Generate 4-6 learn cards for:
Topic: "${topic}"
Unit: "${unitTitle}"
Summary: "${unitSummary}"
Depth: ${depth} | Style: ${style}

JSON:
{
  "learn_cards": [
    {
      "id": "card-1",
      "type": "concept|keyFact|code|analogy|visual",
      "title": "<card title>",
      "body": "<explanation text>",
      "code": "<actual code if type=code, else omit>",
      "code_language": "<language if type=code, else omit>",
      "visual_emojis": ["<emoji>","<emoji>","<emoji>"]
    }
  ]
}

RULES:
- 4-6 cards minimum
- If style=practical or topic involves code: include at least 1 code card with REAL runnable code
- code cards: body explains what the code does, code field has actual code (15-40 lines)
- analogy card: real-world comparison must be genuinely memorable and accurate
- keyFact card: body must be "• point\n• point\n• point" format, 3-5 points
- visual card: visual_emojis shows a process flow (3-5 emojis with logical sequence)
- Build progressive understanding: start simple, get deeper
- Each card must earn its place — no filler`,
      `Expand unit "${unitTitle}" for topic "${topic}"`,
      true, 2000, SMART
    );

    let parsed;
    try { parsed = JSON.parse(out); } catch {
      return res.status(502).json({ error: 'AI returned invalid learn cards.' });
    }

    log('/ai/curriculum/expand', 200, Date.now()-t0, `cards=${parsed?.learn_cards?.length ?? 0}`);
    res.json(parsed);
  } catch (e) {
    log('/ai/curriculum/expand', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Unit expansion failed.' });
  }
});

// ── Lesson chat
app.post('/ai/curriculum/chat', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const message        = strShort(req.body.message,        '');
    const lesson_context = str(req.body.lesson_context, '').slice(0, 600);
    const topic          = strShort(req.body.topic,          '');
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const reply = await ask(
      `You are INDEX AI — a sharp, direct tutor for "${topic}".
Lesson context: ${lesson_context}

Rules:
- Be specific and concrete. Never vague.
- Pattern: Explain → Example → Apply (how they'd use it in a real project).
- If asked for resources: name SPECIFIC ones (exact book titles, exact URLs, exact course names).
- Max 150 words. Never cut off mid-sentence.
- No filler phrases like "great question!".`,
      message, false, 600, FAST
    );

    log('/ai/curriculum/chat', 200, Date.now()-t0);
    res.json({ reply });
  } catch (e) {
    log('/ai/curriculum/chat', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Tutor unavailable.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// NEXUS + KINETIC + AURA + DECK — POST /api/chat
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/chat', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const system   = str(req.body.system, '').slice(0, 800);
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'Messages array is required.' });
    const history = messages.slice(-6)
      .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
      .map(m => ({ role: ['user','assistant','system'].includes(m.role) ? m.role : 'user', content: String(m.content).slice(0, 1000) }));
    if (!history.length) return res.status(400).json({ error: 'No valid messages provided.' });
    const completion = await openai.chat.completions.create({
      model: FAST, max_tokens: 800,
      messages: [{ role: 'system', content: system + '\n\nAlways complete your full response. Never cut off mid-sentence.' }, ...history],
    });
    log('/api/chat', 200, Date.now()-t0);
    res.json({ reply: completion.choices[0].message.content });
  } catch (e) {
    log('/api/chat', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'AI unavailable.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// WARDROBE — POST /api/outfits
// Smart randomizer — picks pieces by role + color harmony, AI writes description only
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

    const byRole = { top: [], bottom: [], shoes: [], layer: [] };
    const TOP_TYPES    = ['tee','hoodie','shirt','top','crewneck','longsleeve','tank','jersey','sweater','sweatshirt'];
    const BOTTOM_TYPES = ['pants','jeans','shorts','sweats','cargo','trousers','joggers','skirt','chinos','denim'];
    const SHOE_TYPES   = ['footwear','shoes','sneakers','boots','slides','sandals','jordan','nike','adidas','air force','dunks','yeezy','loafer','runner'];
    const LAYER_TYPES  = ['jacket','coat','zip','vest','blazer','windbreaker','puffer','fleece'];

    function getName(it)  { return typeof it === 'object' ? (it.name  || 'item') : String(it); }
    function getColor(it) { return typeof it === 'object' ? (it.color || 'grey') : 'grey'; }
    function getType(it)  { return typeof it === 'object' ? (it.type  || '')     : ''; }

    for (const it of items) {
      const type     = getType(it).toLowerCase();
      const name     = getName(it).toLowerCase();
      const combined = `${type} ${name}`;
      if      (SHOE_TYPES  .some(k => combined.includes(k))) byRole.shoes .push(it);
      else if (BOTTOM_TYPES.some(k => combined.includes(k))) byRole.bottom.push(it);
      else if (LAYER_TYPES .some(k => combined.includes(k))) byRole.layer .push(it);
      else                                                    byRole.top   .push(it);
    }

    if (!byRole.top.length)    return res.status(400).json({ error: 'No tops found. Add a tee, hoodie, or shirt.' });
    if (!byRole.bottom.length) return res.status(400).json({ error: 'No bottoms found. Add pants or jeans.' });
    if (!byRole.shoes.length)  return res.status(400).json({ error: 'No shoes found. Add sneakers or boots.' });

    const coreCount    = byRole.top.length + byRole.bottom.length + byRole.shoes.length;
    const banThreshold = coreCount <= 6 ? 1 : 2;
    const bannedSets   = previousCombos.map(c => new Set((Array.isArray(c) ? c : [c]).map(n => n.toLowerCase().trim())));

    function isBanned(pieces) {
      const nameSet = new Set(pieces.map(p => getName(p).toLowerCase().trim()));
      return bannedSets.some(banned => { let o = 0; for (const n of banned) { if (nameSet.has(n)) o++; } return o >= banThreshold; });
    }
    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    }
    function hexToRgb(color) {
      const nameMap = { black:'#111111',white:'#f5f5f0',grey:'#888888',gray:'#888888',navy:'#1b2a4a',blue:'#2563eb',red:'#dc2626',green:'#16a34a',brown:'#92400e',beige:'#d4c5a9',cream:'#fef3c7',orange:'#ea580c',purple:'#7c3aed',pink:'#f472b6',yellow:'#eab308',olive:'#4d7c0f',tan:'#d97706',camel:'#b45309',rust:'#b45309',burgundy:'#7f1d1d',charcoal:'#374151',slate:'#64748b',khaki:'#bdb76b',stone:'#a8a29e' };
      let hex = color.toLowerCase().startsWith('#') ? color : (nameMap[color.toLowerCase()] || '#888888');
      hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
      const n = parseInt(hex, 16); return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
    }
    function harmonyScore(pieces) {
      if (pieces.length < 2) return 70;
      const rgbs = pieces.map(p => hexToRgb(getColor(p))); let total = 0, pairs = 0;
      for (let i = 0; i < rgbs.length; i++) for (let j = i+1; j < rgbs.length; j++) {
        const d = Math.sqrt((rgbs[i].r-rgbs[j].r)**2+(rgbs[i].g-rgbs[j].g)**2+(rgbs[i].b-rgbs[j].b)**2)/441.7;
        total += d < 0.15 ? 95 : d > 0.55 ? 88 : Math.max(30, 85 - d*100); pairs++;
      }
      return Math.round(total / pairs);
    }
    function passesNoteFilter(pieces) {
      if (!notes) return true;
      const text = pieces.map(p => `${getName(p)} ${getColor(p)}`).join(' ').toLowerCase();
      const noMatch = notes.match(/no\s+(\w+)/g);
      if (noMatch) for (const m of noMatch) { if (text.includes(m.replace('no ', ''))) return false; }
      if (notes.includes('all black') || notes.includes('dark')) {
        if (['white','cream','beige','yellow','pink','light'].some(c => text.includes(c))) return false;
      }
      return true;
    }

    let best = null, bestScore = -1;
    for (let attempt = 0; attempt < 60; attempt++) {
      const top    = shuffle(byRole.top)[0];
      const bottom = shuffle(byRole.bottom)[0];
      const shoes  = shuffle(byRole.shoes)[0];
      const layer  = byRole.layer.length && Math.random() > 0.75 ? shuffle(byRole.layer)[0] : null;
      const pieces = [top, bottom, shoes, layer].filter(Boolean);
      if (isBanned(pieces) || !passesNoteFilter(pieces)) continue;
      const score = harmonyScore(pieces);
      if (score > bestScore) { bestScore = score; best = pieces; if (score >= 88) break; }
    }
    if (!best) {
      const top = shuffle(byRole.top)[0], bottom = shuffle(byRole.bottom)[0], shoes = shuffle(byRole.shoes)[0];
      best = [top, bottom, shoes]; bestScore = harmonyScore(best);
    }

    const pieceNames    = best.map(getName);
    const confidence    = Math.min(bestScore / 100, 1.0);
    const closetSummary = best.map(p => `${getName(p)} (${getColor(p)}, ${getType(p)})`).join(', ');

    const description = await ask(
      `You are a fashion stylist. Given a specific outfit, write a creative name, vibe, why it works, and one wearing tip. Be specific and confident. Return ONLY valid JSON.`,
      `Occasion: ${occasion}. Weather: ${weather}.${notes ? ` User note: "${notes}".` : ''}
Outfit: ${closetSummary}

JSON:
{"name":"<2-4 word creative name>","vibe":"<one sentence mood>","why_it_works":"<color/silhouette logic>","stylist_tip":"<one actionable tip>"}`,
      true, 250, FAST
    );
    let desc = { name: 'CLEAN BUILD', vibe: '', why_it_works: '', stylist_tip: '' };
    try { desc = JSON.parse(description); } catch (_) {}

    log('/api/outfits', 200, Date.now()-t0, `score=${bestScore} pieces=${best.length}`);
    res.json({ outfit: { name: desc.name || 'CLEAN BUILD', pieces: pieceNames, vibe: desc.vibe || '', why_it_works: desc.why_it_works || '', stylist_tip: desc.stylist_tip || '', confidence }, source: 'smart_randomizer' });
  } catch (e) {
    log('/api/outfits', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Outfit generation failed.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GRIND BROWSER — Accounts, Profiles, AI Coach
// ══════════════════════════════════════════════════════════════════════════════

const GRIND_USERS    = {};
const GRIND_PROFILES = {};

function grindAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided.' });
  try { req.grindUser = jwt.verify(auth.split(' ')[1], JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: 'Invalid or expired token.' }); }
}

app.post('/grind/account/create', grindLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const email    = strShort(req.body.email,    '').toLowerCase();
    const password = strShort(req.body.password, '');
    const name     = strShort(req.body.name,     '');
    const username = strShort(req.body.username, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (GRIND_USERS[email]) return res.status(409).json({ error: 'An account with this email already exists.' });
    const hash  = await bcrypt.hash(password, 10);
    GRIND_USERS[email] = { hash, name, username, createdAt: Date.now() };
    const token = jwt.sign({ email, name, username }, JWT_SECRET, { expiresIn: '365d' });
    log('/grind/account/create', 200, Date.now()-t0, `user=${email}`);
    res.json({ token, user: { email, name, username } });
  } catch (e) {
    log('/grind/account/create', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Account creation failed.' });
  }
});

app.post('/grind/account/login', grindLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const email    = strShort(req.body.email,    '').toLowerCase();
    const password = strShort(req.body.password, '');
    const user = GRIND_USERS[email];
    if (!user) return res.status(404).json({ error: 'No account found with this email.' });
    const ok = await bcrypt.compare(password, user.hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    const token = jwt.sign({ email, name: user.name, username: user.username }, JWT_SECRET, { expiresIn: '365d' });
    log('/grind/account/login', 200, Date.now()-t0, `user=${email}`);
    res.json({ token, user: { email, name: user.name, username: user.username } });
  } catch (e) {
    log('/grind/account/login', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/grind/profile/sync', grindAuth, grindLimiter, (req, res) => {
  const t0 = Date.now();
  try {
    const { email } = req.grindUser;
    const profile   = req.body.profile   || {};
    const bookmarks = Array.isArray(req.body.bookmarks) ? req.body.bookmarks.slice(0, 200) : [];
    const history   = Array.isArray(req.body.history)   ? req.body.history.slice(0, 100)   : [];
    const { token: _tok, ...safeProfile } = profile;
    GRIND_PROFILES[email] = { profile: safeProfile, bookmarks, history, updatedAt: Date.now() };
    log('/grind/profile/sync', 200, Date.now()-t0, `user=${email}`);
    res.json({ ok: true, synced: Date.now() });
  } catch (e) {
    log('/grind/profile/sync', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

app.get('/grind/profile/load', grindAuth, grindLimiter, (req, res) => {
  const t0 = Date.now();
  try {
    const { email } = req.grindUser;
    const data = GRIND_PROFILES[email];
    if (!data) return res.json({ profile: null, bookmarks: [], history: [] });
    log('/grind/profile/load', 200, Date.now()-t0, `user=${email}`);
    res.json(data);
  } catch (e) {
    log('/grind/profile/load', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Load failed.' });
  }
});

app.post('/grind/coach', aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const message = strShort(req.body.message, '');
    const context = strShort(req.body.context, '');
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    const reply = await ask(
      `You are a sharp, direct AI productivity coach built into GRIND Browser — a browser for builders, students, and young founders. ${context ? `User context: ${context}` : ''}
Rules: Max 2 sentences. No fluff. Be real, not motivational-poster. Give actionable advice. If they're off task, call it out.`,
      message, false, 120, FAST
    );
    log('/grind/coach', 200, Date.now()-t0);
    res.json({ reply });
  } catch (e) {
    log('/grind/coach', 500, Date.now()-t0, e.message);
    res.status(500).json({ error: 'Coach unavailable.' });
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
