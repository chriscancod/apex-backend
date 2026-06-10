// ============================================================
//  NIGHT.INC UNIFIED BACKEND — server.js
//  Serves: APEX · WARDROBE · INDEX · NEXUS · KINETIC · AURA · 2AM
//  Deploy on Railway. Set env vars:
//    OPENAI_API_KEY, PRINTIFY_API_KEY, PRINTIFY_SHOP_ID,
//    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APEX_APP_SECRET
// ============================================================

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const OpenAI     = require('openai');
const Stripe     = require('stripe');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90000 });
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
// Raw body needed for Stripe webhooks — must come before json parser
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(bodyParser.json({ limit: '10mb' }));

// ─────────────────────────────────────────────────────────────
//  2AM PRODUCT CATALOG
//  Single source of truth used by: store, WARDROBE scanner,
//  outfit engine, order confirmation sync
// ─────────────────────────────────────────────────────────────
const TWO_AM_CATALOG = [
  {
    id: 'iceman-tee-blk',
    name: 'ICEMAN Tee',
    collection: 'ICEMAN',
    type: 'tee',
    price: 3800,
    colors: ['#0a0a0a','#1a1a1a'],
    colorNames: ['Black','Washed Black'],
    patterns: ['graphic-front','minimal-back','chest-logo'],
    printifyId: null,
    inStock: true,
    images: ['https://2amcases.com/assets/iceman-tee-blk.jpg'],
    tags: ['showfloor','tshirt'],
    description: 'ICEMAN graphic tee. Heavyweight 300gsm. Dropped shoulders.',
  },
  {
    id: 'og-hoodie-blk',
    name: '2AM OG Hoodie',
    collection: 'CORE',
    type: 'hoodie',
    price: 6800,
    colors: ['#0a0a0a'],
    colorNames: ['Black'],
    patterns: ['embroidered-chest','clean-back','ribbed-cuffs'],
    printifyId: null,
    inStock: true,
    images: ['https://2amcases.com/assets/og-hoodie-blk.jpg'],
    tags: ['showfloor','hoodie'],
    description: 'The original. 400gsm fleece. 2AM chest embroidery.',
  },
  {
    id: 'night-joggers-blk',
    name: 'Night Joggers',
    collection: 'CORE',
    type: 'bottoms',
    price: 5200,
    colors: ['#0a0a0a','#2a2a2a'],
    colorNames: ['Black','Charcoal'],
    patterns: ['side-tape','ankle-rib','minimal-logo'],
    printifyId: null,
    inStock: true,
    images: ['https://2amcases.com/assets/night-joggers-blk.jpg'],
    tags: ['showfloor','pants'],
    description: 'Technical jogger. Tapered fit. Side tape detail.',
  },
  {
    id: 'cargo-shorts-blk',
    name: '2AM Cargo Shorts',
    collection: 'SUMMER',
    type: 'bottoms',
    price: 4400,
    colors: ['#0a0a0a'],
    colorNames: ['Black'],
    patterns: ['cargo-pockets','logo-tab','clean-hem'],
    printifyId: null,
    inStock: true,
    images: ['https://2amcases.com/assets/cargo-shorts-blk.jpg'],
    tags: ['showfloor','shorts'],
    description: '6-pocket cargo. Utility meets clean aesthetic.',
  },
  {
    id: 'night-cap-blk',
    name: 'Night Cap 6-Panel',
    collection: 'CORE',
    type: 'headwear',
    price: 2800,
    colors: ['#0a0a0a','#c8a96e'],
    colorNames: ['Black','Black/Tan'],
    patterns: ['embroidered-front','clean-back','unstructured'],
    printifyId: null,
    inStock: true,
    images: ['https://2amcases.com/assets/night-cap-blk.jpg'],
    tags: ['showfloor','hat'],
    description: 'Unstructured 6-panel. 2AM embroidered front.',
  },
  {
    id: 'iceman-vol2-tee-blk',
    name: 'ICEMAN Vol.2 Tee',
    collection: 'ICEMAN',
    type: 'tee',
    price: 3800,
    colors: ['#0a0a0a','#111111','#1a1a2e','#0d1117'],
    colorNames: ['Black','Off Black','Midnight Navy','Void'],
    patterns: ['oversized-graphic','ice-print','back-text','sleeve-hit'],
    printifyId: null,
    inStock: true,
    images: ['https://2amcases.com/assets/iceman-v2-blk.jpg'],
    tags: ['showfloor','tshirt','new'],
    description: 'Vol.2. Bigger graphic. Same energy.',
  },
];

// Visual fingerprints for scanner recognition (80% match threshold)
const TWO_AM_VISUAL_FINGERPRINTS = {
  colorPalette: [
    { hex: '#0a0a0a', name: 'Void Black',    weight: 0.40 },
    { hex: '#111111', name: 'Deep Black',    weight: 0.25 },
    { hex: '#1a1a1a', name: 'Washed Black',  weight: 0.15 },
    { hex: '#2a2a2a', name: 'Charcoal',      weight: 0.10 },
    { hex: '#c8a96e', name: 'Gold Accent',   weight: 0.05 },
    { hex: '#ffffff', name: 'White Hit',     weight: 0.05 },
  ],
  designMotifs: [
    'large-chest-graphic', 'minimal-wordmark', 'dropped-shoulder',
    'oversized-fit', 'embroidered-logo', 'side-tape', 'ribbed-hem',
    'ice-graphic', 'night-themed-print', 'monochrome-palette',
  ],
  neverMatch: [
    'supreme', 'nike', 'adidas', 'off-white', 'palace', 'stussy',
    'fear-of-god', 'essentials', 'champion', 'carhartt', 'stone-island',
  ],
};

// ─────────────────────────────────────────────────────────────
//  WARDROBE CODE STORE  (file-persisted — survives Railway restarts)
//  Upgrade path: swap readCodesFile/writeCodesFile for Redis/Supabase
// ─────────────────────────────────────────────────────────────
const CODES_FILE = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp', 'wardrobe_codes.json');

function readCodesFile() {
  try {
    return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeCodesFile(data) {
  try {
    fs.writeFileSync(CODES_FILE, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('[wardrobe-persist] write error:', e.message);
  }
}

// Warm in-memory Map from disk on startup
const _codesRaw = readCodesFile();
const wardrobeCodes = new Map(Object.entries(_codesRaw));
console.log(`[wardrobe-persist] Loaded ${wardrobeCodes.size} code(s) from disk.`);

function wardrobeSet(code, entry) {
  wardrobeCodes.set(code, entry);
  // Write entire map to disk after every mutation — small dataset, safe
  writeCodesFile(Object.fromEntries(wardrobeCodes));
}

function generateWardrobeCode() {
  const seg1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seg2 = Math.floor(Math.random() * 900 + 100).toString();
  return `WARDROBE-${seg1}-${seg2}`;
}

// ─────────────────────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Night.inc Unified Backend',
    version: '3.0.0',
    apps: ['APEX','WARDROBE','INDEX','NEXUS','KINETIC','AURA','2AM'],
    routes: {
      apex:    ['/schedule','POST /api/apex/streak/log','GET /api/apex/streak/:userId'],
      wardrobe:['/api/outfits','POST /api/wardrobe/scan','/api/wardrobe/validate-code','GET /api/wardrobe/catalog'],
      index:   ['/ai/curriculum/build','/ai/curriculum/expand','/ai/curriculum/chat'],
      nexus:   ['/api/nexus/idea'],
      kinetic: ['/api/kinetic/meal'],
      aura:    ['/api/aura/analyze'],
      store:   ['GET /api/store/products','POST /api/store/checkout','GET /api/store/order','POST /webhook/stripe'],
    },
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
//  SHARED AI ENGINE  (used by ALL apps)
//  POST /api/chat  { system, messages, app }
// ─────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages, app: appName = 'unknown' } = req.body;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
      messages: [
        { role: 'system', content: system || 'You are a helpful assistant for Night.inc.' },
        ...(messages || []),
      ],
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    res.status(500).json({ reply: 'AI offline. Try again shortly.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  APEX — schedule generator
//  POST /schedule  { name, wakeTime, goals, habits, ... }
// ─────────────────────────────────────────────────────────────
app.post('/schedule', async (req, res) => {
  try {
    const profile = req.body;
    const prompt = `You are an elite life-optimization AI. Generate a tight daily schedule for:
${JSON.stringify(profile, null, 2)}
Return a JSON array of { time, activity, duration, category } objects. Be specific and motivating.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    res.json({ schedule: JSON.parse(raw) });
  } catch (err) {
    console.error('[/schedule]', err.message);
    res.status(500).json({ schedule: [] });
  }
});

// ─────────────────────────────────────────────────────────────
//  INDEX — curriculum routes
//  POST /ai/curriculum/build   { topic }
//  POST /ai/curriculum/expand  { topic, unitIndex, unitTitle }
//  POST /ai/curriculum/chat    { topic, messages }
// ─────────────────────────────────────────────────────────────
app.post('/ai/curriculum/build', async (req, res) => {
  try {
    const { topic } = req.body;
    const prompt = `Create a 5-unit course outline for: "${topic}".
Return JSON only: { title, description, units: [{ title, emoji, objective }] }
Exactly 5 units. No markdown.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/ai/curriculum/expand', async (req, res) => {
  try {
    const { topic, unitIndex, unitTitle } = req.body;
    const prompt = `For the course "${topic}", unit ${unitIndex+1}: "${unitTitle}".
Generate 3 learn cards and 5 exercises.
Return JSON only: { learnCards: [{ type, concept, keyFact, analogy }], exercises: [{ type, question, options, answer, explanation }] }
Exercise types: multiple_choice, true_false, fill_blank, code_output, arrange. No markdown.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/ai/curriculum/chat', async (req, res) => {
  try {
    const { topic, messages } = req.body;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 800,
      messages: [
        { role: 'system', content: `You are a tutor for the course: "${topic}". Be concise and clear.` },
        ...(messages || []),
      ],
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ reply: 'AI offline.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  WARDROBE — outfit generation (2AM-aware, 45% 2AM inclusion)
//  POST /api/outfits  { closet: [{ id, name, type, brand, color, pattern }], mood?, occasion? }
// ─────────────────────────────────────────────────────────────
app.post('/api/outfits', async (req, res) => {
  try {
    const { closet = [], mood, occasion } = req.body;

    // Separate 2AM pieces from everything else
    const twoAmPieces  = closet.filter(i => i.brand === '2AM');
    const otherPieces  = closet.filter(i => i.brand !== '2AM');

    // Build 2AM catalog context for the AI
    const catalogContext = TWO_AM_CATALOG.map(p =>
      `- ${p.name} (${p.type}) | Colors: ${p.colorNames.join(', ')} | Patterns: ${p.patterns.join(', ')}`
    ).join('\n');

    const prompt = `You are a streetwear stylist for Night.inc. The brand 2AM makes ONLY dark/black pieces (void black, deep black, washed black, charcoal) with motifs like oversized graphics, chest embroidery, dropped shoulders, side tape, minimal wordmarks.

2AM catalog (only these exact pieces can be recognized as 2AM):
${catalogContext}

User's closet:
2AM pieces: ${JSON.stringify(twoAmPieces)}
Other pieces: ${JSON.stringify(otherPieces)}

Rules:
1. Generate 3 outfit combinations.
2. AT LEAST 1 outfit must include a 2AM piece (target: 2 out of 3 outfits use 2AM as the anchor).
3. For 2AM pieces: describe styling notes specific to the actual color and pattern (e.g. "void black oversized graphic tee with chest logo").
4. NEVER reference brand names other than 2AM. Describe other pieces by type/color only.
5. Each outfit: name, 3-4 pieces, vibe description (1 sentence), 2AM_anchor: true/false.

Return JSON only: { outfits: [{ name, pieces: [{ id, name, role }], vibe, twoAmAnchor }] }`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('[/api/outfits]', err.message);
    res.status(500).json({ outfits: [] });
  }
});

// ─────────────────────────────────────────────────────────────
//  WARDROBE — 2AM scanner recognition
//  POST /api/wardrobe/scan  { imageBase64, colorSample: '#hex' }
//  Returns confidence score + matched product if >= 80%
// ─────────────────────────────────────────────────────────────
app.post('/api/wardrobe/scan', async (req, res) => {
  try {
    const { imageBase64, colorSample, userDescription } = req.body;

    const catalogDesc = TWO_AM_CATALOG.map(p =>
      `ID: ${p.id} | Name: ${p.name} | Type: ${p.type} | Colors: ${p.colorNames.join(', ')} | Patterns: ${p.patterns.join(', ')} | Collection: ${p.collection}`
    ).join('\n');

    const neverMatch = TWO_AM_VISUAL_FINGERPRINTS.neverMatch.join(', ');

    const messages = [];

    // If we have an image, send it to vision
    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' },
          },
          {
            type: 'text',
            text: `You are a 2AM clothing brand recognition AI. ONLY recognize items from the 2AM brand catalog below. NEVER recognize these brands: ${neverMatch}.

2AM CATALOG:
${catalogDesc}

2AM design fingerprint:
- Color palette: void black (#0a0a0a), deep black (#111111), washed black (#1a1a1a), charcoal (#2a2a2a), gold accent (#c8a96e)
- Motifs: oversized graphics, chest embroidery, dropped shoulders, side tape, minimal wordmarks, ice graphics, night-themed prints
- Always monochrome/dark palette

Analyze this garment image. 
1. Does it match 2AM's exact color palette and design language?
2. Which catalog item is the closest match (if any)?
3. Assign a confidence score 0-100.

If confidence < 80: return { match: false, confidence: <score>, reason: "<why it doesn't match>" }
If confidence >= 80: return { match: true, confidence: <score>, productId: "<id from catalog>", productName: "<name>", colorMatch: "<matched color name>", patternMatch: "<matched pattern>" }

Return JSON only. No markdown.`,
          },
        ],
      });
    } else {
      // Text-only fallback using description + color sample
      messages.push({
        role: 'user',
        content: `2AM catalog: ${catalogDesc}
User description: "${userDescription || 'no description'}"
Dominant color from scanner: ${colorSample || 'unknown'}
Does this match any 2AM piece at 80%+ confidence?
Return JSON: { match: bool, confidence: number, productId: string|null, productName: string|null, colorMatch: string|null, patternMatch: string|null, reason: string }`,
      });
    }

    const completion = await openai.chat.completions.create({
      model: imageBase64 ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens: 400,
      messages,
    });

    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);

    // Attach full product data if matched
    if (result.match && result.productId) {
      result.product = TWO_AM_CATALOG.find(p => p.id === result.productId) || null;
    }

    res.json(result);
  } catch (err) {
    console.error('[/api/wardrobe/scan]', err.message);
    res.status(500).json({ match: false, confidence: 0, reason: 'Scanner error.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  WARDROBE — validate activation code
//  POST /api/wardrobe/validate-code  { code }
// ─────────────────────────────────────────────────────────────
app.post('/api/wardrobe/validate-code', (req, res) => {
  const { code } = req.body;
  const entry = wardrobeCodes.get(code);
  if (!entry) return res.status(404).json({ valid: false, reason: 'Code not found.' });
  if (entry.claimed) return res.status(409).json({ valid: false, reason: 'Already claimed.' });

  entry.claimed  = true;
  entry.claimedAt = new Date().toISOString();
  wardrobeSet(code, entry);

  const product = TWO_AM_CATALOG.find(p => p.id === entry.productId);
  res.json({ valid: true, product, orderId: entry.orderId });
});

// ─────────────────────────────────────────────────────────────
//  WARDROBE — get 2AM catalog (for closet matching)
//  GET /api/wardrobe/catalog
// ─────────────────────────────────────────────────────────────
app.get('/api/wardrobe/catalog', (req, res) => {
  res.json({
    catalog: TWO_AM_CATALOG,
    visualFingerprints: TWO_AM_VISUAL_FINGERPRINTS,
  });
});

// ─────────────────────────────────────────────────────────────
//  PRINTIFY HELPER — fetch ALL pages of products
// ─────────────────────────────────────────────────────────────
async function fetchAllPrintifyProducts() {
  const products = [];
  let page = 1;
  const shopId = process.env.PRINTIFY_SHOP_ID || '17605284';
  while (true) {
    const r = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products.json?limit=50&page=${page}`,
      { headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}` } }
    );
    if (!r.ok) break;
    const data = await r.json();
    const items = data.data || [];
    products.push(...items);
    if (items.length < 50) break; // last page
    page++;
  }
  return products;
}

// Normalize a raw Printify product into a clean store product object.
// Only products tagged 'showfloor' are shown.
// Price: use retail_price (already in dollars as float) from the first enabled variant.
// Never use internal cost — only what the customer pays.
function normalizePrintifyProduct(p) {
  // Only enabled variants
  const enabledVariants = (p.variants || []).filter(v => v.is_enabled);
  if (enabledVariants.length === 0) return null;

  // retail_price is a float in dollars (e.g. 38.00). If missing fall back to
  // price field which Printify returns in cents when >500, dollars otherwise.
  const firstVariant = enabledVariants[0];
  let retailPriceDollars;
  if (firstVariant.retail_price != null) {
    // retail_price is already dollars
    retailPriceDollars = parseFloat(firstVariant.retail_price);
  } else if (firstVariant.price != null) {
    const raw = parseFloat(firstVariant.price);
    // Printify sometimes returns price in cents (>500) vs dollars
    retailPriceDollars = raw > 500 ? raw / 100 : raw;
  } else {
    retailPriceDollars = 0;
  }

  // Collect unique size options across enabled variants
  const sizes = [...new Set(
    enabledVariants
      .map(v => v.title || v.label || '')
      .filter(t => /^(XS|S|M|L|XL|XXL|OS|S\/M|L\/XL)/i.test(t))
  )];

  // Collect color options
  const colors = [...new Set(
    enabledVariants
      .map(v => (v.options || []).find(o => o.type === 'color')?.title || v.title || '')
      .filter(Boolean)
  )];

  // Best image
  const image = p.images?.[0]?.src || null;

  // Map Printify category to internal type
  const titleLower = (p.title || '').toLowerCase();
  let type = 'tee';
  if (/hoodie|sweat/i.test(titleLower))    type = 'hoodie';
  else if (/jogger|pant|trouser/i.test(titleLower)) type = 'bottoms';
  else if (/short/i.test(titleLower))      type = 'shorts';
  else if (/cap|hat|beanie/i.test(titleLower)) type = 'headwear';
  else if (/jacket|coat/i.test(titleLower)) type = 'jacket';

  return {
    id:          p.id,
    printifyId:  p.id,
    name:        p.title,
    description: p.description || '',
    type,
    collection:  (p.tags || []).find(t => !['showfloor','tapstitch'].includes(t)) || 'CORE',
    // price in cents for consistent internal handling
    price:       Math.round(retailPriceDollars * 100),
    // also expose dollars directly so frontend never has to guess
    priceDollars: retailPriceDollars.toFixed(2),
    colors,
    sizes,
    image,
    tags:        p.tags || [],
    inStock:     enabledVariants.some(v => v.is_available !== false),
    variants:    enabledVariants.map(v => ({
      id:    v.id,
      title: v.title,
      price: Math.round(
        v.retail_price != null
          ? parseFloat(v.retail_price) * 100
          : (parseFloat(v.price) > 500 ? parseFloat(v.price) : parseFloat(v.price) * 100)
      ),
      priceDollars: v.retail_price != null
        ? parseFloat(v.retail_price).toFixed(2)
        : (parseFloat(v.price) > 500 ? (parseFloat(v.price)/100).toFixed(2) : parseFloat(v.price).toFixed(2)),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
//  2AM STORE — product listing
//  GET /api/store/products
//  Returns only products tagged 'showfloor', with real retail prices.
// ─────────────────────────────────────────────────────────────
app.get('/api/store/products', async (req, res) => {
  try {
    if (!process.env.PRINTIFY_API_KEY) {
      return res.json({ products: TWO_AM_CATALOG.filter(p => p.inStock), source: 'catalog' });
    }

    const all = await fetchAllPrintifyProducts();

    // Only showfloor-tagged products
    const showFloor = all.filter(p =>
      Array.isArray(p.tags) && p.tags.includes('showfloor')
    );

    // Normalize and drop any that have no enabled variants
    const normalized = showFloor
      .map(normalizePrintifyProduct)
      .filter(Boolean)
      .filter(p => p.inStock);

    return res.json({ products: normalized, source: 'printify', count: normalized.length });
  } catch (err) {
    console.error('[/api/store/products]', err.message);
    res.json({ products: TWO_AM_CATALOG.filter(p => p.inStock), source: 'catalog' });
  }
});

// ─────────────────────────────────────────────────────────────
//  2AM STORE — create Stripe checkout session
//  POST /api/store/checkout
//  { items: [{ productId, printifyId, variantId, name, price, quantity, size }] }
//  price must be in cents (Printify retail_price * 100)
// ─────────────────────────────────────────────────────────────
app.post('/api/store/checkout', async (req, res) => {
  try {
    const { items = [], customerEmail } = req.body;

    for (const item of items) {
      if (!item.price || item.price <= 0) {
        return res.status(400).json({ error: `Missing price for: ${item.name}` });
      }
    }

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${item.name}${item.size ? ' \u2014 ' + item.size : ''}`,
          metadata: {
            productId:  item.productId  || '',
            printifyId: String(item.printifyId || ''),
            variantId:  String(item.variantId  || ''),
            size:       item.size || '',
          },
        },
        unit_amount: item.price, // cents — actual Printify retail price
      },
      quantity: item.quantity || 1,
    }));

    const shippingCents = 499 + Math.max(0, items.length - 1) * 150;
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Standard Shipping (5-8 business days)' },
        unit_amount: shippingCents,
      },
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: customerEmail || undefined,
      success_url: 'https://2amcases.com/order-confirmation?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://2amcases.com/catalog.html',
      metadata: {
        items: JSON.stringify(items.map(i => ({
          productId:  i.productId,
          printifyId: i.printifyId,
          variantId:  i.variantId,
          size:       i.size,
          name:       i.name,
        }))),
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[/api/store/checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});



// ─────────────────────────────────────────────────────────────
//  2AM STORE — Stripe webhook (order fulfillment + WARDROBE codes)
//  POST /webhook/stripe
// ─────────────────────────────────────────────────────────────
app.post('/webhook/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const items   = JSON.parse(session.metadata?.items || '[]');

    for (const item of items) {
      const code    = generateWardrobeCode();
      const orderId = session.id;

      // Store the code (persisted to disk)
      wardrobeSet(code, {
        productId: item.productId,
        orderId,
        claimed: false,
        createdAt: new Date().toISOString(),
      });

      // If Printify product, submit order
      if (process.env.PRINTIFY_API_KEY && item.printifyId) {
        try {
          // Map Stripe shipping_details to Printify's required address format
          const sd   = session.shipping_details || {};
          const addr = sd.address || {};
          const nameParts = (sd.name || '').trim().split(/\s+/);
          const printifyAddress = {
            first_name:   nameParts[0] || 'Customer',
            last_name:    nameParts.slice(1).join(' ') || 'Night.inc',
            email:        session.customer_email || '',
            phone:        '',
            country_code: addr.country || 'US',
            region:       addr.state   || '',
            address1:     addr.line1   || '',
            address2:     addr.line2   || '',
            city:         addr.city    || '',
            zip:          addr.postal_code || '',
          };

          await fetch(`https://api.printify.com/v1/shops/${process.env.PRINTIFY_SHOP_ID}/orders.json`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              external_id:     orderId,
              line_items:      [{ product_id: item.printifyId, variant_id: item.variantId, quantity: 1 }],
              shipping_method: 1,
              address_to:      printifyAddress,
            }),
          });
        } catch (e) {
          console.error('[Printify order]', e.message);
        }
      }

      console.log(`[Order] ${orderId} → code ${code} for product ${item.productId}`);
    }
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────
//  2AM STORE — order confirmation (called by confirmation page)
//  GET /api/store/order?session_id=...
// ─────────────────────────────────────────────────────────────
app.get('/api/store/order', async (req, res) => {
  try {
    const { session_id } = req.query;
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items'],
    });

    // Find WARDROBE codes for this order
    const codes = [];
    for (const [code, entry] of wardrobeCodes.entries()) {
      if (entry.orderId === session_id) {
        const product = TWO_AM_CATALOG.find(p => p.id === entry.productId);
        codes.push({ code, product, claimed: entry.claimed });
      }
    }

    res.json({
      orderId: session.id,
      customerEmail: session.customer_email,
      total: session.amount_total,
      status: session.payment_status,
      items: session.line_items?.data || [],
      wardrobeCodes: codes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  KINETIC — AI meal plan
//  POST /api/kinetic/meal  { calories, macros, restrictions }
// ─────────────────────────────────────────────────────────────
app.post('/api/kinetic/meal', async (req, res) => {
  try {
    const { calories, macros, restrictions } = req.body;
    const prompt = `Generate a 1-day meal plan for ${calories} calories.
Macros target: ${JSON.stringify(macros)}.
Restrictions: ${restrictions || 'none'}.
Return JSON: { meals: [{ name, calories, protein, carbs, fat, time }] }`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ meals: [] });
  }
});

// ─────────────────────────────────────────────────────────────
//  AURA — skin analysis
//  POST /api/aura/analyze  { imageBase64, skinConcerns, environment }
// ─────────────────────────────────────────────────────────────
app.post('/api/aura/analyze', async (req, res) => {
  try {
    const { imageBase64, skinConcerns, environment } = req.body;
    const messages = imageBase64
      ? [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' } },
            { type: 'text', text: `Analyze this face image for skin health. Concerns: ${skinConcerns || 'general'}. Environment: ${JSON.stringify(environment || {})}. Return JSON: { score: 0-100, issues: [], routine: [{ step, product, when }], tips: [] }` },
          ],
        }]
      : [{ role: 'user', content: `Skin analysis for concerns: ${skinConcerns}. Return JSON: { score: 0-100, issues: [], routine: [], tips: [] }` }];

    const completion = await openai.chat.completions.create({
      model: imageBase64 ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens: 800,
      messages,
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ score: 0, issues: [], routine: [], tips: [] });
  }
});

// ─────────────────────────────────────────────────────────────
//  NEXUS — idea action plan
//  POST /api/nexus/idea  { idea, businessName }
// ─────────────────────────────────────────────────────────────
app.post('/api/nexus/idea', async (req, res) => {
  try {
    const { idea, businessName } = req.body;
    const prompt = `You are a sharp business strategist. The founder runs "${businessName}". 
Idea: "${idea}". 
Create a concise action plan. Return JSON: { summary, steps: [{ action, timeline, effort }], risks: [], verdict: 'hot'|'test'|'skip' }`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ summary: 'AI offline', steps: [], risks: [], verdict: 'skip' });
  }
});

// ─────────────────────────────────────────────────────────────
//  APEX — streak engine
//
//  Rules:
//    1. Streak only increments if founderKeyActive === true
//       (biometric Founder-Key must be active — no key, no log)
//    2. Midnight reset uses Florida / Eastern Time (handles DST)
//    3. Chris Mode: 12-hour grace window
//       If chrisMode === true, the "yesterday" check extends to
//       36 hours since last log instead of 24 — so logging at
//       2AM after midnight still counts as the previous day's log
//    4. Double-logging on the same day is a no-op (idempotent)
//
//  POST /api/apex/streak/log   { userId, founderKeyActive, chrisMode? }
//  GET  /api/apex/streak/:userId
//  POST /api/apex/streak/reset { userId }   (dev/admin only — no prod exposure without auth)
// ─────────────────────────────────────────────────────────────

// File-persisted streak store (survives Railway restarts)
const STREAKS_FILE = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp', 'apex_streaks.json');

function readStreaksFile() {
  try { return JSON.parse(fs.readFileSync(STREAKS_FILE, 'utf8')); }
  catch { return {}; }
}
function writeStreaksFile(data) {
  try { fs.writeFileSync(STREAKS_FILE, JSON.stringify(data), 'utf8'); }
  catch (e) { console.error('[apex-streaks] write error:', e.message); }
}

const apexStreaks = new Map(Object.entries(readStreaksFile()));
console.log(`[apex-streaks] Loaded ${apexStreaks.size} streak(s) from disk.`);

function streakSet(userId, entry) {
  apexStreaks.set(userId, entry);
  writeStreaksFile(Object.fromEntries(apexStreaks));
}

// Returns today's date string in Eastern Time (Florida), e.g. "2026-06-10"
// Uses Intl to handle DST automatically — no manual offset math
function getEasternDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD format
    timeZone: 'America/New_York',
  }).format(date);
}

app.post('/api/apex/streak/log', (req, res) => {
  const { userId = 'default', founderKeyActive = false, chrisMode = false } = req.body;

  // Gate 1: Founder-Key required
  if (!founderKeyActive) {
    const current = apexStreaks.get(userId);
    return res.status(403).json({
      logged:   false,
      reason:   'Founder-Key biometric required to log streak.',
      streak:   current?.streak ?? 0,
      lastLogDate: current?.lastLogDate ?? null,
    });
  }

  const now     = new Date();
  const todayET = getEasternDateString(now);
  const existing = apexStreaks.get(userId);

  // No prior record — first-ever log
  if (!existing) {
    streakSet(userId, { streak: 1, lastLogDate: todayET, chrisMode, updatedAt: now.toISOString() });
    return res.json({ logged: true, streak: 1, continued: false, firstLog: true, date: todayET });
  }

  // Already logged today — idempotent, no change
  if (existing.lastLogDate === todayET) {
    return res.json({ logged: false, reason: 'Already logged today.', streak: existing.streak, date: todayET });
  }

  // Compute hours since last log to decide whether streak continues
  const lastLogTime   = new Date(existing.updatedAt);
  const hoursSinceLast = (now - lastLogTime) / (1000 * 60 * 60);

  // Standard window: 24h–48h gap means yesterday's date is the last log
  // Chris Mode grace: extends window to 36h (12-hour grace past midnight)
  const windowHours = chrisMode ? 36 : 28; // 28h = small normal buffer past midnight

  if (hoursSinceLast <= windowHours) {
    // Streak continues
    const newStreak = existing.streak + 1;
    streakSet(userId, { streak: newStreak, lastLogDate: todayET, chrisMode, updatedAt: now.toISOString() });
    return res.json({ logged: true, streak: newStreak, continued: true, chrisMode, date: todayET });
  } else {
    // Streak broken — reset to 1
    streakSet(userId, { streak: 1, lastLogDate: todayET, chrisMode, updatedAt: now.toISOString() });
    return res.json({ logged: true, streak: 1, continued: false, streakReset: true, date: todayET });
  }
});

app.get('/api/apex/streak/:userId', (req, res) => {
  const { userId } = req.params;
  const data = apexStreaks.get(userId);

  if (!data) {
    return res.json({ userId, streak: 0, lastLogDate: null, active: false });
  }

  const todayET = getEasternDateString();
  // "active" = user has already logged today
  const active = data.lastLogDate === todayET;

  res.json({
    userId,
    streak:         data.streak,
    lastLogDate:    data.lastLogDate,
    active,
    chrisMode:      data.chrisMode,
    updatedAt:      data.updatedAt,
    todayET,
  });
});

// ─────────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Night.inc Unified Backend running on port ${PORT}`);
  console.log(`Apps served: APEX (streak engine) · WARDROBE · INDEX · NEXUS · KINETIC · AURA · 2AM`);
});
