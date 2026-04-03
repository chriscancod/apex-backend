const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// MIDDLEWARE
app.use(cors());
app.use(bodyParser.json());

// THE STABLE AI ENDPOINT
app.post('/ai', (req, res) => {
    const { message, username } = req.body;
    
    console.log(`RECEIVED FROM ${username}: ${message}`);

    // V11 STABLE LOGIC: Confirms receipt and mirrors the user name
    const systemResponse = `PROTOCOL_ACCEPTED // Operator ${username || 'CHRIS'}, your command "${message}" has been logged to NightOS. Deployment pending.`;

    res.status(200).json({
        response: systemResponse
    });
});

// PORT CONFIG
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`APEX_CORE_V11_ONLINE ON PORT ${PORT}`);
});
