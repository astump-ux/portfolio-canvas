// api/deploy-analysis.js
// Receives company key data, merges into JSONBin companies[]

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { company } = req.body;
    if (!company || !company.ticker) {
      res.status(400).json({ error: 'company.ticker required' }); return;
    }

    // Load current bin
    const gr = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' }
    });
    const gd = await gr.json();
    const companies = Array.isArray(gd.companies) ? gd.companies : [];

    // Find existing or create new
    const idx = companies.findIndex(c => c.ticker === company.ticker);
    const existing = idx >= 0 ? companies[idx] : null;

    // Merge: keep existing fields (events, chatUrl, etc.) but update analysis fields
    const merged = Object.assign({}, existing || { id: 'co_' + Date.now() }, company);

    // Always construct analyseUrl dynamically — don't store it
    delete merged.analyseUrl;

    if (idx >= 0) {
      companies[idx] = merged;
    } else {
      companies.push(merged);
    }

    // Write back
    const pr = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify({
        companies,
        pricesUpdatedAt: gd.pricesUpdatedAt || '',
        newsCache: gd.newsCache || [],
        newsCacheUpdatedAt: gd.newsCacheUpdatedAt || ''
      })
    });

    if (!pr.ok) throw new Error('JSONBin PUT failed: ' + pr.status);

    res.status(200).json({
      ok: true,
      action: idx >= 0 ? 'updated' : 'created',
      ticker: company.ticker,
      total: companies.length
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
