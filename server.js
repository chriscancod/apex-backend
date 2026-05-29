require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const OpenAI  = require('openai');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── GPT helper ───────────────────────────────────────────────────────────────
async function ask(system, user, json = false, maxTokens = 1000) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
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
  apps: ['APX', 'INDEX'],
  routes: {
    apx:   ['/schedule', '/fitness', '/finance/advice', '/finance/split'],
    index: ['/ai/curriculum/build', '/ai/curriculum/chat'],
  },
}));


// ══════════════════════════════════════════════════════════════════════════════
// APX  —  called by AIManager.generateSchedule()  →  POST /schedule
//
// Swift sends:
//   { username, tasks:[String], wakeTime, sleepTime, notes,
//     date, currentTime, currentDay, profileContext }
//
// Swift decodes:
//   APIWrapper<ScheduleResponse>
//   → { success: Bool, data: { blocks:[ScheduleBlock], summary:String, totalXP:Int } }
//
// ScheduleBlock fields: time, duration, activity, category, xp
// ══════════════════════════════════════════════════════════════════════════════

app.post('/schedule', async (req, res) => {
  try {
    const {
      username = 'OPERATOR',
      tasks = [],
      wakeTime = '6:30 AM',
      sleepTime = '10:30 PM',
      notes = '',
      date = '',
      currentTime = '',
      currentDay = '',
      profileContext = '',
    } = req.body;

    const taskList = tasks.length
      ? tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : 'No specific tasks — build a general high-performance day.';

    const profile = profileContext
      ? `\n\nOPERATOR PROFILE:\n${profileContext}`
      : '';

    const out = await ask(
      `You are APEX AI, a ruthlessly efficient daily scheduler for a high-performance teen operator.
Build a time-blocked schedule using ONLY the hours between wake and sleep.
Respect every fixed commitment listed in the profile exactly — do not move them.
Categories must be one of: ops, fitness, study, biz, church, rest.
Return ONLY valid JSON — no markdown, no backticks.`,

      `Operator: ${username}
Date: ${date} (${currentDay})
Current time: ${currentTime}
Wake: ${wakeTime}  |  Sleep: ${sleepTime}
Notes: ${notes || 'none'}
${profile}

Pending tasks:
${taskList}

Return this exact JSON shape:
{
  "success": true,
  "data": {
    "summary": "<one punchy sentence — the theme of this day>",
    "totalXP": <sum of all block xp values>,
    "blocks": [
      {
        "time": "<h:mm AM/PM>",
        "duration": "<e.g. 45 min>",
        "activity": "<what to do — be specific>",
        "category": "<ops|fitness|study|biz|church|rest>",
        "xp": <number 50-300>
      }
    ]
  }
}

Rules:
- Cover the FULL day from wake to sleep with no gaps
- Each block must be 30-120 min
- Total XP should be 800-2000
- Keep activity descriptions under 80 chars`,
      true,
      2000
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// APX  —  fitness plan  →  POST /apx/fitness
// Not called by the current Swift code but kept for future use
// ══════════════════════════════════════════════════════════════════════════════

app.post('/apx/fitness', async (req, res) => {
  try {
    const { goal = 'general fitness', level = 'intermediate', days = 5 } = req.body;
    const out = await ask(
      'You are APX fitness coach. Return JSON only.',
      `Goal: ${goal}  Level: ${level}  Days/week: ${days}
JSON: { plan:[{ day, focus, exercises:[{ name, sets, reps, rest }] }] }`,
      true, 1500
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════════════════════
// APX  —  finance  →  POST /apx/finance/advice  &  /apx/finance/split
// ══════════════════════════════════════════════════════════════════════════════

app.post('/apx/finance/advice', async (req, res) => {
  try {
    const { message = '', entries = [] } = req.body;
    const log = entries.map(e => `${e.type}: $${e.amount} (${e.label})`).join('\n');
    const reply = await ask(
      'You are APX finance advisor for a teen entrepreneur. Be direct, practical, no fluff.',
      `Log:\n${log || 'none'}\n\nQuestion: ${message}`
    );
    res.json({ advice: reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Night.inc 80/8/7/3/2 money split — pure math, no AI needed
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


// ══════════════════════════════════════════════════════════════════════════════
// INDEX v5  —  curriculum build
//
// Swift sends (CurriculumBuildRequest):
//   { topic, depth, style, lesson_count }
//
// Swift decodes (CurriculumBuildResponse):
//   { curriculum: CurriculumPlan }
//
// CurriculumPlan fields (snake_case — matches Swift CodingKeys):
//   id, topic, tagline, total_xp, earned_xp, lessons:[CurriculumLesson]
//
// CurriculumLesson:
//   id, title, emoji, summary, content, key_points:[String],
//   xp, completed, quiz_passed, quiz:[QuizQuestion]
//
// QuizQuestion:
//   id, question, options:[String], correct_index, user_answer
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/build', async (req, res) => {
  try {
    const {
      topic       = 'Programming',
      depth       = 'beginner',
      style       = 'practical',
      lesson_count = 5,
    } = req.body;

    const styleGuide =
      style === 'practical'    ? 'Focus on working code examples and hands-on exercises. Every lesson needs at least one code block.' :
      style === 'theoretical'  ? 'Focus on concepts, mental models, and theory. Use analogies. Minimal code.' :
                                 'Each lesson is one step toward completing a real mini-project. End with a build milestone.';

    const depthGuide =
      depth === 'beginner'      ? 'Assume zero prior knowledge. Define every term on first use. Short sentences.' :
      depth === 'intermediate'  ? 'Assume basic familiarity. Dive into mechanics, edge cases, and why things work.' :
                                  'Assume solid foundation. Cover internals, performance, trade-offs, and advanced patterns.';

    const count = Math.min(Math.max(parseInt(lesson_count) || 5, 1), 10);

    const out = await ask(
      `You are INDEX, a world-class curriculum builder.
${styleGuide}
${depthGuide}
Return ONLY valid JSON — no markdown fences, no extra text, no truncation.
The JSON must be 100% complete and parseable.`,

      `Build a ${count}-lesson curriculum on: "${topic}"

Return this EXACT JSON shape (all keys required):
{
  "curriculum": {
    "id": "<uuid>",
    "topic": "${topic}",
    "tagline": "<one punchy sentence — what the student will master>",
    "total_xp": <sum of all lesson xp>,
    "earned_xp": 0,
    "lessons": [
      {
        "id": "<uuid>",
        "title": "<lesson title>",
        "emoji": "<one emoji>",
        "summary": "<one sentence — what this lesson covers>",
        "content": "<lesson body in markdown — ## headers, bullet points, code blocks — max 200 words>",
        "key_points": ["<point 1>", "<point 2>", "<point 3>"],
        "xp": <50-200>,
        "completed": false,
        "quiz_passed": false,
        "quiz": [
          {
            "id": "<uuid>",
            "question": "<question>",
            "options": ["<A>", "<B>", "<C>", "<D>"],
            "correct_index": <0-3>,
            "user_answer": null
          },
          { "id": "<uuid>", "question": "...", "options": ["..."], "correct_index": 0, "user_answer": null },
          { "id": "<uuid>", "question": "...", "options": ["..."], "correct_index": 0, "user_answer": null }
        ]
      }
    ]
  }
}

STRICT RULES — violating any will break the app:
- Exactly ${count} lessons, no more, no less
- Exactly 3 quiz questions per lesson
- total_xp = sum of all lesson xp values
- content max 200 words per lesson (keeps JSON small enough to complete)
- All string values must be properly escaped JSON
- UUIDs can be simple strings like "lesson-1", "q-1-1" etc.`,
      true,
      8000
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// INDEX v5  —  lesson chat
//
// Swift sends (LessonChatRequest):
//   { message, lesson_context, topic }
//
// Swift decodes (LessonChatResponse):
//   { reply: String }
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/chat', async (req, res) => {
  try {
    const {
      message        = '',
      lesson_context = '',
      topic          = '',
    } = req.body;

    const reply = await ask(
      `You are INDEX, an expert tutor teaching "${topic}".
You are inside this specific lesson:
${lesson_context}

Rules:
- Stay strictly on-topic for this lesson and subject
- Be concise — 2-4 sentences max unless a code example is needed
- Use code blocks when showing code
- If asked something outside the lesson scope, redirect back to the lesson`,
      message,
      false,
      600
    );

    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () =>
  console.log(`Night.inc backend online → port ${PORT}`)
);
