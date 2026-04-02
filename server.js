import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
// Increased limit for high-res fridge photos
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// STRATEGIST CONFIG
const STRATEGIST_PROMPT = `
You are the APEX Lead Strategist for a 13yo founder of Night.inc and Noctis.
Your goal is to build a high-performance 'Chris Mode' schedule.

INSTRUCTIONS:
1. If the user request is vague, ALWAYS ask 2-3 specific questions first (e.g., "Any Ender 3 printing tasks?", "What is the priority for 2amcases today?").
2. Only provide a final schedule once you have context.
3. TONE: Minimalist, professional, and high-stakes.
4. FORMATTING: Use monospaced blocks for schedules. For the 'Auto-Generate' feature, return a comma-separated list.
`;

app.get("/", (req, res) => {
    res.send("APEX Strategist Core Online.");
});

app.post("/ai", async (req, res) => {
    const { prompt, image } = req.body;

    // Prepare content structure for GPT-4o
    let userContent = [{ type: "text", text: prompt }];
    
    if (image) {
        userContent.push({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${image}` }
        });
    }

    try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4o-mini", // Optimized for speed and cost
                messages: [
                    { role: "system", content: STRATEGIST_PROMPT },
                    { role: "user", content: userContent }
                ],
                max_tokens: 800
            })
        });

        const data = await r.json();
        
        if (data.error) {
            console.error("OpenAI Error:", data.error);
            return res.status(500).json({ reply: "API Error: " + data.error.message });
        }

        const text = data.choices[0].message.content;
        res.json({ reply: text });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ reply: "STRATEGIST_OFFLINE: Connection failed." });
    }
});

app.listen(PORT, () => console.log("APEX Strategist running on port", PORT));
