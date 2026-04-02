const express = require('express');
const OpenAI = require('openai');
const app = express();

app.use(express.json({ limit: '50mb' }));

// Set your OPEN_AI_KEY in Railway Variables
const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

const STRATEGIST_PROMPT = `
You are the APEX Lead Strategist for a 13yo founder of Night.inc and Noctis.
Your goal is to build a high-performance 'Chris Mode' schedule.

INSTRUCTIONS:
1. If the user request is vague, ALWAYS ask 2-3 specific questions first (e.g., "Any Ender 3 printing tasks?", "What is the priority for 2amcases today?").
2. Only provide a final schedule once you have context.
3. TONE: Minimalist, professional, and high-stakes.
4. FORMATTING: Use monospaced blocks for schedules. For the 'Auto-Generate' feature, return a comma-separated list.
`;

app.post('/ai', async (req, res) => {
    try {
        const { prompt, image } = req.body;
        let content = [{ type: "text", text: prompt }];

        if (image) {
            content.push({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${image}` }
            });
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: STRATEGIST_PROMPT },
                { role: "user", content: content }
            ],
            max_tokens: 800,
        });

        res.json({ reply: response.choices[0].message.content });
    } catch (error) {
        console.error(error);
        res.status(500).json({ reply: "STRATEGIST_OFFLINE: Connection Error." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`APEX Backend live on ${PORT}`));
