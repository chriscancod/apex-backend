import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// TEST
app.get("/", (req, res) => {
    res.send("APEX backend running");
});

// AI
app.post("/ai", async (req, res) => {
    const { prompt } = req.body;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: prompt }]
        })
    });

    const data = await r.json();
    res.json(data);
});

app.listen(PORT, () => console.log("Server running on", PORT));