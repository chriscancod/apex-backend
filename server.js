require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT = process.env.PORT || 3000;

// ── helper ──────────────────────────────────────────────────────────────────
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

// ── health ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'NIGHT_INC_BACKEND_ONLINE',
  apps: ['APX', 'KINETIC', 'INDEX', 'NEXUS', 'AURA', 'DECK', 'WARDROBE'],
}));


// ════════════════════════════════════════════════════════════════════════════
// APX — productivity / gamification
// ════════════════════════════════════════════════════════════════════════════

// POST /apx/schedule  body: { tasks:[{title,category,xp}], date }
app.post('/apx/schedule', async (req, res) => {
  try {
    const { tasks = [], date } = req.body;
    const list = tasks.map(t => `- ${t.title} [${t.category}] (${t.xp}XP)`).join('\n');
    const out = await ask(
      'You are APX, a gamified productivity AI. Build a time-blocked daily schedule. Return JSON only.',
      `Date: ${date}\nTasks:\n${list}\n\nJSON format: { schedule:[{time,task,duration,xp,tip}] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /apx/fitness  body: { goal, level, days }
app.post('/apx/fitness', async (req, res) => {
  try {
    const { goal, level, days } = req.body;
    const out = await ask(
      'You are APX fitness coach. Return JSON only.',
      `Goal:${goal} Level:${level} Days/week:${days}\nJSON: { plan:[{day,focus,exercises:[{name,sets,reps,rest}]}] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /apx/finance/advice  body: { message, entries:[{type,amount,label}] }
app.post('/apx/finance/advice', async (req, res) => {
  try {
    const { message, entries = [] } = req.body;
    const log = entries.map(e => `${e.type}: $${e.amount} (${e.label})`).join('\n');
    const out = await ask(
      'You are APX finance advisor for a teen entrepreneur. Be direct and practical.',
      `Log:\n${log}\n\nQuestion: ${message}`
    );
    res.json({ advice: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /apx/finance/split  body: { income }
app.post('/apx/finance/split', (req, res) => {
  const amt = parseFloat(req.body.income) || 0;
  res.json({ total: amt, split: {
    reinvestment: +(amt * 0.80).toFixed(2),
    investing:    +(amt * 0.08).toFixed(2),
    savings:      +(amt * 0.07).toFixed(2),
    tools:        +(amt * 0.03).toFixed(2),
    personal:     +(amt * 0.02).toFixed(2),
  }});
});


// ════════════════════════════════════════════════════════════════════════════
// KINETIC — biometrics / health
// ════════════════════════════════════════════════════════════════════════════

// POST /kinetic/analyze  body: { hrv, sleepEff, calories, fastingHrs, readiness }
app.post('/kinetic/analyze', async (req, res) => {
  try {
    const { hrv, sleepEff, calories, fastingHrs, readiness } = req.body;
    const out = await ask(
      'You are KINETIC, a biometric performance AI. Return JSON only.',
      `HRV:${hrv}ms Sleep:${sleepEff}% Calories:${calories} Fasting:${fastingHrs}h Readiness:${readiness}/100\nJSON: { verdict, score, insights:[string], actions:[string] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /kinetic/plan  body: { goal, metrics:{} }
app.post('/kinetic/plan', async (req, res) => {
  try {
    const { goal, metrics } = req.body;
    const out = await ask(
      'You are KINETIC. Build a metabolic + training plan. Return JSON only.',
      `Goal:${goal} Metrics:${JSON.stringify(metrics)}\nJSON: { plan:{ nutrition, training, recovery, dailyTargets:{} } }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /kinetic/hrv  body: { current, baseline, trend:[numbers] }
app.post('/kinetic/hrv', async (req, res) => {
  try {
    const { current, baseline, trend } = req.body;
    const delta = (((current - baseline) / baseline) * 100).toFixed(1);
    const out = await ask(
      'You are KINETIC HRV analyst. Return JSON only.',
      `Current:${current}ms Baseline:${baseline}ms Delta:${delta}% Trend:${JSON.stringify(trend)}\nJSON: { status, recovery, recommendation, trainToday:bool }`,
      true
    );
    res.json({ delta: parseFloat(delta), ...JSON.parse(out) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ════════════════════════════════════════════════════════════════════════════
// INDEX — knowledge vault + AI curriculum (matches Swift app exactly)
// ════════════════════════════════════════════════════════════════════════════

// POST /index/search
app.post('/index/search', async (req, res) => {
  try {
    const { query, documents = [] } = req.body;
    const docs = documents.map((d, i) => `[${i}] ${d.title} (${d.language}): ${d.content?.slice(0, 300)}`).join('\n\n');
    const out = await ask(
      'You are INDEX, a knowledge vault AI. Return JSON only.',
      `Query:"${query}"\n\nDocs:\n${docs}\nJSON: { results:[{index,title,relevance,snippet}] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /index/summarize
app.post('/index/summarize', async (req, res) => {
  try {
    const { content, title } = req.body;
    const out = await ask(
      'You are INDEX. Summarize technical content. Return JSON only.',
      `Title:${title}\nContent:\n${content}\nJSON: { summary, keyPoints:[string], tags:[string], complexity }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /index/explain
app.post('/index/explain', async (req, res) => {
  try {
    const { code, language } = req.body;
    const out = await ask(
      `You are INDEX. Explain ${language} code clearly. Return JSON only.`,
      `\`\`\`${language}\n${code}\n\`\`\`\nJSON: { explanation, lineByLine:[{line,comment}], concepts:[string] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /ai/curriculum/build
// Body: { topic, depth, style, lesson_count }
// Returns: { curriculum: CurriculumPlan } — exact shape the Swift CurriculumBuildResponse expects
app.post('/ai/curriculum/build', async (req, res) => {
  try {
    const { topic, depth = 'beginner', style = 'practical', lesson_count = 5 } = req.body;

    const styleGuide = style === 'practical'
      ? 'Focus on code examples and hands-on exercises with working code snippets.'
      : style === 'theoretical'
      ? 'Focus on concepts, theory, definitions, and mental models.'
      : 'Build toward a real mini-project. Each lesson is a step toward the final build.';

    const depthGuide = depth === 'beginner'
      ? 'Assume no prior knowledge. Keep language simple.'
      : depth === 'intermediate'
      ? 'Assume basic familiarity. Go deeper into mechanics.'
      : 'Assume solid foundation. Cover advanced edge cases and internals.';

    const out = await ask(
      `You are INDEX, an expert curriculum builder. ${styleGuide} ${depthGuide}
Return ONLY valid JSON — no markdown, no backticks, no preamble. Ensure the JSON is complete and valid.`,
      `Build a ${lesson_count}-lesson curriculum on: "${topic}"

Return this exact JSON shape:
{
  "curriculum": {
    "id": "<uuid string>",
    "topic": "${topic}",
    "tagline": "<one punchy sentence describing what they'll master>",
    "total_xp": <number>,
    "earned_xp": 0,
    "lessons": [
      {
        "id": "<uuid string>",
        "title": "<lesson title>",
        "emoji": "<single relevant emoji>",
        "summary": "<one sentence — what this lesson covers>",
        "content": "<full lesson in markdown — use ## headers, bullet points, code blocks>",
        "key_points": ["<point>", "<point>", "<point>"],
        "xp": <number between 50-200>,
        "completed": false,
        "quiz_passed": false,
        "quiz": [
          {
            "id": "<uuid string>",
            "question": "<question text>",
            "options": ["<A>", "<B>", "<C>", "<D>"],
            "correct_index": <0-3>,
            "user_answer": null
          }
        ]
      }
    ]
  }
}

Make exactly ${lesson_count} lessons. Each lesson must have exactly 3 quiz questions. XP per lesson should be between 50-200. total_xp should equal the sum of all lesson xp values.
IMPORTANT: Keep each lesson "content" field under 300 words. Be concise. The JSON must be complete and valid — never truncate.`,
      true,
      8000
    );

    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /ai/curriculum/chat
// Body: { message, lesson_context, topic }
// Returns: { reply: string }
app.post('/ai/curriculum/chat', async (req, res) => {
  try {
    const { message, lesson_context, topic } = req.body;
    const reply = await ask(
      `You are INDEX, an expert tutor teaching "${topic || 'this topic'}". 
You are currently in a lesson: ${lesson_context || 'general'}
Be concise, clear, and helpful. Use code examples when relevant. 
Never go off-topic — always tie answers back to the lesson content.`,
      message
    );
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ════════════════════════════════════════════════════════════════════════════
// NEXUS — business command hub
// ════════════════════════════════════════════════════════════════════════════

// POST /nexus/reply  body: { customerMessage, orderId, context }
app.post('/nexus/reply', async (req, res) => {
  try {
    const { customerMessage, orderId, context } = req.body;
    const out = await ask(
      'You are NEXUS, customer support AI for Night.inc. Write professional Markdown replies. Return JSON only.',
      `Order:${orderId || 'N/A'} Context:${context || 'None'}\nMessage:"${customerMessage}"\nJSON: { reply, action, priority }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /nexus/script  body: { customerName, purpose, notes }
app.post('/nexus/script', async (req, res) => {
  try {
    const { customerName, purpose, notes } = req.body;
    const out = await ask(
      'You are NEXUS. Generate a professional phone call script. Return JSON only.',
      `Customer:${customerName} Purpose:${purpose} Notes:${notes || 'None'}\nJSON: { greeting, mainPoints:[string], objectionHandlers:[{objection,response}], closing }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /nexus/split  body: { amount }
app.post('/nexus/split', (req, res) => {
  const amt = parseFloat(req.body.amount) || 0;
  res.json({ total: amt, split: {
    reinvestment: +(amt * 0.50).toFixed(2),
    capital:      +(amt * 0.30).toFixed(2),
    personal:     +(amt * 0.20).toFixed(2),
  }});
});


// ════════════════════════════════════════════════════════════════════════════
// AURA — looksmaxxing / skincare
// ════════════════════════════════════════════════════════════════════════════

// POST /aura/routine  body: { products:[{name,actives}], uvIndex, humidity, aqi }
app.post('/aura/routine', async (req, res) => {
  try {
    const { products = [], uvIndex, humidity, aqi } = req.body;
    const prods = products.map(p => `- ${p.name} (${p.actives})`).join('\n');
    const out = await ask(
      'You are AURA, a premium skincare AI. Return JSON only.',
      `Products:\n${prods}\nUV:${uvIndex} Humidity:${humidity}% AQI:${aqi}\nJSON: { morning:[{step,product,amount}], evening:[{step,product,amount}], warnings:[string], envNotes }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /aura/score  body: { factors:{ sleep, hydration, exercise, skincare, nutrition } }
app.post('/aura/score', async (req, res) => {
  try {
    const { factors } = req.body;
    const out = await ask(
      'You are AURA. Calculate a presence score and improvements. Return JSON only.',
      `Factors:${JSON.stringify(factors)}\nJSON: { score, grade, breakdown:{}, topImprovements:[string] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ════════════════════════════════════════════════════════════════════════════
// DECK — audio / podcast
// ════════════════════════════════════════════════════════════════════════════

// POST /deck/recommend  body: { history:[string], mood, genres:[string] }
app.post('/deck/recommend', async (req, res) => {
  try {
    const { history = [], mood, genres = [] } = req.body;
    const out = await ask(
      'You are DECK, a premium audio curation AI. Return JSON only.',
      `History:${history.join(', ')} Mood:${mood} Genres:${genres.join(', ')}\nJSON: { recommendations:[{title,author,description,rssUrl,reason}] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /deck/summary  body: { title, description, transcript }
app.post('/deck/summary', async (req, res) => {
  try {
    const { title, description, transcript } = req.body;
    const content = (transcript || description || '').slice(0, 3000);
    const out = await ask(
      'You are DECK. Summarize podcast episodes into sharp briefings. Return JSON only.',
      `Episode:"${title}"\nContent:\n${content}\nJSON: { tldr, keyPoints:[string], quotes:[string], timeStamps:[{time,topic}] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ════════════════════════════════════════════════════════════════════════════
// WARDROBE — AI outfit generator
// ════════════════════════════════════════════════════════════════════════════

// POST /wardrobe/outfit  body: { items:[{name,type,color,style}], occasion, weather }
app.post('/wardrobe/outfit', async (req, res) => {
  try {
    const { items = [], occasion, weather } = req.body;
    const closet = items.map(i => `- ${i.name} (${i.type}, ${i.color}, ${i.style})`).join('\n');
    const out = await ask(
      'You are WARDROBE, a premium AI stylist. Build outfit combinations. Return JSON only.',
      `Closet:\n${closet}\nOccasion:${occasion} Weather:${weather}\nJSON: { outfits:[{name,pieces:[string],colorStory,vibe,rating}] }`,
      true
    );
    res.json(JSON.parse(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /wardrobe/analyze  body: { imageBase64 } — vision scan of clothing item
app.post('/wardrobe/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          { type: 'text', text: 'Analyze this clothing item. JSON only: { name, type, color, style, occasions:[string], pairsWith:[string] }' },
        ],
      }],
    });
    res.json(JSON.parse(result.choices[0].message.content));
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Night.inc backend online — port ${PORT}`));
