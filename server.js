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

        const { profileContext } = req.body;
        const hasProfile = profileContext && profileContext.trim().length > 0;

        const system = `You are APEX Schedule AI — a brutally efficient personal time-blocking coach for ${username}.

${hasProfile ? `OPERATOR PROFILE (this is their actual life — build everything around this):
${profileContext}` : `OPERATOR: ${username}. No profile set up yet — build a general productive schedule.`}

SCHEDULE RULES:
- Be EXTREMELY specific. Don't say "workout" — say exact exercises, sets, reps, rest times.
- Don't say "work on project" — say exactly what file to open, what to build, what the goal is.
- Don't say "study" — say exactly what subject, what to review, what to write down.
- Every block must feel like a personal coach who knows this person wrote it. Specific. Actionable.
- Respect all fixed blocks from their profile (practice times, work, school, religious commitments).
- Include meals, snacks, transitions, and wind-down routines.
- Include a morning routine (wake, hydrate, pray/meditate if religious, breakfast, prep).
- Include an evening routine (clean up, pack for tomorrow, journal/reflect, breathe, sleep).
- Morning and evening routines should match their wake/sleep times from their profile.

Respond ONLY in this exact JSON format with no markdown, no backticks, nothing else:
{
  "blocks": [
    { "time": "6:30 AM", "duration": "2 min", "activity": "Exact specific action here", "category": "ops", "xp": 10 }
  ],
  "summary": "One brutally honest motivational sentence for today.",
  "totalXP": 500
}
Categories must be one of: fitness, study, biz, ops, rest, church.`;

        const hasNotes = notes && notes.trim().length > 0;
        const hasTasks = Array.isArray(tasks) && tasks.length > 0;

        const user = `Date: ${date || 'Today'}
Current day: ${req.body.currentDay || 'Unknown'}
Current time RIGHT NOW: ${req.body.currentTime || 'Unknown'} — build schedule from NEXT upcoming block. Skip past blocks.
Wake time: ${wakeTime || '6:00 AM'}
Sleep time: ${sleepTime || '11:00 PM'}

${hasTasks ? `ACTIVE MISSIONS (schedule these as dedicated blocks):\n${tasks.map((t, i) => `${i+1}. ${t}`).join('\n')}` : 'No active missions.'}

${hasNotes ? `OPERATOR PRIORITY OVERRIDE — MANDATORY. Build the schedule around these. Create dedicated detailed blocks for each:
"${notes}"
These override the default protocol where needed.` : 'No priority overrides — follow standard Batman Protocol.'}

Build the full day. Every block must be extremely specific with exact actions.`;

        const raw = await chat(system, user, 4000);
        let cleaned = raw.replace(/```json|```/g, '').trim();
        // If JSON is truncated, close it gracefully
        try {
            const parsed = JSON.parse(cleaned);
            res.json({ success: true, data: parsed });
        } catch (parseErr) {
            // Try to salvage truncated JSON by closing open structures
            console.error('SCHEDULE PARSE ERROR, attempting repair:', parseErr.message);
            console.error('RAW:', cleaned.slice(0, 500));
            res.status(500).json({ success: false, error: 'JSON truncated: ' + parseErr.message });
        }
    } catch (err) {
        console.error('SCHEDULE ERROR:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── FITNESS ───────────────────────────────────────────────────
app.post('/fitness', async (req, res) => {
    try {
        const { username, focus, daysAvailable, injuries } = req.body;

        const system = `You are APEX Fitness AI — the personal training system for ${username}, a 13-year-old athlete under the BATMAN PROTOCOL.

CRITICAL CONTEXT:
- Basketball practice: Tue 4:20-6:15PM, Wed 3:10-6:15PM (longest day), Thu 4:20-6:15PM at the Orlando Magic Rec Center.
- Monday workout: Upper Body + Boxing. No practice.
- Friday workout: Full Body + Boxing. No practice.
- Saturday: Solo rec session (ball handling, layups, shooting, defense, conditioning).
- Sunday: Light workout only. Active recovery.
- Wednesday is the hardest day. Body needs extra recovery Thursday.

EXACT WORKOUT PROTOCOLS TO FOLLOW:

MONDAY — UPPER BODY:
Warmup: arm circles, shoulder rolls 2 min.
Push-ups: 4x15 (chest to floor, full range), Pike push-ups: 3x12 (hips up, head down), Dips on chair: 3x10 (elbows back, lower slow, push fast), Bicep curls: 3x12 (squeeze at top, lower slow), Plank: 3x45 sec (straight line, hips level, breathe). Cool down: chest and shoulder stretch 3 min.

FRIDAY — FULL BODY:
Warmup: jumping jacks, high knees 2 min.
Squats: 4x15 (full depth, chest up, knees out), Push-ups: 3x15, Lunges: 3x12 each leg (back knee to floor), Burpees: 3x10 (jump up, drop down, push up, jump up), Mountain climbers: 3x30 sec (fast feet, hips level, core tight), Plank: 3x45 sec. Cool down: full body stretch 3 min.

BASKETBALL PRACTICE PROTOCOL (Tue/Wed/Thu):
Warmup 5 min: 3 laps jog, arm circles x10, leg swings x10 each, high knees x2, butt kicks x2, defensive slide x2.
Ball handling 15 min: right hand stationary 45sec, left hand 45sec, crossover 1min, between legs 1min, behind back 1min, figure 8 1min, two ball 1min, full court right x2, full court left x2, full court crossover every 3 steps x2.
Layups 15 min: right walk x10 makes, left walk x10, right jog x10, left jog x10, right full speed x10, left full speed x10, euro step x5 each, floater x10, reverse x5 each.
Shooting 20 min: form shooting 3ft one hand x20, close range both hands x15 each spot, free throws x15 makes (same routine every shot), mid range pull up x10 each side, step back 3pt x10, catch and shoot x20.
Defense 10 min: stance hold 1min, slides full court x4, closeout x10, contest shot x10.
Conditioning 10 min: baseline to baseline x5, suicides x3, slides x4, cool down jog x2.

SATURDAY SOLO REC:
Same full protocol as practice. Eyes UP on all dribbling. Get makes not attempts. Push hard on conditioning — this is where you separate yourself.

SUNDAY: Walk, jog, stretch, or light bodyweight only. 20-30 min. Active recovery.

Be EXTREMELY specific. Every exercise needs exact sets, reps, rest time, and a coaching note on form. Sound like a drill sergeant who knows this athlete personally.

Respond ONLY in this exact JSON format with no markdown, no backticks, nothing else:
{
  "plan": [
    {
      "day": "Monday",
      "focus": "Upper Body + Boxing",
      "warmup": "Arm circles forward and back x10 each direction, shoulder rolls x10 each direction — 2 minutes",
      "exercises": [
        { "name": "Push-ups", "sets": 4, "reps": "15", "rest": "60s", "notes": "Chest to floor. Full range. No cheating. If you half-rep it, start the set over." }
      ],
      "cooldown": "Chest stretch 45 sec each side, shoulder cross-body stretch 45 sec each side — 3 minutes total",
      "duration": "45 min",
      "xp": 150
    }
  ],
  "weeklyXP": 900,
  "tip": "One brutally specific performance tip for this athlete this week."
}`;

        const user = `Athlete focus: ${focus || 'Basketball and Boxing'}
Available days: ${daysAvailable || 'Mon, Tue, Thu, Fri, Sat'}
Injuries/limitations: ${injuries || 'None'}
Generate this week's full training plan.`;

        const raw = await chat(system, user, 4000);
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

        const system = `You are APEX Finance AI — the personal financial advisor for ${username}, a 13-year-old entrepreneur running NOCTIS streetwear under the BATMAN PROTOCOL.

CRITICAL CONTEXT:
- NOCTIS product prices: graphic tee $32, logo tee $28, hoodie $60, sweatpants $55, set $105, beanie $22, stickers $8.
- Uses Bella+Canvas blanks. Screen printing and DTF transfers.
- Payments via Square. Domain: noctis.fit.
- Money split rule (split THE SAME DAY money comes in): 80% NOCTIS reinvestment, 8% investing (do not touch), 7% savings (do not touch), 3% tools, 2% personal.
- Cash App for NOCTIS inbound revenue. Step for saving/investing/spending.
- Self-employed — must track income for taxes.
- 5-year plan: financial freedom, legacy, F1 team, tech company, location-independent lifestyle traveling the Americas.

Give brutally honest, specific, actionable financial advice in 4-6 sentences. Reference their actual numbers and NOCTIS context. Tell them exactly what to do with their money right now. No generic advice. Speak to a serious entrepreneur who happens to be 13 — not a child.`;

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
