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
}));


// ══════════════════════════════════════════════════════════════════════════════
// APX  —  POST /schedule
// Swift: AIManager.generateSchedule() → APIWrapper<ScheduleResponse>
// ══════════════════════════════════════════════════════════════════════════════

app.post('/schedule', async (req, res) => {
  try {
    const {
      username       = 'OPERATOR',
      tasks          = [],
      wakeTime       = '6:30 AM',
      sleepTime      = '10:30 PM',
      notes          = '',
      date           = '',
      currentTime    = '',
      currentDay     = '',
      profileContext = '',
    } = req.body;

    const taskList = tasks.length
      ? tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : 'No specific tasks — build a general high-performance day.';

    const profile = profileContext ? `\n\nOPERATOR PROFILE:\n${profileContext}` : '';

    const out = await ask(
      `You are APEX AI, a ruthlessly efficient daily scheduler for a high-performance teen operator.
Build a time-blocked schedule using ONLY the hours between wake and sleep.
Respect every fixed commitment listed in the profile — do not move them.
Categories: ops, fitness, study, biz, church, rest.
Return ONLY valid JSON — no markdown, no backticks.

CRITICAL RULE — the "activity" field must be FULLY DETAILED and immediately actionable.
NEVER write vague words like "workout", "study session", "business tasks", "rest", "morning routine".
ALWAYS be specific:

FITNESS example: "Push-ups 4x15, Pull-ups 3x8, Dips 3x12, Goblet squats 3x12 @ bodyweight, Plank 3x60s — rest 60s between sets"
STUDY example: "Chapter 5 quadratic equations — read pp.82-94, complete exercises 5.1-5.15, mark wrong answers for review"
BIZ example: "Write 3 product descriptions for hoodie drop, respond to 5 customer DMs, schedule 2 Instagram posts using Later"
OPS example: "Pack gym bag (shoes, wraps, water), prep chicken + rice for tomorrow, charge AirPods + phone, wipe desk"
REST example: "No screens. Foam roll quads + hamstrings 10 min, read 20 pages of current book, journal 3 wins from today"
CHURCH example: "Thursday service at [location from profile] — arrive 5 min early, bring notebook"

Every block must be specific enough that the operator knows EXACTLY what to do with zero guesswork.`,

      `Operator: ${username}
Date: ${date} (${currentDay})
Current time: ${currentTime}
Wake: ${wakeTime}  |  Sleep: ${sleepTime}
Notes: ${notes || 'none'}
${profile}

Pending tasks:
${taskList}

Return this exact JSON:
{
  "success": true,
  "data": {
    "summary": "<one punchy sentence — theme of this day>",
    "totalXP": <sum of all block xp>,
    "blocks": [
      {
        "time": "<h:mm AM/PM>",
        "duration": "<e.g. 45 min>",
        "activity": "<FULLY DETAILED — exact exercises with sets/reps, exact study topics, exact biz actions>",
        "category": "<ops|fitness|study|biz|church|rest>",
        "xp": <50-300>
      }
    ]
  }
}

Rules:
- Cover FULL day from wake to sleep, no gaps
- Each block 30-120 min
- Total XP 800-2000
- Activity field: be as specific as a personal trainer or coach would be`,
      true,
      3000
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// APX  —  POST /apx/fitness  (future use)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/apx/fitness', async (req, res) => {
  try {
    const { goal = 'general fitness', level = 'intermediate', days = 5 } = req.body;
    const out = await ask(
      'You are APX fitness coach. Return JSON only.',
      `Goal: ${goal}  Level: ${level}  Days/week: ${days}
JSON: { plan:[{ day, focus, exercises:[{ name, sets, reps, rest, notes }] }] }`,
      true, 1500
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════════════════════
// APX  —  POST /apx/finance/advice  &  /apx/finance/split
// ══════════════════════════════════════════════════════════════════════════════

app.post('/apx/finance/advice', async (req, res) => {
  try {
    const { message = '', entries = [] } = req.body;
    const log = entries.map(e => `${e.type}: $${e.amount} (${e.label})`).join('\n');
    const reply = await ask(
      'You are APX finance advisor for a teen entrepreneur. Be direct, practical, specific — give actual numbers and action steps, not generic advice.',
      `Log:\n${log || 'none'}\n\nQuestion: ${message}`
    );
    res.json({ advice: reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
// INDEX v5  —  POST /ai/curriculum/build
// Swift: CurriculumBuildRequest → CurriculumBuildResponse
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/build', async (req, res) => {
  try {
    const {
      topic        = 'Programming',
      depth        = 'beginner',
      style        = 'practical',
      lesson_count = 5,
    } = req.body;

    const styleGuide =
      style === 'practical'   ? 'Every lesson must include working, runnable code examples with line-by-line explanation. Exercises must be hands-on.' :
      style === 'theoretical' ? 'Explain the deep WHY behind every concept. Use real-world analogies. Cover history, trade-offs, mental models.' :
                                'Each lesson is one concrete step toward a finished project. End with a deliverable the student can run or show.';

    const depthGuide =
      depth === 'beginner'     ? 'Assume zero prior knowledge. Define every term first. Use plain language. Build from absolute scratch.' :
      depth === 'intermediate' ? 'Assume basic familiarity. Go deep on mechanics, gotchas, and edge cases. Show common mistakes and why they happen.' :
                                 'Assume strong foundation. Cover internals, performance implications, advanced patterns, and real production concerns.';

    const count = Math.min(Math.max(parseInt(lesson_count) || 5, 1), 10);

    const out = await ask(
      `You are INDEX, a world-class curriculum builder and expert teacher.
${styleGuide}
${depthGuide}

CRITICAL RULE — every lesson "content" field must be RICH, DETAILED, and actually teachable:
- Never write a content field that is a single vague sentence
- Include real explanations, actual code with comments, concrete examples
- For code topics: show real syntax, explain each line, show output
- For math/science: show the actual formula, walk through a worked example
- For business/soft skills: give real frameworks, actual scripts, real scenarios
- Key points must be genuine insights, not obvious fluff
- Quiz questions must test real understanding, not trivia

Return ONLY valid JSON — no markdown fences, no extra text, completely parseable.`,

      `Build a ${count}-lesson curriculum on: "${topic}"

Return this EXACT JSON shape:
{
  "curriculum": {
    "id": "curriculum-1",
    "topic": "${topic}",
    "tagline": "<one punchy sentence — what the student will genuinely master>",
    "total_xp": <exact sum of all lesson xp>,
    "earned_xp": 0,
    "lessons": [
      {
        "id": "lesson-1",
        "title": "<specific, descriptive lesson title>",
        "emoji": "<one relevant emoji>",
        "summary": "<one sentence — exactly what this lesson teaches>",
        "content": "<RICH markdown content — ## headers, bullet points, real code blocks with syntax, worked examples, explanations — 150-250 words>",
        "key_points": [
          "<genuine insight or rule, not obvious>",
          "<another real takeaway>",
          "<a third concrete thing they will know>"
        ],
        "xp": <75-200>,
        "completed": false,
        "quiz_passed": false,
        "quiz": [
          {
            "id": "q-1-1",
            "question": "<question that tests real understanding — not just recall>",
            "options": ["<wrong but plausible>", "<correct answer>", "<wrong but plausible>", "<wrong but plausible>"],
            "correct_index": 1,
            "user_answer": null
          },
          {
            "id": "q-1-2",
            "question": "<different question, different concept from same lesson>",
            "options": ["<A>", "<B>", "<C>", "<D>"],
            "correct_index": <0-3>,
            "user_answer": null
          },
          {
            "id": "q-1-3",
            "question": "<third question — practical application>",
            "options": ["<A>", "<B>", "<C>", "<D>"],
            "correct_index": <0-3>,
            "user_answer": null
          }
        ]
      }
    ]
  }
}

STRICT RULES:
- Exactly ${count} lessons
- Exactly 3 quiz questions per lesson
- total_xp = exact sum of all lesson xp values
- Content 150-250 words (enough to be genuinely educational, short enough to complete)
- Increment IDs: lesson-1, lesson-2... and q-1-1, q-1-2, q-1-3, q-2-1 etc.
- correct_index must actually match the correct option in the options array
- All JSON strings properly escaped`,
      true,
      8000
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// INDEX v5  —  POST /ai/curriculum/chat
// Swift: LessonChatRequest → LessonChatResponse
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
Current lesson context:
${lesson_context}

Be a genuinely great tutor:
- Give detailed, accurate explanations — not one-liners
- Show real code examples when the question is about code (with comments)
- Walk through examples step by step
- If the student is confused, try a different angle or analogy
- Stay on topic for this lesson
- Max 150 words — be thorough but concise`,
      message,
      false,
      800
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
