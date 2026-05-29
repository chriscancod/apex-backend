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

// ─── Model tiers ──────────────────────────────────────────────────────────────
// FAST  = gpt-4.1-mini  — short chat, quick replies, simple tasks
// SMART = gpt-4.1-mini  — curriculum builds, schedules (higher token ceiling)
// Quality fix: the issue was token limits cutting responses mid-thought.
// Raising limits on the routes that need full output.

const FAST  = 'gpt-4.1-mini';
const SMART = 'gpt-4.1-mini';

async function ask(system, user, json = false, maxTokens = 800, model = FAST) {
  const res = await openai.chat.completions.create({
    model,
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
  apps: ['APX','INDEX','NEXUS','KINETIC','AURA','DECK','WARDROBE'],
  model: 'gpt-4.1-mini',
}));


// ══════════════════════════════════════════════════════════════════════════════
// APX — POST /schedule
//
// FIX: Was cutting off mid-schedule at 1500 tokens.
// Raised to 2500. Tightened prompt to spend tokens on BLOCKS not padding.
// Added explicit "never truncate" instruction and minimum block count rule.
// ══════════════════════════════════════════════════════════════════════════════

app.post('/schedule', async (req, res) => {
  try {
    const {
      username = 'OPERATOR', tasks = [], wakeTime = '6:30 AM',
      sleepTime = '10:30 PM', notes = '', date = '',
      currentTime = '', currentDay = '', profileContext = '',
    } = req.body;

    const profile  = profileContext ? `\nPROFILE:\n${profileContext.slice(0, 400)}` : '';
    const taskList = tasks.slice(0, 12).length
      ? tasks.slice(0, 12).map((t, i) => `${i + 1}. ${t}`).join('\n')
      : 'General high-performance day.';

    // Estimate hours available to set block count expectation
    const out = await ask(
      `You are APEX AI — elite daily scheduler for a high-performance teen founder.
Build a COMPLETE time-blocked schedule from wake to sleep. Every hour must be accounted for. No gaps. No truncation.

CATEGORIES: ops, fitness, study, biz, church, rest

ACTIVITY RULES — always specific, never vague:
• fitness → exact exercises, sets, reps, rest periods. E.g. "Push-ups 4×15, Pull-ups 3×8, Dips 3×12, Plank 3×60s — rest 60s between sets"
• study   → exact chapter/page range + exercises. E.g. "Algebra Ch.7 pp.142-158, complete exercises 7.1–7.20"
• biz     → exact actions. E.g. "Draft 3 product descriptions, respond to 5 Instagram DMs, schedule 2 TikTok posts"
• ops     → exact prep. E.g. "Pack gym bag, meal prep lunch, charge all devices, clean desk"
• rest    → no screens. E.g. "Foam roll 15min, read 20 pages, journal 3 wins + 1 lesson"

CRITICAL: You MUST fill the ENTIRE day. Generate as many blocks as needed to cover wake→sleep with zero gaps.
Return ONLY valid JSON. Do NOT stop early. Do NOT truncate.`,

      `OPERATOR: ${username}
DATE: ${date} ${currentDay}
WAKE: ${wakeTime} → SLEEP: ${sleepTime}
CURRENT TIME: ${currentTime}
NOTES: ${notes || 'none'}${profile}

TASKS TO SCHEDULE:
${taskList}

Return this exact JSON (fill ALL hours, minimum 8 blocks, maximum 20):
{
  "success": true,
  "data": {
    "summary": "<theme of day — one punchy sentence>",
    "totalXP": <sum of all block XP>,
    "blocks": [
      {
        "time": "<h:mm AM/PM>",
        "duration": "<X min>",
        "activity": "<SPECIFIC — exact exercises / chapter numbers / exact actions>",
        "category": "<ops|fitness|study|biz|church|rest>",
        "xp": <50-300>
      }
    ]
  }
}

Rules: blocks 30–120min, totalXP 1000–2500, cover every hour from ${wakeTime} to ${sleepTime}.`,
      true, 2500, SMART
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

// APX finance — pure math, free
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
      'APX finance advisor for a teen entrepreneur. Direct, specific, real numbers and formulas. Max 120 words.',
      `Log:\n${log || 'none'}\nQuestion: ${message}`,
      false, 400, FAST
    );
    res.json({ advice: reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════════════════════
// INDEX — POST /ai/curriculum/build
//
// FIX: Lessons were thin — "buns, no real pizzazz."
// Root cause: 120-word cap + 4000 token ceiling = AI had to compress hard.
// Fix: Raised to 6000 tokens. Removed word cap. Added explicit quality rules.
// Added personality instructions — lessons should feel like a great teacher
// explaining to a smart 16-year-old, not a Wikipedia article.
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/build', async (req, res) => {
  try {
    const {
      topic = 'Programming', depth = 'beginner',
      style = 'practical', lesson_count = 5,
    } = req.body;

    const styleGuide =
      style === 'practical'   ? 'Lead with real working code examples. Explain every line. Show what happens when it runs.' :
      style === 'theoretical' ? 'Build intuition first. Use sharp analogies. Then formalize the concept.' :
                                'Every lesson = one concrete step toward a finished project. Student should have something working by the end.';

    const depthGuide =
      depth === 'beginner'     ? 'Assume zero prior knowledge. Use plain language. Build from absolute scratch. No jargon without explanation.' :
      depth === 'intermediate' ? 'Assume basics are solid. Go deep on mechanics, edge cases, and common mistakes pros make.' :
                                 'Assume strong foundation. Cover advanced patterns, performance concerns, and production-level thinking.';

    const count = Math.min(Math.max(parseInt(lesson_count) || 5, 1), 10);

    const out = await ask(
      `You are INDEX — an elite curriculum builder and teacher. ${styleGuide} ${depthGuide}

LESSON QUALITY STANDARDS:
• Write like a brilliant mentor explaining to a sharp 16-year-old who learns fast
• Each lesson must have a clear "aha moment" — the one insight that changes how they think
• Use real examples, real code, real analogies — not textbook filler
• content field: write 200-350 words of rich markdown. Use ## headers, bullet points, and code blocks where helpful
• key_points: 3 genuinely insightful takeaways — not obvious restatements
• Quiz questions must test real understanding, not just memorization
• Make it feel like the best class the student ever took

Return ONLY valid JSON — no markdown, no backticks, completely parseable.`,

      `Build a ${count}-lesson curriculum on: "${topic}"

REQUIRED JSON shape (fill every field completely):
{
  "curriculum": {
    "id": "curriculum-1",
    "topic": "${topic}",
    "tagline": "<what the student will be able to DO after this curriculum — specific and exciting>",
    "total_xp": <sum of all lesson xp>,
    "earned_xp": 0,
    "lessons": [
      {
        "id": "lesson-1",
        "title": "<compelling title — not just 'Introduction'>",
        "emoji": "<relevant emoji>",
        "summary": "<one sentence that makes them want to read — hint at the aha moment>",
        "content": "<rich markdown 200-350 words: ## headers, bullet points, code blocks, real examples — make it excellent>",
        "key_points": [
          "<genuine insight #1 — something that shifts their thinking>",
          "<genuine insight #2 — practical or counterintuitive>",
          "<genuine insight #3 — connects to the bigger picture>"
        ],
        "xp": <100-200>,
        "completed": false,
        "quiz_passed": false,
        "quiz": [
          {
            "id": "q-1-1",
            "question": "<question that tests real understanding, not trivia>",
            "options": ["<wrong but plausible>", "<correct answer>", "<wrong but plausible>", "<wrong but plausible>"],
            "correct_index": 1,
            "user_answer": null
          },
          {
            "id": "q-1-2",
            "question": "<different concept from same lesson>",
            "options": ["<A>", "<B>", "<C>", "<D>"],
            "correct_index": <0-3>,
            "user_answer": null
          },
          {
            "id": "q-1-3",
            "question": "<practical application — what would you do in this situation?>",
            "options": ["<A>", "<B>", "<C>", "<D>"],
            "correct_index": <0-3>,
            "user_answer": null
          }
        ]
      }
    ]
  }
}

RULES:
- Exactly ${count} lessons
- Exactly 3 quiz questions per lesson
- total_xp = sum of all lesson xp values
- Lesson IDs: lesson-1, lesson-2... Quiz IDs: q-1-1, q-1-2, q-1-3, q-2-1...
- DO NOT truncate. Complete all ${count} lessons fully.`,
      true, 6000, SMART
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// INDEX — POST /ai/curriculum/chat
// FIX: Was 400 tokens — tutor was cutting off mid-explanation.
// Raised to 600. Added personality — sharp, real, like a good mentor.
app.post('/ai/curriculum/chat', async (req, res) => {
  try {
    const { message = '', lesson_context = '', topic = '' } = req.body;
    const reply = await ask(
      `You are INDEX AI — a sharp, direct tutor for the topic "${topic}".
Current lesson context: ${lesson_context.slice(0, 500)}

Be like the smartest person you know explaining something — clear, specific, no fluff.
Use code examples when they help. Use analogies when abstract. Max 150 words but use them well.
Never end mid-sentence. Complete every thought.`,
      message,
      false, 600, FAST
    );
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════════════════════
// NEXUS — POST /api/chat
//
// FIX: Was tapping out at 500 tokens — AI personas were giving half-answers.
// Raised to 800. History still capped at 6 messages to control cost.
// Added instruction to never cut off mid-thought.
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  try {
    const { system = '', messages = [] } = req.body;

    const history = messages.slice(-6).map(m => ({
      role:    m.role    || 'user',
      content: m.content || '',
    }));

    const sysWithRule = system.slice(0, 700) +
      '\n\nCRITICAL: Always complete your full response. Never cut off mid-sentence or mid-thought. If approaching length, wrap up cleanly.';

    const completion = await openai.chat.completions.create({
      model:      FAST,
      max_tokens: 800,
      messages: [
        { role: 'system', content: sysWithRule },
        ...history,
      ],
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// WARDROBE — POST /api/outfits
//
// AI generates outfit combos. Also has a randomizer fallback built in
// so if someone just wants a quick pick, it works without burning tokens.
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/outfits', async (req, res) => {
  try {
    const { items = [], occasion = 'casual', weather = 'mild', randomize = false } = req.body;
    if (!items.length) return res.status(400).json({ error: 'No items provided.' });

    // Pure randomizer — no AI, no cost
    if (randomize) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      const picks = shuffled.slice(0, Math.min(3, shuffled.length));
      return res.json({
        outfits: [{
          name: 'RANDOM FIT',
          pieces: picks.map(p => p.name || p),
          vibe: 'Randomized pick — style it your way.',
          confidence: 0.7,
        }],
        source: 'randomizer',
      });
    }

    const itemList = items.slice(0, 30)
      .map((it, i) => `${i + 1}. ${it.name} (${it.color || 'unknown color'}, ${it.type || 'unknown type'}, ${it.style || 'unspecified'})`)
      .join('\n');

    const out = await ask(
      `You are a fashion AI for a dark luxury streetwear brand (Night.inc — NOCTIS/2AM aesthetic).
Build outfit combinations from the user's closet. Be specific about why pieces work together — color theory, silhouette, occasion match.
Return ONLY valid JSON.`,

      `Occasion: ${occasion}. Weather: ${weather}.
Closet:
${itemList}

JSON:
{
  "outfits": [
    {
      "name": "<outfit name — creative, fits the dark luxury aesthetic>",
      "pieces": ["<exact item name from list>", "<exact item name>", "<exact item name>"],
      "vibe": "<one sentence — the feeling/look this creates>",
      "why_it_works": "<one sentence — color/silhouette/occasion logic>",
      "confidence": <0.0-1.0>
    }
  ],
  "source": "ai"
}

Rules: 3-5 outfits, 2-4 pieces each, only use items from the closet list, confidence = how well they actually match.`,
      true, 1200, FAST
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// KINETIC / AURA / DECK
// All three use POST /api/chat with their own system prompts from the app.
// No separate routes needed — /api/chat handles any {system, messages} pair.
// ══════════════════════════════════════════════════════════════════════════════


// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Night.inc backend → port ${PORT}`));
