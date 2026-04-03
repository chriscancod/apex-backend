const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// THE AI ENDPOINT
app.post('/ai', async (req, res) => {
    try {
        const { message, mode, username } = req.body;
        console.log(`INCOMING FROM ${username}: [${mode}] ${message}`);

        // --- INSERT YOUR OPENAI/ANTHROPIC API CALL HERE ---
        // For now, we return a structured response the app recognizes.
        
        let aiResponse = "";
        if (mode === "parse") {
            aiResponse = "MISSION_EXTRACTED: Reviewing your schedule. Missions added to Home Ops.";
        } else {
            aiResponse = `STRATEGY_LOADED: Operator ${username}, focusing on your tech architecture now.`;
        }

        // CRITICAL: We send the key "response" to match the Swift code
        res.status(200).json({
            response: aiResponse,
            status: "success"
        });

    } catch (error) {
        console.error("SYSTEM_ERROR:", error);
        res.status(500).json({ response: "ERROR // NEURAL_LINK_FAILED" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`APEX_CORE_ONLINE on port ${PORT}`);
});
