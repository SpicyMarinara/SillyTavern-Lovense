import express from 'express';
import https from 'https';

const router = express.Router();

/**
 * Proxy endpoint for Lovense API requests
 * This allows bypassing CORS and self-signed certificate issues
 */
router.post('/command', async (req, res) => {
    const { url, ...commandData } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const urlObj = new URL(url);
        const postData = JSON.stringify(commandData);

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            // Accept self-signed certificates
            rejectUnauthorized: false,
        };

        const proxyReq = https.request(options, (proxyRes) => {
            let data = '';

            proxyRes.on('data', (chunk) => {
                data += chunk;
            });

            proxyRes.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    res.json(jsonData);
                } catch (error) {
                    console.error('[Lovense] Failed to parse response:', error);
                    res.status(500).json({ error: 'Invalid response from Lovense device' });
                }
            });
        });

        proxyReq.on('error', (error) => {
            console.error('[Lovense] Proxy request error:', error);
            res.status(500).json({
                error: 'Failed to connect to Lovense device',
                details: error.message,
            });
        });

        proxyReq.write(postData);
        proxyReq.end();
    } catch (error) {
        console.error('[Lovense] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

export { router };
