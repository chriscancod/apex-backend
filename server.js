require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const OpenAI  = require('openai');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Model config ─────────────────────────────────────────────────────────────
// gpt-4o-mini: ~33x cheaper than gpt-4o, plenty smart for all these tasks
const MODEL = 'gpt-4o-mini';

async function ask(system, user, json = false, maxTokens = 500) {
  const res = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    response_format: json ? { type: 'json_object' } : undefined,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user  },
    ],
  });
  return res.choices[0].message.content;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({
  status: 'NIGHT_INC_ONLINE',
  apps: ['APX', 'INDEX', 'NEXUS'],
  model: MODEL,
}));


// ══════════════════════════════════════════════════════════════════════════════
// APX — POST /schedule
// AIManager.generateSchedule() → APIWrapper<ScheduleResponse>
// ══════════════════════════════════════════════════════════════════════════════

app.post('/schedule', async (req, res) => {
  try {
    const {
      username = 'OPERATOR', tasks = [], wakeTime = '6:30 AM',
      sleepTime = '10:30 PM', notes = '', date = '',
      currentTime = '', currentDay = '', profileContext = '',
    } = req.body;

    const profile  = profileContext ? `\nPROFILE:\n${profileContext.slice(0, 300)}` : '';
    const taskList = tasks.slice(0, 10).length
      ? tasks.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')
      : 'General high-performance day.';

    const out = await ask(
      `You are APEX AI, a daily scheduler for a high-performance teen.
Build a time-blocked schedule between wake and sleep. Respect fixed commitments.
Categories: ops, fitness, study, biz, church, rest. Return ONLY valid JSON.

ACTIVITY RULES — always specific, never vague:
- fitness: "Push-ups 4x15, Pull-ups 3x8, Dips 3x12, Plank 3x60s — rest 60s"
- study: "Chapter 5 — read pp.82-94, complete exercises 5.1-5.15"
- biz: "Write 3 product descriptions, reply to 5 DMs, schedule 2 posts"
- ops: "Pack gym bag, prep meals, charge devices, clean workspace"
- rest: "No screens. Foam roll 10min, read 20 pages, journal 3 wins"`,

      `${username} | ${date} ${currentDay} | Wake:${wakeTime} Sleep:${sleepTime}
Notes:${notes || 'none'}${profile}
Tasks:\n${taskList}

JSON: {"success":true,"data":{"summary":"<theme>","totalXP":<total>,"blocks":[{"time":"<h:mm AM/PM>","duration":"<X min>","activity":"<SPECIFIC>","category":"<ops|fitness|study|biz|church|rest>","xp":<50-300>}]}}

Rules: full day no gaps, blocks 30-120min, totalXP 800-2000, activity always specific.`,
      true, 1500
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

// APX finance — pure math, no AI cost
app.post('/apx/finance/split', (req, res) => {
  const amt = parseFloat(req.body.income) || 0;
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

app.post('/apx/finance/advice', async (req, res) => {
  try {
    const { message = '', entries = [] } = req.body;
    const log = entries.slice(0, 10).map(e => `${e.type}: $${e.amount} (${e.label})`).join('\n');
    const reply = await ask(
      'APX finance advisor for a teen entrepreneur. Direct, specific, real numbers. Under 80 words.',
      `Log:\n${log || 'none'}\nQuestion: ${message}`,
      false, 300
    );
    res.json({ advice: reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════════════════════
// INDEX — POST /ai/curriculum/build
// CurriculumBuildRequest → CurriculumBuildResponse { curriculum: CurriculumPlan }
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/build', async (req, res) => {
  try {
    const {
      topic = 'Programming', depth = 'beginner',
      style = 'practical', lesson_count = 5,
    } = req.body;

    const styleGuide =
      style === 'practical'   ? 'Real code examples with explanations. Hands-on exercises.' :
      style === 'theoretical' ? 'Deep concepts, mental models, real-world analogies.' :
                                'Each lesson = one step toward a finished project.';

    const depthGuide =
      depth === 'beginner'     ? 'Zero prior knowledge. Plain language. Build from scratch.' :
      depth === 'intermediate' ? 'Assume basics. Deeper mechanics, edge cases, common mistakes.' :
                                 'Strong foundation assumed. Advanced patterns, production concerns.';

    const count = Math.min(Math.max(parseInt(lesson_count) || 5, 1), 10);

    const out = await ask(
      `You are INDEX, an expert curriculum builder. ${styleGuide} ${depthGuide}
Return ONLY valid JSON — no markdown, no backticks, completely parseable.
Keep lesson content under 120 words — dense and educational.`,

      `Build a ${count}-lesson curriculum on: "${topic}"

JSON (required exactly):
{
  "curriculum": {
    "id": "curriculum-1",
    "topic": "${topic}",
    "tagline": "<what student will master>",
    "total_xp": <sum of lesson xp>,
    "earned_xp": 0,
    "lessons": [
      {
        "id": "lesson-1",
        "title": "<title>",
        "emoji": "<emoji>",
        "summary": "<one sentence>",
        "content": "<markdown: headers, bullets, real code/examples — max 120 words>",
        "key_points": ["<insight>","<insight>","<insight>"],
        "xp": <75-150>,
        "completed": false,
        "quiz_passed": false,
        "quiz": [
          {"id":"q-1-1","question":"<test real understanding>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},
          {"id":"q-1-2","question":"<different concept>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null},
          {"id":"q-1-3","question":"<practical application>","options":["<A>","<B>","<C>","<D>"],"correct_index":<0-3>,"user_answer":null}
        ]
      }
    ]
  }
}

RULES: exactly ${count} lessons, exactly 3 quiz questions each, total_xp = sum of xp, IDs lesson-1/lesson-2/q-1-1/q-2-1 etc.`,
      true, 4000
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// INDEX — POST /ai/curriculum/chat
app.post('/ai/curriculum/chat', async (req, res) => {
  try {
    const { message = '', lesson_context = '', topic = '' } = req.body;
    const reply = await ask(
      `Expert tutor for "${topic}". Lesson: ${lesson_context.slice(0, 300)}
Clear, specific, use code when relevant. Max 80 words.`,
      message, false, 400
    );
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════════════════════
// NEXUS — POST /api/chat
// Used by: AI Tab (6 personas), Home daily tip, Idea action plans,
//          Outreach tab AI message generation (OutreachTab.generateMessage)
//
// Request:  { system: string, messages: [{role, content}] }
// Response: { reply: string }
//
// NOTE: NEXUS SMS uses sms:// deep links — no Twilio, no backend needed for
// sending. The backend only generates the message text via this endpoint.
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  try {
    const { system = '', messages = [] } = req.body;

    // Cap history to last 6 messages to keep costs low
    const history = messages.slice(-6).map(m => ({
      role:    m.role    || 'user',
      content: m.content || '',
    }));

    const completion = await openai.chat.completions.create({
      model:      MODEL,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system.slice(0, 600) },
        ...history,
      ],
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Night.inc backend → port ${PORT} | model: ${MODEL}`));


// ══════════════════════════════════════════════════════════════════════════════
// WARDROBE — POST /api/outfits
// AIOutfitEngine posts closet items → get outfit combinations back
// Request:  { items: [{name, color, type, style}], occasion?, weather? }
// Response: { outfits: [{name, pieces, vibe, confidence}] }
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/outfits', async (req, res) => {
  try {
    const { items = [], occasion = 'casual', weather = 'mild' } = req.body;

    if (!items.length) return res.status(400).json({ error: 'No items provided.' });

    const itemList = items.slice(0, 30)
      .map((it, i) => `${i + 1}. ${it.name} — ${it.color}, ${it.type}, ${it.style || 'unspecified style'}`)
      .join('\n');

    const out = await ask(
      `You are a fashion AI for a dark luxury streetwear brand. 
Build outfit combinations from the user's closet. Be specific about pieces and why they work together.
Return ONLY valid JSON.`,

      `Occasion: ${occasion}. Weather: ${weather}.
Closet items:
${itemList}

JSON: {"outfits":[{"name":"<outfit name>","pieces":["<item>","<item>","<item>"],"vibe":"<1 sentence>","confidence":<0.0-1.0>}]}

Rules: 3-5 outfits, 2-4 pieces each, only use items from the list above, confidence reflects how well pieces match.`,
      true, 1000
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// KINETIC / AURA / DECK — POST /api/chat already handles these.
// All three apps post { system, messages } → { reply }
// KINETIC: workout plans, biometric analysis
// AURA: skincare routines, product recommendations
// DECK: podcast summaries, AI recommendations
// No separate routes needed — /api/chat is generic enough.
// ══════════════════════════════════════════════════════════════════════════════
