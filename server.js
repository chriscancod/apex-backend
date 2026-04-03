const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Pulls from Railway Variables
});

app.post('/ai', async (req, res) => {
    try {
        const { message, mode, username } = req.body;

        // SYSTEM PROMPT: This defines the "Personality" of APEX
        const systemRole = `You are APEX, the AI Operating System for Night.inc. 
        Your user is ${username}, a 13-year-old software architect and entrepreneur. 
        Keep responses minimalist, futuristic, and high-utility. 
        If mode is 'parse', return a comma-separated list of 3-5 tasks.
        Otherwise, provide elite strategic advice.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o", // Or "gpt-3.5-turbo" if you want to save money
            messages: [
                { role: "system", content: systemRole },
                { role: "user", content: message }
            ],
            temperature: 0.7,
        });

        const aiReply = completion.choices[0].message.content;

        res.status(200).json({
            response: aiReply
        });

    } catch (error) {
        console.error("AI_ERROR:", error);
        res.status(500).json({ response: "SYSTEM_OFFLINE // CHECK_API_CREDITS" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`APEX_NEURAL_CORE_ONLINE on ${PORT}`);
});
