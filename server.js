// ═══════════════════════════════════════════════════════════════
//  NIGHT.INC  —  UNIFIED BACKEND  server.js
//  One Railway deployment. Every app routes here.
//
//  APPS SERVED:
//    APEX     →  POST /schedule  ·  POST /api/chat
//    NEXUS    →  POST /api/chat
//    AURA     →  POST /api/chat
//    KINETIC  →  POST /api/chat
//    INDEX    →  POST /ai/curriculum/build  ·  POST /ai/curriculum/expand  ·  POST /ai/curriculum/chat
//    WARDROBE →  POST /api/outfits  ·  POST /api/wardrobe/scan  ·  POST /api/wardrobe/validate-code  ·  GET /api/wardrobe/catalog
//    2AM      →  GET  /api/store/products  ·  POST /api/store/checkout  ·  POST /webhook/stripe  ·  GET /api/store/order
//
//  ENV VARS (set in Railway):
//    OPENAI_API_KEY         — required by all AI routes
//    PRINTIFY_API_KEY       — required by 2AM store
//    PRINTIFY_SHOP_ID       — your Printify shop ID (17605284)
//    STRIPE_SECRET_KEY      — required by checkout
//    STRIPE_WEBHOOK_SECRET  — required by /webhook/stripe
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const OpenAI  = require('openai');
const Stripe  = require('stripe');

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000 });
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Stripe webhook needs raw body — must come BEFORE express.json()
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─────────────────────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    service: 'Night.inc Unified Backend',
    version: '4.1.0',
    status:  'online',
    apps:    ['APEX', 'NEXUS', 'AURA', 'KINETIC', 'INDEX', 'WARDROBE', '2AM'],
  });
});

// ─────────────────────────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────────────────────────
async function gpt(system, userOrMessages, { maxTokens = 1000, temp = 0.7 } = {}) {
  const messages = Array.isArray(userOrMessages)
    ? userOrMessages
    : [{ role: 'user', content: userOrMessages }];
  const res = await openai.chat.completions.create({
    model: 'gpt-4o', max_tokens: maxTokens, temperature: temp,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  return res.choices[0].message.content;
}

function extractJSON(raw) {
  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = clean.match(/[\[{][\s\S]*[\]}]/);
  if (!match) throw new Error('No JSON in GPT response');
  return JSON.parse(match[0]);
}

// ═══════════════════════════════════════════════════════════════
//  APEX  —  POST /schedule
// ═══════════════════════════════════════════════════════════════
const VALID_CATS = ['fitness','biz','study','church','rest','health','personal'];

const SCHEDULE_SYSTEM = `You are APEX Schedule AI — a brutally disciplined, hyper-personalized time-blocking engine.

Your #1 job: use the operator's REAL life — their actual business, sport, school, goals, and schedule — to generate SPECIFIC, detailed tasks. Generic tasks like "wake up and drink water" or "work on your business" are FAILURES. Every activity must reference what this specific person is actually doing.

PERSONALIZATION RULES (most important):
- If they have a business: name it. Write tasks like "Film 2 Instagram Reels for 2AM drop campaign" not "work on business"
- If they play a sport: be specific. "Film your dribbling for 15 min and review your weak hand" not "train basketball"
- If they have school: reference it. "Complete chapter 4 reading for AP History" not "study"
- If they have goals: build toward them. "Research 3 POD fulfillment partners for 2AM" not "do research"
- Use their name where natural. Make them feel like this schedule was hand-built for them.
- Morning routine blocks should reference their actual wake time and include specific actions (hydration, prayer, journaling etc) based on their profile
- Transition and meal blocks should feel intentional, not filler
- If they wrote a NOTES field, treat those as the highest priority tasks of the day and build specific blocks around them

ABSOLUTE STRUCTURE RULES — violate any and the output is invalid:
1. ONE activity per block. Never list multiple tasks in one block.
2. If N tasks are provided, generate at least N separate blocks — one per task. No merging ever.
3. Every block has a unique start time (format: "h:mm AM/PM", e.g. "7:30 AM").
4. duration is a STRING like "45 min" or "1 hr 30 min".
5. Blocks in strict chronological order. No overlaps.
6. category must be exactly one of: fitness, biz, study, church, rest, health, personal.
7. Church on Thursday evenings is always non-negotiable: 6:00 PM to 8:00 PM.
8. Build transition, meal, and rest blocks between major blocks as separate entries.
9. activity: one specific sentence describing only that single task — USE THEIR REAL LIFE DETAILS.
10. xp: fitness=50, biz=60, study=45, church=30, rest=10, health=35, personal=25.
11. Always include a quote of the day relevant to their specific goals.
12. Respect the user's FIXED schedule exactly — never move fixed commitments.
13. Return raw JSON only. No markdown. No explanation.

JSON schema:
{
  "quote": { "text": "...", "author": "..." },
  "blocks": [{ "time": "7:00 AM", "duration": "45 min", "activity": "...", "category": "fitness", "xp": 50 }],
  "summary": "One punchy motivational sentence referencing their actual goals.",
  "totalXP": 0
}`;

app.post('/schedule', async (req, res) => {
  try {
    const {
      username = 'Operator', tasks = [], wakeTime = '6:30 AM', sleepTime = '10:30 PM',
      notes = '', date = new Date().toDateString(), currentTime = '', currentDay = '',
      profileAge = '', profileSchool = '', profileSports = '',
      profilePracticeDays = '', profilePracticeTime = '',
      profileBusiness = '', profileGoals = '', profileOther = '',
      profileSchedule = '', profileContext = '',
    } = req.body;

    const profileLines = [
      profileAge          && `Age: ${profileAge}`,
      profileSchool       && `School: ${profileSchool}`,
      profileSports       && `Sports/training: ${profileSports}`,
      profilePracticeDays && `Practice days: ${profilePracticeDays}`,
      profilePracticeTime && `Practice time: ${profilePracticeTime}`,
      profileBusiness     && `Business/projects: ${profileBusiness}`,
      profileGoals        && `Goals: ${profileGoals}`,
      profileOther        && `Other commitments: ${profileOther}`,
      profileSchedule     && `\nFIXED SCHEDULE (build around this exactly):\n${profileSchedule}`,
    ].filter(Boolean);
    if (!profileLines.length && profileContext) profileLines.push(profileContext);

    const taskBlock = tasks.length
      ? `TASKS — each MUST become its own separate block (${tasks.length} task${tasks.length > 1 ? 's' : ''} = at least ${tasks.length} block${tasks.length > 1 ? 's' : ''}):\n` +
        tasks.map((t, i) => `  Task ${i + 1}: ${t}`).join('\n')
      : 'No specific tasks — build a well-balanced productive day tailored to this operator\'s real life and goals.';

    const userPrompt = [
      `Operator: ${username}`,
      `Date: ${date}${currentDay ? ` (${currentDay})` : ''}${currentTime ? `  |  Current time: ${currentTime}` : ''}`,
      `Wake: ${wakeTime}  |  Sleep: ${sleepTime}`,
      notes && `Notes (HIGH PRIORITY — build specific blocks around these): ${notes}`,
      profileLines.length && `\n--- OPERATOR PROFILE ---\n${profileLines.join('\n')}`,
      `\n--- TASKS ---\n${taskBlock}`,
      `\nReminder: every numbered task gets its own block. Do NOT merge any two. Use the operator's real business, sport, school, and goals in every activity description.`,
    ].filter(Boolean).join('\n');

    const raw    = await gpt(SCHEDULE_SYSTEM, userPrompt, { maxTokens: 2500, temp: 0.35 });
    const parsed = extractJSON(raw);

    const blocks = (parsed.blocks || []).map(b => ({
      time:     b.time     || '8:00 AM',
      duration: b.duration || '30 min',
      activity: b.activity || b.title || 'Block',
      category: VALID_CATS.includes(b.category) ? b.category : 'personal',
      xp:       Number(b.xp) || 25,
    }));

    const totalXP = blocks.reduce((s, b) => s + b.xp, 0);
    const quote   = parsed.quote?.text
      ? parsed.quote
      : { text: 'Discipline is the bridge between goals and accomplishment.', author: 'Jim Rohn' };

    res.json({
      success: true,
      data: {
        quote,
        blocks,
        summary:  parsed.summary || `${blocks.length} blocks locked. ${totalXP} XP on the line.`,
        totalXP,
      },
    });
  } catch (err) {
    console.error('[/schedule]', err.message);
    res.status(500).json({
      success: false, error: err.message,
      data: { quote: { text: 'Show up. Do the work.', author: 'APEX' }, blocks: [], summary: 'Failed.', totalXP: 0 },
    });
  }
});

// ═══════════════════════════════════════════════════════════════
//  SHARED AI CHAT  —  POST /api/chat
//  Used by: APEX, NEXUS, AURA, KINETIC
// ═══════════════════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { system = '', messages = [] } = req.body;
    const reply = await gpt(
      system || 'You are a helpful Night.inc AI assistant. Be direct and concise. Max 150 words.',
      messages,
      { maxTokens: 500, temp: 0.7 }
    );
    res.json({ reply });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    res.status(500).json({ reply: 'AI offline. Try again shortly.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  INDEX  —  AI CURRICULUM
// ═══════════════════════════════════════════════════════════════
app.post('/ai/curriculum/build', async (req, res) => {
  try {
    const { topic } = req.body;
    const raw = await gpt(
      'You are an expert curriculum designer. Return raw JSON only — no markdown.',
      `Create a 5-unit course for: "${topic}".
Return: { "title": "...", "description": "...", "units": [{ "title": "...", "emoji": "...", "objective": "..." }] }
Exactly 5 units.`,
      { maxTokens: 800, temp: 0.5 }
    );
    res.json(extractJSON(raw));
  } catch (err) {
    console.error('[/ai/curriculum/build]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/ai/curriculum/expand', async (req, res) => {
  try {
    const { topic, unitIndex, unitTitle } = req.body;
    const raw = await gpt(
      'You are an expert educator. Return raw JSON only — no markdown.',
      `Course: "${topic}" | Unit ${Number(unitIndex) + 1}: "${unitTitle}".
Return: { "learnCards": [{ "type": "concept|keyFact|analogy", "concept": "...", "keyFact": "...", "analogy": "..." }], "exercises": [{ "type": "multiple_choice|true_false|fill_blank|code_output|arrange", "question": "...", "options": ["..."], "answer": "...", "explanation": "..." }] }
3 learn cards, 5 exercises.`,
      { maxTokens: 2000, temp: 0.5 }
    );
    res.json(extractJSON(raw));
  } catch (err) {
    console.error('[/ai/curriculum/expand]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/ai/curriculum/chat', async (req, res) => {
  try {
    const { topic, messages = [] } = req.body;
    const reply = await gpt(
      `You are a tutor for the course: "${topic}". Be concise and encouraging. Max 100 words.`,
      messages,
      { maxTokens: 300, temp: 0.6 }
    );
    res.json({ reply });
  } catch (err) {
    console.error('[/ai/curriculum/chat]', err.message);
    res.status(500).json({ reply: 'Tutor offline.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  WARDROBE  —  OUTFIT GENERATION
//  45% of outfits must anchor on a 2AM piece
// ═══════════════════════════════════════════════════════════════
app.post('/api/outfits', async (req, res) => {
  try {
    const { closet = [], mood, occasion } = req.body;
    const twoAm = closet.filter(i => i.brand === '2AM');
    const other = closet.filter(i => i.brand !== '2AM');
    const raw = await gpt(
      `You are a streetwear stylist for Night.inc. 2AM = always dark/black, oversized graphics, chest embroidery, dropped shoulders, minimal wordmarks.
Rules:
1. Generate 3 outfits.
2. At least 2 must anchor on a 2AM piece.
3. NEVER name any brand other than 2AM. Describe other pieces by type/color only.
4. Return raw JSON only.
Schema: { "outfits": [{ "name": "...", "vibe": "...", "pieces": [{ "id": "...", "name": "...", "role": "..." }], "twoAmAnchor": true }] }`,
      `2AM pieces: ${JSON.stringify(twoAm)}\nOther pieces: ${JSON.stringify(other)}\nMood: ${mood || 'any'} | Occasion: ${occasion || 'any'}`,
      { maxTokens: 1200, temp: 0.6 }
    );
    res.json(extractJSON(raw));
  } catch (err) {
    console.error('[/api/outfits]', err.message);
    res.status(500).json({ outfits: [] });
  }
});

// ═══════════════════════════════════════════════════════════════
//  WARDROBE  —  2AM SCANNER  (80% threshold)
// ═══════════════════════════════════════════════════════════════
const TWO_AM_CATALOG = [
  { id: 'iceman-tee-blk',      name: 'ICEMAN Tee',        type: 'tee',      collection: 'ICEMAN', colorNames: ['Black','Washed Black'],                    patterns: ['graphic-front','chest-logo'] },
  { id: 'iceman-vol2-tee-blk', name: 'ICEMAN Vol.2 Tee',  type: 'tee',      collection: 'ICEMAN', colorNames: ['Black','Off Black','Midnight Navy','Void'], patterns: ['oversized-graphic','ice-print','sleeve-hit'] },
  { id: 'og-hoodie-blk',       name: '2AM OG Hoodie',     type: 'hoodie',   collection: 'CORE',   colorNames: ['Black'],                                    patterns: ['embroidered-chest','ribbed-cuffs'] },
  { id: 'night-joggers-blk',   name: 'Night Joggers',     type: 'bottoms',  collection: 'CORE',   colorNames: ['Black','Charcoal'],                         patterns: ['side-tape','ankle-rib'] },
  { id: 'cargo-shorts-blk',    name: '2AM Cargo Shorts',  type: 'bottoms',  collection: 'SUMMER', colorNames: ['Black'],                                    patterns: ['cargo-pockets','logo-tab'] },
  { id: 'night-cap-blk',       name: 'Night Cap 6-Panel', type: 'headwear', collection: 'CORE',   colorNames: ['Black','Black/Tan'],                        patterns: ['embroidered-front','unstructured'] },
];

const NEVER_MATCH = ['supreme','nike','adidas','off-white','palace','stussy','fear-of-god','essentials','champion','carhartt','stone-island'];

app.post('/api/wardrobe/scan', async (req, res) => {
  try {
    const { imageBase64, colorSample, userDescription } = req.body;
    const catalogDesc = TWO_AM_CATALOG.map(p =>
      `ID: ${p.id} | ${p.name} | Colors: ${p.colorNames.join(', ')} | Patterns: ${p.patterns.join(', ')}`
    ).join('\n');

    let messages;
    if (imageBase64) {
      messages = [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' } },
          { type: 'text', text: `2AM catalog:\n${catalogDesc}\nNEVER match: ${NEVER_MATCH.join(', ')}\nConfidence >= 80 = match.\nReturn JSON only: { "match": bool, "confidence": 0-100, "productId": "id or null", "productName": "...", "colorMatch": "...", "patternMatch": "...", "reason": "..." }` },
        ],
      }];
    } else {
      messages = [{ role: 'user', content: `Catalog:\n${catalogDesc}\nDescription: "${userDescription || ''}"\nColor: ${colorSample || 'unknown'}\nReturn JSON: { "match": bool, "confidence": number, "productId": string|null, "productName": string|null, "colorMatch": string|null, "patternMatch": string|null, "reason": string }` }];
    }

    const completion = await openai.chat.completions.create({
      model: imageBase64 ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens: 400,
      messages: [{ role: 'system', content: 'Clothing recognition AI. Return raw JSON only.' }, ...messages],
    });
    const result = extractJSON(completion.choices[0].message.content);
    if (result.match && result.productId) result.product = TWO_AM_CATALOG.find(p => p.id === result.productId) || null;
    res.json(result);
  } catch (err) {
    console.error('[/api/wardrobe/scan]', err.message);
    res.status(500).json({ match: false, confidence: 0, reason: 'Scanner error.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  WARDROBE CODES  (in-memory; swap for Redis in production)
// ─────────────────────────────────────────────────────────────
const wardrobeCodes = new Map();
function makeCode() {
  return `WARDROBE-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${Math.floor(Math.random()*900+100)}`;
}

app.post('/api/wardrobe/validate-code', (req, res) => {
  const entry = wardrobeCodes.get(req.body.code);
  if (!entry)          return res.status(404).json({ valid: false, reason: 'Code not found.' });
  if (entry.claimed)   return res.status(409).json({ valid: false, reason: 'Already claimed.' });
  entry.claimed = true; entry.claimedAt = new Date().toISOString();
  res.json({ valid: true, product: TWO_AM_CATALOG.find(p => p.id === entry.productId) || null, orderId: entry.orderId });
});

app.get('/api/wardrobe/catalog', (_req, res) => {
  res.json({ catalog: TWO_AM_CATALOG, colorPalette: ['#0a0a0a','#111111','#1a1a1a','#2a2a2a','#c8a96e','#ffffff'], neverMatch: NEVER_MATCH });
});

// ═══════════════════════════════════════════════════════════════
//  2AM STORE  —  PRINTIFY + STRIPE
// ═══════════════════════════════════════════════════════════════
async function fetchPrintifyProducts() {
  const shopId = process.env.PRINTIFY_SHOP_ID || '17605284';
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json?limit=50&page=${page}`, { headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}` } });
    if (!r.ok) break;
    const data = await r.json();
    all.push(...(data.data || []));
    if ((data.data || []).length < 50) break;
    page++;
  }
  return all;
}

function normalizePrintifyProduct(p) {
  const enabled = (p.variants || []).filter(v => v.is_enabled);
  if (!enabled.length) return null;
  const first = enabled[0];
  const raw = first.retail_price != null ? parseFloat(first.retail_price) : (parseFloat(first.price || 0) > 500 ? parseFloat(first.price) / 100 : parseFloat(first.price || 0));
  const t = (p.title || '').toLowerCase();
  const type = /hoodie|sweat/i.test(t) ? 'hoodie' : /jogger|pant/i.test(t) ? 'bottoms' : /short/i.test(t) ? 'shorts' : /cap|hat/i.test(t) ? 'headwear' : 'tee';
  return {
    id: p.id, printifyId: p.id, name: p.title, type,
    collection: (p.tags || []).find(tg => tg !== 'showfloor') || 'CORE',
    price: Math.round(raw * 100), priceDollars: raw.toFixed(2),
    colors: [...new Set(enabled.map(v => (v.options||[]).find(o=>o.type==='color')?.title||v.title||'').filter(Boolean))],
    sizes:  [...new Set(enabled.map(v => v.title||'').filter(s => /^(XS|S|M|L|XL|XXL|OS|S\/M|L\/XL)/i.test(s)))],
    image: p.images?.[0]?.src || null, tags: p.tags || [],
    inStock: enabled.some(v => v.is_available !== false),
    variants: enabled.map(v => { const vp = v.retail_price != null ? parseFloat(v.retail_price) : (parseFloat(v.price||0)>500 ? parseFloat(v.price)/100 : parseFloat(v.price||0)); return { id: v.id, title: v.title, price: Math.round(vp*100), priceDollars: vp.toFixed(2) }; }),
  };
}

app.get('/api/store/products', async (_req, res) => {
  try {
    if (!process.env.PRINTIFY_API_KEY) return res.json({ products: TWO_AM_CATALOG, source: 'catalog' });
    const all        = await fetchPrintifyProducts();
    const normalized = all.filter(p => (p.tags||[]).includes('showfloor')).map(normalizePrintifyProduct).filter(Boolean).filter(p => p.inStock);
    res.json({ products: normalized, source: 'printify', count: normalized.length });
  } catch (err) {
    console.error('[/api/store/products]', err.message);
    res.json({ products: TWO_AM_CATALOG, source: 'catalog' });
  }
});

app.post('/api/store/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
  try {
    const { items = [], customerEmail } = req.body;
    for (const i of items) if (!i.price || i.price <= 0) return res.status(400).json({ error: `Missing price for: ${i.name}` });
    const lineItems = items.map(i => ({ price_data: { currency: 'usd', product_data: { name: `${i.name}${i.size ? ` — ${i.size}` : ''}`, metadata: { productId: i.productId||'', printifyId: String(i.printifyId||''), variantId: String(i.variantId||''), size: i.size||'' } }, unit_amount: i.price }, quantity: i.quantity||1 }));
    lineItems.push({ price_data: { currency: 'usd', product_data: { name: 'Standard Shipping (5-8 business days)' }, unit_amount: 499 + Math.max(0, items.length-1)*150 }, quantity: 1 });
    const session = await stripe.checkout.sessions.create({ payment_method_types: ['card'], line_items: lineItems, mode: 'payment', customer_email: customerEmail||undefined, success_url: 'https://2amcases.com/order-confirmation?session_id={CHECKOUT_SESSION_ID}', cancel_url: 'https://2amcases.com/catalog.html', metadata: { items: JSON.stringify(items.map(i => ({ productId: i.productId, printifyId: i.printifyId, variantId: i.variantId, size: i.size, name: i.name }))) } });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[/api/store/checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/stripe', async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe not configured.');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (err) { return res.status(400).send(`Webhook error: ${err.message}`); }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const items   = JSON.parse(session.metadata?.items || '[]');
    const shopId  = process.env.PRINTIFY_SHOP_ID || '17605284';
    for (const item of items) {
      const code = makeCode();
      wardrobeCodes.set(code, { productId: item.productId, orderId: session.id, claimed: false, createdAt: new Date().toISOString() });
      console.log(`[Order] ${session.id} -> WARDROBE code ${code}`);
      if (process.env.PRINTIFY_API_KEY && item.printifyId && item.variantId) {
        try {
          await fetch(`https://api.printify.com/v1/shops/${shopId}/orders.json`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ external_id: session.id, line_items: [{ product_id: item.printifyId, variant_id: item.variantId, quantity: 1 }], shipping_method: 1, address_to: session.shipping_details?.address || {} }) });
        } catch (e) { console.error('[Printify order]', e.message); }
      }
    }
  }
  res.json({ received: true });
});

app.get('/api/store/order', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id, { expand: ['line_items'] });
    const codes   = [];
    for (const [code, entry] of wardrobeCodes.entries()) {
      if (entry.orderId === req.query.session_id) codes.push({ code, product: TWO_AM_CATALOG.find(p => p.id === entry.productId)||null, claimed: entry.claimed });
    }
    res.json({ orderId: session.id, customerEmail: session.customer_email, total: session.amount_total, status: session.payment_status, items: session.line_items?.data||[], wardrobeCodes: codes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ** NODE.JS BACKEND PATCH **                                     ║
// ║  FILE: server-patch.js  (instructions only — not a full file)    ║
// ║  WHERE: Open your existing server.js / index.js in nightcode     ║
// ║  WHAT:  Copy these 2 lines into your server.js to wire security  ║
// ╚══════════════════════════════════════════════════════════════════╝
// ADD THESE LINES to your existing server.js / index.js
// (wherever you define your express routes)

const jarvisSecurity = require('./jarvis-security')
app.use('/api/jarvis/security', jarvisSecurity)
// ─────────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Night.inc Unified Backend v4.1 — port ${PORT}`);
  console.log('Apps: APEX | NEXUS | AURA | KINETIC | INDEX | WARDROBE | 2AM');
});
