// api/deploy-news.js
// Receives newsCache from Claude artifact, writes to JSONBin server-side (no CORS issue)

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
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

    // Fetch current JSONBin data to preserve companies[]
    const gr = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' }
    });
    const gd = await gr.json();
    const companies = Array.isArray(gd.companies) ? gd.companies : [];

    // Write back with updated newsCache
    const pr = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify({
        companies,
        newsCache,
        newsCacheUpdatedAt: new Date().toISOString()
      })
    });

    if (!pr.ok) throw new Error('JSONBin error: ' + pr.status);
    res.status(200).json({ ok: true, count: newsCache.length });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
