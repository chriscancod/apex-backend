require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const OpenAI     = require('openai');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*', // tighten to your app bundle ID in v2
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '50kb' })); // hard cap — no giant payloads
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// ─── OpenAI ───────────────────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY not set');
  process.exit(1);
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 45000, // 45s max — don't let OpenAI hang forever
  maxRetries: 2,
});

// ─── Optional API key auth ────────────────────────────────────────────────────
// Set APP_SECRET in Railway env vars. Apps send it as x-app-secret header.
// If not set, auth is skipped (dev mode). Set it before going live.
const APP_SECRET = process.env.APP_SECRET || null;

function requireAuth(req, res, next) {
  if (!APP_SECRET) return next(); // dev mode — no secret set
  const secret = req.headers['x-app-secret'];
  if (!secret || secret !== APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Global: 200 requests per IP per 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// AI routes: tighter — 30 per IP per 15 minutes
// Prevents one user from draining your OpenAI balance
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit reached. Try again in a few minutes.' },
});

app.use(globalLimiter);

// ─── Models ───────────────────────────────────────────────────────────────────
const FAST  = 'gpt-4.1-mini'; // chat, quick replies, outfits
const SMART = 'gpt-4.1-mini'; // schedules, curriculum — higher token ceiling

// ─── Core AI call ─────────────────────────────────────────────────────────────
async function ask(system, user, json = false, maxTokens = 800, model = FAST) {
  const res = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    response_format: json ? { type: 'json_object' } : undefined,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
  });
  return res.choices[0].message.content;
}

// ─── Input helpers ────────────────────────────────────────────────────────────
function str(val, fallback = '') {
  if (typeof val !== 'string') return fallback;
  return val.trim().slice(0, 2000); // hard cap per field
}
function strShort(val, fallback = '') {
  if (typeof val !== 'string') return fallback;
  return val.trim().slice(0, 200);
}
function safeArray(val, limit = 20) {
  if (!Array.isArray(val)) return [];
  return val.slice(0, limit).map(i => String(i).trim().slice(0, 200));
}

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(route, status, ms, extra = '') {
  console.log(`[${new Date().toISOString()}] ${route} ${status} ${ms}ms ${extra}`);
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({
  status: 'NIGHT_INC_ONLINE',
  version: '3.0.0',
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

    // Profile — accept structured fields or full protocol blob (no slicing)
    const profileAge          = strShort(req.body.profileAge,          '');
    const profileSchool       = strShort(req.body.profileSchool,       '');
    const profileSports       = strShort(req.body.profileSports,       '');
    const profilePracticeDays = strShort(req.body.profilePracticeDays, '');
    const profilePracticeTime = strShort(req.body.profilePracticeTime, '');
    const profileBusiness     = strShort(req.body.profileBusiness,     '');
    const profileGoals        = strShort(req.body.profileGoals,        '');
    const profileOther        = strShort(req.body.profileOther,        '');
    const profileSchedule     = str(req.body.profileSchedule,          ''); // full protocol — no cap
    const profileContext      = str(req.body.profileContext,           ''); // fallback blob

    const taskList = tasks.length
      ? tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : 'General high-performance day.';

    // Build constraints block
    const constraints = [];
    if (profileSchedule)
      constraints.push(`BATMAN PROTOCOL / FIXED SCHEDULE (use exact times for ${currentDay}):\n${profileSchedule}`);
    else if (profileContext)
      constraints.push(`PROFILE & SCHEDULE:\n${profileContext}`);

    if (profilePracticeDays && profilePracticeTime)
      constraints.push(`PRACTICE: ${profilePracticeDays} at ${profilePracticeTime} — NON-NEGOTIABLE`);

    const fixedBlock = constraints.length
      ? `⚠️ FIXED CONSTRAINTS — respect exactly:\n${constraints.join('\n\n')}\n`
      : '';

    const personalLines = [
      profileAge      && `Age: ${profileAge}`,
      profileSchool   && `School: ${profileSchool}`,
      profileSports   && `Sports: ${profileSports}`,
      profileBusiness && `Business: ${profileBusiness}`,
      profileGoals    && `Goals: ${profileGoals}`,
      profileOther    && `Other: ${profileOther}`,
    ].filter(Boolean).join(' | ');

    const out = await ask(
      `You are APEX AI — an elite daily scheduler for high-performance people of any age, background, or lifestyle.

Your job: read the user's profile, fixed schedule, and tasks — then build the best possible day around their real life.

HOW TO READ THE CONTEXT:
• If a fixed schedule is provided (class times, work shifts, practice, church, recurring commitments) — treat those as NON-NEGOTIABLE. Build everything else around them.
• If sports or training is listed — include a workout block with specifics matching their sport/fitness level.
• If a business or project is listed — include focused work blocks for it.
• If a sleep time is set — that is the hard stop. Nothing after it.
• If goals are listed — every day should move toward at least one of them.
• Respect the user's actual life. A student has school. An athlete has practice. A founder has brand work. Read what they gave you and use it.

RULES:
1. Fixed commitments are sacred — never schedule over them
2. Fill EVERY hour from wake to sleep — zero gaps, zero truncation
3. Activities must be SPECIFIC — exact exercises/sets/reps, exact tasks, exact actions. Never vague.
4. Minimum 8 blocks, as many as needed to cover the full day
5. Return ONLY valid JSON — complete every block, never stop early

CATEGORIES: ops, fitness, study, biz, church, rest

ACTIVITY SPECIFICITY — always this level of detail:
• fitness → match their sport/training. E.g. "Squats 4×12, Romanian deadlifts 3×10, Calf raises 3×20, Core: Plank 3×45s"
• study   → exact subject and task. E.g. "AP Chemistry Ch.8 — read pp.201-218, complete practice problems 8.1-8.12"
• biz     → exact actions. E.g. "Write 3 product descriptions, respond to 5 customer DMs, schedule 2 social posts"
• ops     → exact prep. E.g. "Pack bag, prep meals, charge devices, lay out tomorrow's outfit"
• rest    → no screens, active recovery. E.g. "Foam roll legs/back 10min, read 20 pages, journal 3 wins"`,

      `OPERATOR: ${username}
DATE: ${date} ${currentDay} | NOW: ${currentTime}
WAKE: ${wakeTime} → SLEEP: ${sleepTime}
${personalLines ? `ABOUT: ${personalLines}` : ''}

${fixedBlock}
NOTES: ${notes || 'none'}

TASKS TO FIT IN TODAY:
${taskList}

JSON (cover every hour ${wakeTime}→${sleepTime}, min 8 blocks):
{
  "success": true,
  "data": {
    "summary": "<one punchy sentence about today's theme>",
    "totalXP": <sum of all block xp>,
    "blocks": [
      {
        "time": "<h:mm AM/PM>",
        "duration": "<X min>",
        "activity": "<SPECIFIC>",
        "category": "<ops|fitness|study|biz|church|rest>",
        "xp": <50-300>
      }
    ]
  }
}`,
      true, 2500, SMART
    );

    let parsed;
    try { parsed = JSON.parse(out); }
    catch { return res.status(502).json({ success: false, data: null, error: 'AI returned invalid response. Please try again.' }); }

    log('/schedule', 200, Date.now() - t0, `blocks=${parsed?.data?.blocks?.length ?? 0}`);
    res.json(parsed);

  } catch (e) {
    log('/schedule', 500, Date.now() - t0, e.message);
    res.status(500).json({ success: false, data: null, error: 'Schedule generation failed. Please try again.' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// APX — Finance (pure math, no AI)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/apx/finance/split', requireAuth, (req, res) => {
  const amt = parseFloat(req.body.income);
  if (isNaN(amt) || amt < 0 || amt > 1_000_000) {
    return res.status(400).json({ error: 'Invalid income value.' });
  }
  res.json({
    total: amt,
    split: {
      reinvestment: +(amt * 0.80).toFixed(2),
      investing:    +(amt * 0.08).toFixed(2),
      savings:      +(amt * 0.07).toFixed(2),
      tools:        +(amt * 0.03).toFixed(2),
      personal:     +(amt * 0.02).toFixed(2),
    },
  });
});

app.post('/apx/finance/advice', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const message = strShort(req.body.message, '');
    const entries = safeArray(req.body.entries, 10)
      .map(e => (typeof e === 'object' ? `${e.type}: $${e.amount} (${e.label})` : String(e)));

    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const reply = await ask(
      'APX finance advisor for a teen entrepreneur. Direct, specific, real numbers. Max 120 words.',
      `Log:\n${entries.join('\n') || 'none'}\nQuestion: ${message}`,
      false, 400, FAST
    );
    log('/apx/finance/advice', 200, Date.now() - t0);
    res.json({ advice: reply });
  } catch (e) {
    log('/apx/finance/advice', 500, Date.now() - t0, e.message);
    res.status(500).json({ error: 'Finance advice unavailable. Please try again.' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// INDEX — POST /ai/curriculum/build
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/build', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const topic  = strShort(req.body.topic,  'Programming');
    const depth  = strShort(req.body.depth,  'beginner');
    const style  = strShort(req.body.style,  'practical');
    const count  = Math.min(Math.max(parseInt(req.body.lesson_count) || 5, 1), 10);

    if (!topic) return res.status(400).json({ error: 'Topic is required.' });

    const validDepths = ['beginner', 'intermediate', 'advanced'];
    const validStyles = ['practical', 'theoretical', 'project'];
    const safeDepth   = validDepths.includes(depth) ? depth : 'beginner';
    const safeStyle   = validStyles.includes(style) ? style : 'practical';

    const styleGuide =
      safeStyle === 'practical'   ? 'Lead with real working code/examples. Explain every step. Show what happens when it runs.' :
      safeStyle === 'theoretical' ? 'Build intuition first with sharp analogies. Then formalize. Concepts before syntax.' :
                                    'Every lesson = one concrete step toward a finished project. Student should have something working by the end.';

    const depthGuide =
      safeDepth === 'beginner'     ? 'Zero prior knowledge assumed. Plain language. Build from scratch. No jargon without explanation.' :
      safeDepth === 'intermediate' ? 'Basics assumed. Go deep on mechanics, edge cases, and mistakes pros make.' :
                                     'Strong foundation assumed. Advanced patterns, performance, production-level thinking.';

    const out = await ask(
      `You are INDEX — an elite curriculum builder. ${styleGuide} ${depthGuide}

LESSON QUALITY STANDARDS:
• Write like a brilliant mentor to a sharp 16-year-old who learns fast
• Each lesson needs one clear "aha moment" — the insight that changes how they think
• Use real examples, real code, real analogies — never textbook filler
• content: 200-350 words of rich markdown — ## headers, bullets, code blocks
• key_points: 3 genuine insights — not restatements of the lesson title
• Quiz questions must test real understanding, not memorization
• Make it feel like the best class they ever took

Return ONLY valid JSON — no markdown fences, completely parseable. Complete all lessons fully.`,

      `Build a ${count}-lesson curriculum on: "${topic}"

JSON:
{
  "curriculum": {
    "id": "curriculum-1",
    "topic": "${topic}",
    "tagline": "<what the student will be able to DO — specific and exciting>",
    "total_xp": <sum of lesson xp>,
    "earned_xp": 0,
    "lessons": [
      {
        "id": "lesson-1",
        "title": "<compelling title>",
        "emoji": "<emoji>",
        "summary": "<one sentence that hints at the aha moment>",
        "content": "<rich markdown 200-350 words>",
        "key_points": ["<real insight>", "<real insight>", "<real insight>"],
        "xp": <100-200>,
        "completed": false,
        "quiz_passed": false,
        "quiz": [
          {"id":"q-1-1","question":"<tests real understanding>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},
          {"id":"q-1-2","question":"<different concept>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},
          {"id":"q-1-3","question":"<practical application>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null}
        ]
      }
    ]
  }
}

RULES: exactly ${count} lessons, exactly 3 quiz questions each, total_xp = sum of xp, IDs lesson-1/lesson-2/q-1-1/q-2-1 etc. Do NOT truncate.`,
      true, 6000, SMART
    );

    let parsed;
    try { parsed = JSON.parse(out); }
    catch { return res.status(502).json({ error: 'AI returned invalid curriculum. Please try again.' }); }

    log('/ai/curriculum/build', 200, Date.now() - t0, `lessons=${parsed?.curriculum?.lessons?.length ?? 0}`);
    res.json(parsed);

  } catch (e) {
    log('/ai/curriculum/build', 500, Date.now() - t0, e.message);
    res.status(500).json({ error: 'Curriculum build failed. Please try again.' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// INDEX — POST /ai/curriculum/chat
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/chat', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const message        = strShort(req.body.message, '');
    const lesson_context = str(req.body.lesson_context, '').slice(0, 600);
    const topic          = strShort(req.body.topic, '');

    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const reply = await ask(
      `You are INDEX AI — a sharp, direct tutor for "${topic}".
Lesson context: ${lesson_context}
Be clear and specific. Use code or analogies when helpful. Max 150 words. Never cut off mid-sentence.`,
      message,
      false, 600, FAST
    );
    log('/ai/curriculum/chat', 200, Date.now() - t0);
    res.json({ reply });
  } catch (e) {
    log('/ai/curriculum/chat', 500, Date.now() - t0, e.message);
    res.status(500).json({ error: 'Tutor unavailable. Please try again.' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// NEXUS — POST /api/chat
// Used by: AI tab (6 personas), home tip, idea plans, outreach message gen
// Also used by KINETIC, AURA, DECK (all send {system, messages})
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/chat', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const system   = str(req.body.system, '').slice(0, 800);
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    if (!messages.length) return res.status(400).json({ error: 'Messages array is required.' });

    const history = messages
      .slice(-6) // last 6 only — cost control
      .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
      .map(m => ({
        role:    ['user','assistant','system'].includes(m.role) ? m.role : 'user',
        content: String(m.content).slice(0, 1000),
      }));

    if (!history.length) return res.status(400).json({ error: 'No valid messages provided.' });

    const sysPrompt = system
      + '\n\nAlways complete your full response. Never cut off mid-sentence. If approaching length, wrap up cleanly.';

    const completion = await openai.chat.completions.create({
      model:      FAST,
      max_tokens: 800,
      messages:   [{ role: 'system', content: sysPrompt }, ...history],
    });

    log('/api/chat', 200, Date.now() - t0);
    res.json({ reply: completion.choices[0].message.content });

  } catch (e) {
    log('/api/chat', 500, Date.now() - t0, e.message);
    res.status(500).json({ error: 'AI unavailable. Please try again.' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// WARDROBE — POST /api/outfits
//
// Returns ONE outfit per call. Always a new combo.
// Accepts: items[], occasion, weather, notes (user comment), previousCombos[]
// previousCombos = array of piece-name arrays the user already saw today
// so the AI never repeats the same combo.
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/outfits', requireAuth, aiLimiter, async (req, res) => {
  const t0 = Date.now();
  try {
    const items          = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
    const occasion       = strShort(req.body.occasion, 'casual');
    const weather        = strShort(req.body.weather,  'mild');
    const notes          = strShort(req.body.notes,    '');   // user's comment/vibe note
    const previousCombos = Array.isArray(req.body.previousCombos)
      ? req.body.previousCombos.slice(0, 10)
      : [];

    if (!items.length) return res.status(400).json({ error: 'No items provided.' });

    // Build item list
    const itemList = items
      .map((it, i) => {
        const name  = typeof it === 'object' ? (it.name  || 'unknown') : String(it);
        const color = typeof it === 'object' ? (it.color || '')        : '';
        const type  = typeof it === 'object' ? (it.type  || '')        : '';
        const style = typeof it === 'object' ? (it.style || '')        : '';
        const parts = [color, type, style].filter(Boolean).join(', ');
        return `${i + 1}. ${name}${parts ? ` (${parts})` : ''}`;
      })
      .join('\n');

    // Tell the AI what combos to avoid
    const avoidBlock = previousCombos.length
      ? `\nAVOID — do not repeat these combos the user already saw:\n${previousCombos.map((c, i) => `${i + 1}. ${Array.isArray(c) ? c.join(' + ') : c}`).join('\n')}`
      : '';

    // Inject randomness so the AI doesn't default to the same "safe" pick
    const randomSeed = ['bold', 'minimal', 'layered', 'monochrome', 'contrast', 'streetwear-forward', 'clean', 'oversized'][Math.floor(Math.random() * 8)];

    const out = await ask(
      `You are a fashion AI — an expert stylist who knows color theory, silhouette, and streetwear culture.
Your job: pick ONE great outfit from the user's closet for the occasion and weather given.
Every time you are called you must pick a DIFFERENT combination — explore the closet creatively.
Think like a stylist, not an algorithm — consider mood, layering, proportion, and color harmony.
Return ONLY valid JSON.`,

      `Occasion: ${occasion}
Weather: ${weather}
Style direction for this pick: ${randomSeed}
${notes ? `User note: "${notes}"` : ''}
${avoidBlock}

Closet:
${itemList}

Pick ONE outfit. Return this exact JSON:
{
  "outfit": {
    "name": "<creative outfit name — 2-4 words, fits the vibe>",
    "pieces": ["<exact item name from closet>", "<exact item name>", "<exact item name>"],
    "vibe": "<one sentence — the mood or look this creates>",
    "why_it_works": "<one sentence — specific color/silhouette/occasion reasoning>",
    "stylist_tip": "<one actionable tip — how to wear it, what to do with the fit, shoes, accessories>",
    "confidence": <0.7-1.0>
  }
}

Rules:
- Only use items that exist in the closet list above
- 2-4 pieces maximum
- Must be a different combo from any in the AVOID list
- Be creative — do not always default to the most obvious combination`,
      true, 600, FAST
    );

    let parsed;
    try { parsed = JSON.parse(out); }
    catch { return res.status(502).json({ error: 'AI returned invalid response. Please try again.' }); }

    log('/api/outfits', 200, Date.now() - t0);
    res.json({ ...parsed, source: 'ai' });

  } catch (e) {
    log('/api/outfits', 500, Date.now() - t0, e.message);
    res.status(500).json({ error: 'Outfit generation failed. Please try again.' });
  }
});


// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Night.inc backend → port ${PORT}`);
  console.log(`Auth: ${APP_SECRET ? 'ENABLED' : 'DISABLED (set APP_SECRET to enable)'}`);
});
