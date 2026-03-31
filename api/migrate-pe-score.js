// /api/migrate-pe-score.js
// One-time migration: adds pe:null to all companies that don't have a pe score yet.
// Safe to call multiple times — only touches companies without pe.

const JSONBIN_ID  = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    var jbRes = await fetch(
      'https://api.jsonbin.io/v3/b/' + JSONBIN_ID + '/latest',
      { headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' } }
    );
    var jbData = await jbRes.json();
    var companies = Array.isArray(jbData.companies) ? jbData.companies : [];
    if (!companies.length) return res.status(200).json({ message: 'No companies found' });

    var migrated = 0;
    var updatedCompanies = companies.map(function(c) {
      if (c.scores && !('pe' in c.scores)) {
        migrated++;
        return Object.assign({}, c, {
          scores: Object.assign({}, c.scores, { pe: null })
        });
      }
      return c;
    });

    if (!migrated) {
      return res.status(200).json({ message: 'All companies already have pe score', total: companies.length });
    }

    await fetch('https://api.jsonbin.io/v3/b/' + JSONBIN_ID, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify(Object.assign({}, jbData, { companies: updatedCompanies })),
    });

    return res.status(200).json({
      success: true,
      migrated: migrated,
      total: companies.length,
      note: 'pe:null set for ' + migrated + ' companies. Update each via Verwalten tab.'
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
