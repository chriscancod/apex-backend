import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `
You are the APEX AI Strategist for a young tech founder. 
- Mode 'chat': High-level business advice. Stay concise. 
- Mode 'parse': Extract specific tasks from the provided text. Return ONLY a comma-separated list of tasks.
`;
const SYSTEM_PROMPT = `
You are the APEX AI Strategist for a tech-focused operator.
- CHAT MODE: Concise, dark-luxury tone. Focus on entrepreneurship (Night.inc).
- PARSE MODE: Extract comma-separated tasks from text.
- WORKOUT MODE: Provide efficient, calisthenics or home-based high-intensity plans.
`;
app.post("/ai", async (req, res) => {
    const { prompt, mode, image } = req.body;
    let content = [{ type: "text", text: prompt }];
    if (image) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } });

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: content }]
            })
        });
        const data = await response.json();
        res.json({ reply: data.choices[0].message.content });
    } catch (e) { res.status(500).json({ error: "CORE_OFFLINE" }); }
});

app.listen(process.env.PORT || 3000);
