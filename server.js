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

// Twilio — only if configured
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const callScripts   = {};
const callLog       = {};
let screenerEnabled = false;

// ─── Model tiers ─────────────────────────────────────────────────────────────
// CHEAP  = gpt-4o-mini  ~$0.00015/1K input  — used for short/simple tasks
// NORMAL = gpt-4o-mini  same, with higher token ceiling for curriculum
// Only use gpt-4o for things that genuinely need it (nothing here does)

const CHEAP  = 'gpt-4o-mini';
const NORMAL = 'gpt-4o-mini';

async function ask(system, user, json = false, maxTokens = 500, model = CHEAP) {
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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function requireTwilio(res) {
  if (!twilioClient) {
    res.status(503).json({ error: 'Twilio not configured.' });
    return false;
  }
  return true;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({
  status: 'NIGHT_INC_ONLINE',
  apps: ['APX', 'INDEX', 'NEXUS'],
  model: CHEAP,
  twilio: twilioClient ? 'configured' : 'not configured',
}));


// ══════════════════════════════════════════════════════════════════════════════
// APX — POST /schedule
// Switched to mini. Trimmed prompt. Cut token limit 3000→1500.
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

    // Trim profileContext to 300 chars max to save tokens
    const profile = profileContext
      ? `\nPROFILE:\n${profileContext.slice(0, 300)}`
      : '';

    // Limit tasks to 10
    const taskList = tasks.slice(0, 10).length
      ? tasks.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')
      : 'General high-performance day.';

    const out = await ask(
      `You are APEX AI, a daily scheduler for a high-performance teen.
Build a time-blocked schedule between wake and sleep. Respect fixed commitments.
Categories: ops, fitness, study, biz, church, rest.
Return ONLY valid JSON.

ACTIVITY RULES — always specific, never vague:
- fitness: "Push-ups 4x15, Pull-ups 3x8, Dips 3x12, Plank 3x60s"
- study: "Chapter 5 — read pp.82-94, complete exercises 5.1-5.15"
- biz: "Write 3 product descriptions, reply to 5 DMs, schedule 2 posts"
- ops: "Pack gym bag, prep meals, charge devices, clean workspace"
- rest: "No screens. Foam roll 10min, read 20 pages, journal 3 wins"`,

      `${username} | ${date} ${currentDay} | Wake:${wakeTime} Sleep:${sleepTime}
Notes:${notes||'none'}${profile}
Tasks:
${taskList}

JSON:
{"success":true,"data":{"summary":"<theme of day>","totalXP":<total>,"blocks":[{"time":"<h:mm AM/PM>","duration":"<X min>","activity":"<SPECIFIC — exact exercises/tasks>","category":"<ops|fitness|study|biz|church|rest>","xp":<50-300>}]}}

Rules: full day no gaps, blocks 30-120min, totalXP 800-2000, activity always specific.`,
      true,
      1500,
      CHEAP
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// APX — finance (mini, 300 tokens max)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/apx/finance/advice', async (req, res) => {
  try {
    const { message = '', entries = [] } = req.body;
    const log = entries.slice(0, 10).map(e => `${e.type}: $${e.amount} (${e.label})`).join('\n');
    const reply = await ask(
      'APX finance advisor for a teen entrepreneur. Be direct and specific — actual numbers, real action steps. Under 100 words.',
      `Log:\n${log||'none'}\nQuestion: ${message}`,
      false, 300, CHEAP
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
// INDEX — POST /ai/curriculum/build
// Biggest cost savings: mini model + content capped at 120 words + 3000 tokens
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
      style === 'practical'   ? 'Include real code examples with explanations.' :
      style === 'theoretical' ? 'Focus on concepts, mental models, analogies.' :
                                'Each lesson builds toward a real finished project.';

    const depthGuide =
      depth === 'beginner'     ? 'Assume zero prior knowledge. Plain language.' :
      depth === 'intermediate' ? 'Assume basics. Go deeper on mechanics and edge cases.' :
                                 'Assume strong base. Advanced patterns and production concerns.';

    const count = Math.min(Math.max(parseInt(lesson_count) || 5, 1), 10);

    const out = await ask(
      `You are INDEX, an expert curriculum builder. ${styleGuide} ${depthGuide}
Return ONLY valid JSON — no markdown, no backticks, completely parseable.
Keep lesson content under 120 words — dense and educational, not padded.`,

      `Build a ${count}-lesson curriculum on: "${topic}"

JSON shape (required exactly):
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
      true,
      4000,
      NORMAL
    );

    res.json(JSON.parse(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// INDEX — POST /ai/curriculum/chat
// Mini, 400 tokens max — chat doesn't need much
// ══════════════════════════════════════════════════════════════════════════════

app.post('/ai/curriculum/chat', async (req, res) => {
  try {
    const { message = '', lesson_context = '', topic = '' } = req.body;
    const reply = await ask(
      `Expert tutor for "${topic}". Lesson: ${lesson_context.slice(0, 400)}
Be clear, specific, use code when relevant. Max 80 words.`,
      message,
      false,
      400,
      CHEAP
    );
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// NEXUS — POST /api/chat
// AIEngine.send() — AI tab, home tip, idea plans, script gen
// Mini, 500 tokens
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  try {
    const { system = '', messages = [] } = req.body;

    // Limit conversation history to last 6 messages to save tokens
    const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));

    const completion = await openai.chat.completions.create({
      model: CHEAP,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system.slice(0, 600) }, // cap system prompt
        ...history,
      ],
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// NEXUS AUTOMATE — Twilio endpoints (no AI cost, just Twilio cost)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/call/outbound', async (req, res) => {
  if (!requireTwilio(res)) return;
  try {
    const { to, name = '', script = '' } = req.body;
    if (!to) return res.status(400).json({ error: 'Missing "to" phone number.' });
    callScripts[to] = script || `Hello ${name||'there'}, automated message from ${process.env.BUSINESS_NAME||'our business'}. Please call us back. Thank you!`;
    const BASE = process.env.BASE_URL || `https://localhost:${PORT}`;
    const call = await twilioClient.calls.create({
      to, from: process.env.TWILIO_PHONE_NUMBER,
      url: `${BASE}/call/twiml?to=${encodeURIComponent(to)}`,
      statusCallback: `${BASE}/call/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated','ringing','answered','completed'],
    });
    callLog[call.sid] = { status: call.status, to, name, duration: 0 };
    res.json({ callSid: call.sid, status: call.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/call/twiml', (req, res) => {
  const { to = '' } = req.query;
  const script = callScripts[to] || 'Hello, automated message. Please call us back. Thank you!';
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew-Neural">${escapeXml(script)}</Say>
  <Pause length="2"/>
  <Say voice="Polly.Matthew-Neural">To speak with us, please call back. Have a great day!</Say>
</Response>`);
});

app.post('/call/status', (req, res) => {
  const { CallSid, CallStatus, CallDuration, To } = req.body;
  if (CallSid) {
    callLog[CallSid] = { ...(callLog[CallSid]||{}), status: CallStatus||'unknown', duration: CallDuration||0, to: To };
    if (['completed','failed','no-answer','busy','canceled'].includes(CallStatus) && callScripts[To]) delete callScripts[To];
  }
  res.sendStatus(200);
});

app.get('/call/status/:sid', async (req, res) => {
  const { sid } = req.params;
  if (callLog[sid]) return res.json({ sid, ...callLog[sid] });
  if (!requireTwilio(res)) return;
  try {
    const call = await twilioClient.calls(sid).fetch();
    res.json({ sid, status: call.status, duration: call.duration, to: call.to });
  } catch (e) { res.status(404).json({ error: 'Call not found', sid }); }
});

app.get('/call/queue', async (req, res) => {
  if (!requireTwilio(res)) return;
  try {
    const calls = await twilioClient.calls.list({ limit: 20 });
    res.json(calls.map(c => ({ sid: c.sid, status: c.status, to: c.to, name: callLog[c.sid]?.name||'', duration: c.duration })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/sms/send', async (req, res) => {
  if (!requireTwilio(res)) return;
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing "to" or "message".' });
    const msg = await twilioClient.messages.create({ to, from: process.env.TWILIO_PHONE_NUMBER, body: message });
    res.json({ smsSid: msg.sid, status: msg.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/inbound/config', (req, res) => {
  screenerEnabled = Boolean(req.body.enabled);
  res.json({ enabled: screenerEnabled });
});

app.post('/inbound/voice', (req, res) => {
  const BASE    = process.env.BASE_URL || `https://localhost:${PORT}`;
  const bizName = escapeXml(process.env.BUSINESS_NAME || 'our business');
  if (!screenerEnabled) {
    const real = process.env.YOUR_REAL_NUMBER;
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>${real ? `<Dial>${escapeXml(real)}</Dial>` : `<Say voice="Polly.Matthew-Neural">Thanks for calling ${bizName}. Please call back or text us.</Say>`}</Response>`);
  }
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${BASE}/inbound/screen" method="POST" timeout="10" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Matthew-Neural">Hey, you reached ${bizName}. Who is calling and what is this about?</Say>
  </Gather>
  <Say voice="Polly.Matthew-Neural">Did not catch that. Please text us. Thanks!</Say>
</Response>`);
});

// Inbound screener — uses mini with 10 token limit, basically free
app.post('/inbound/screen', async (req, res) => {
  const callerSpeech = req.body.SpeechResult || '';
  const caller       = req.body.From || 'unknown';
  let verdict = 'IGNORE';
  try {
    const decision = await openai.chat.completions.create({
      model: CHEAP,
      max_tokens: 5, // intentionally tiny — only need REAL_LEAD or IGNORE
      messages: [
        { role: 'system', content: 'Reply ONLY "REAL_LEAD" or "IGNORE". REAL_LEAD = real customer/inquiry. IGNORE = spam/unclear.' },
        { role: 'user',   content: `Caller: "${callerSpeech.slice(0, 100)}"` },
      ],
    });
    verdict = decision.choices[0].message.content.includes('REAL_LEAD') ? 'REAL_LEAD' : 'IGNORE';
  } catch (_) { verdict = 'REAL_LEAD'; }

  if (verdict === 'REAL_LEAD' && twilioClient && process.env.YOUR_REAL_NUMBER) {
    try {
      await twilioClient.messages.create({
        to: process.env.YOUR_REAL_NUMBER,
        from: process.env.TWILIO_PHONE_NUMBER,
        body: `🔔 NEXUS: Call from ${caller}. Said: "${callerSpeech.slice(0, 100)}". Call back if interested.`,
      });
    } catch (_) {}
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="Polly.Matthew-Neural">Got it! The team has been notified. Have a great day!</Say></Response>`);
  }

  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="Polly.Matthew-Neural">Thanks for calling. Have a great day!</Say></Response>`);
});


// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Night.inc backend → port ${PORT}`));
