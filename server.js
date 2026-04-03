const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/ai', (req, res) => {
    const { message, username } = req.body;
    console.log(`LOG // INCOMING: ${message} FROM: ${username}`);

    // Stable response logic
    const reply = `SYSTEM // Command "${message}" received, Operator ${username || 'CHRIS'}. APEX V11 is operating in stable mode.`;

    res.status(200).json({
        response: reply
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`APEX_STABLE_ONLINE // PORT ${PORT}`));
