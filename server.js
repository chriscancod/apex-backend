const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({ status: 'APEX_BACKEND_ONLINE', version: '2.0' });
});

// ── ORIGINAL ROUTE (kept) ─────────────────────────────────────
app.post('/ai', (req, res) => {
    const { message, username } = req.body;
    console.log(`LOG // INCOMING: ${message} FROM: ${username}`);
    const reply = `SYSTEM // Command "${message}" received, Operator ${username || 'CHRIS'}. APEX V11 is operating in stable mode.`;
    res.status(200).json({ response: reply });
});

// ── SHARED GPT HELPER ─────────────────────────────────────────
async function chat(systemPrompt, userPrompt, maxTokens = 600) {
    const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: maxTokens,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    });
    return res.choices[0].message.content;
}

// ── SCHEDULE ──────────────────────────────────────────────────
app.post('/schedule', async (req, res) => {
    try {
        const { username, tasks, date, wakeTime, sleepTime, notes } = req.body;

        const system = `You are APEX Schedule AI — a brutally efficient time-blocking system for ${username}, a 13-year-old self-taught entrepreneur and athlete.
They run a streetwear brand (NOCTIS), build iOS apps, train basketball and boxing, and attend church every Thursday evening (non-negotiable block 6-8PM).
Respond ONLY in this exact JSON format with no markdown, no backticks, nothing else:
{
  "blocks": [
    { "time": "6:00 AM", "duration": "30 min", "activity": "Morning Protocol", "category": "fitness", "xp": 50 }
  ],
  "summary": "One sentence motivational summary",
  "totalXP": 500
}
Categories must be one of: fitness, study, biz, ops, rest, church.`;

        const user = `Date: ${date || 'Today'}
Wake time: ${wakeTime || '6:00 AM'}
Sleep time: ${sleepTime || '11:00 PM'}
Tasks to fit in: ${Array.isArray(tasks) && tasks.length > 0 ? tasks.join(', ') : 'None specified'}
Notes: ${notes || 'None'}
Build the optimal schedule.`;

        const raw = await chat(system, user, 1000);
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        res.json({ success: true, data: parsed });
    } catch (err) {
        console.error('SCHEDULE ERROR:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── FITNESS ───────────────────────────────────────────────────
app.post('/fitness', async (req, res) => {
    try {
        const { username, focus, daysAvailable, injuries } = req.body;

        const system = `You are APEX Fitness AI — a high-performance training system for ${username}, a 13-year-old athlete training basketball and boxing.
Respond ONLY in this exact JSON format with no markdown, no backticks, nothing else:
{
  "plan": [
    {
      "day": "Monday",
      "focus": "Basketball + Explosiveness",
      "warmup": "5 min jump rope",
      "exercises": [
        { "name": "Box Jumps", "sets": 4, "reps": "8", "rest": "60s", "notes": "Max height" }
      ],
      "cooldown": "10 min stretch",
      "duration": "60 min",
      "xp": 150
    }
  ],
  "weeklyXP": 800,
  "tip": "One performance tip"
}`;

        const user = `Athlete focus: ${focus || 'Basketball and Boxing'}
Available days: ${daysAvailable || 'Mon, Tue, Thu, Fri, Sat'}
Injuries/limitations: ${injuries || 'None'}
Generate this week's full training plan.`;

        const raw = await chat(system, user, 1200);
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        res.json({ success: true, data: parsed });
    } catch (err) {
        console.error('FITNESS ERROR:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── FINANCE ADVICE ────────────────────────────────────────────
app.post('/finance/advice', async (req, res) => {
    try {
        const { username, totalBalance, splits, recentTransactions, question } = req.body;

        const system = `You are APEX Finance AI — a direct, no-BS financial advisor for ${username}, a 13-year-old entrepreneur running NOCTIS streetwear.
Money split: 80% NOCTIS reinvestment, 8% investing, 7% savings, 3% tools, 2% personal.
Give brutally honest, actionable advice in 4-6 sentences max. Speak to an entrepreneur, not a kid.`;

        const user = `Total balance: $${totalBalance || 0}
Splits: ${JSON.stringify(splits) || 'Not set up'}
Recent transactions: ${Array.isArray(recentTransactions) ? recentTransactions.map(t => `${t.label} $${t.amount}`).join(', ') : 'None'}
Question: ${question || 'How am I doing? What should I focus on?'}`;

        const advice = await chat(system, user, 300);
        res.json({ success: true, advice });
    } catch (err) {
        console.error('FINANCE ADVICE ERROR:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── FINANCE SPLIT ─────────────────────────────────────────────
app.post('/finance/split', (req, res) => {
    try {
        const amt = parseFloat(req.body.amount);
        if (isNaN(amt) || amt <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }
        res.json({
            success: true,
            splits: {
                noctis:    parseFloat((amt * 0.80).toFixed(2)),
                investing: parseFloat((amt * 0.08).toFixed(2)),
                savings:   parseFloat((amt * 0.07).toFixed(2)),
                tools:     parseFloat((amt * 0.03).toFixed(2)),
                personal:  parseFloat((amt * 0.02).toFixed(2))
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`APEX_STABLE_ONLINE // PORT ${PORT}`));
