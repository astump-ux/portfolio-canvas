// api/deploy-news.js
// Writes newsCache directly to dedicated news bin — single PUT, no merge needed

const NEWS_BIN_ID = process.env.NEWS_BIN_ID || '69be6952b7ec241ddc8b5e92';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { newsCache } = req.body;
    if (!newsCache || !Array.isArray(newsCache)) {
      res.status(400).json({ error: 'newsCache array required' }); return;
    }

    // Single PUT — no GET+merge needed since this bin only holds newsCache
    const pr = await fetch(`https://api.jsonbin.io/v3/b/${NEWS_BIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify({ newsCache, newsCacheUpdatedAt: new Date().toISOString() })
    });

    if (!pr.ok) throw new Error('JSONBin error: ' + pr.status);
    res.status(200).json({ ok: true, count: newsCache.length });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
