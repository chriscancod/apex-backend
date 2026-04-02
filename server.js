import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `
You are the APEX AI, a high-level strategist for a young entrepreneur. 
MODES:
1. CHAT: Be concise, professional, and dark-luxury toned. Give high-level advice.
2. PARSE: If the user provides a schedule or a list of text, extract the actionable tasks.
   - Return ONLY a comma-separated list of tasks. 
   - Example: "Finish Python script, Walk dog, Review Noctis designs"
`;

app.post("/ai", async (req, res) => {
    const { prompt, mode } = req.body; // mode: 'chat' or 'parse'

    try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: prompt }
                ]
            })
        });
        const data = await r.json();
        res.json({ reply: data.choices[0].message.content });
    } catch (e) { res.status(500).json({ reply: "OFFLINE" }); }
});

app.listen(PORT, () => console.log("APEX AI Core Online"));
