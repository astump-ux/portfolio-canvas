// /api/update-prices.js
// Vercel Serverless Function + Cron Job
// Deployed in your portfolio-canvas GitHub repo under /api/

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

// Yahoo Finance symbol mapping
// Format: TICKER_IN_APP -> YAHOO_SYMBOL
const YAHOO_MAP = {
  // US Stocks
  'DDOG':   'DDOG',
  'TEAM':   'TEAM',
  'WDAY':   'WDAY',
  'NOW':    'NOW',
  'CRM':    'CRM',
  'HUBS':   'HUBS',
  'SNOW':   'SNOW',
  'PANW':   'PANW',
  'GOOGL':  'GOOGL',
  'OKTA':   'OKTA',
  'AMZN':   'AMZN',
  'META':   'META',
  'MSFT':   'MSFT',
  'FSLR':   'FSLR',
  'FLNC':   'FLNC',
  'NFLX':   'NFLX',
  'MDT':    'MDT',
  'ISRG':   'ISRG',
  'MU':     'MU',
  'NU':     'NU',
  'TSMC':   'TSM',       // ADR on NYSE
  'UBER':   'UBER',
  'TEM':    'TEM',
  'UPWK':   'UPWK',
  // European Stocks (Yahoo uses .DE for Xetra, .SW for SIX)
  'MUV2':   'MUV2.DE',
  'SREN':   'SREN.SW',
  'TEG':    'TEG.DE',
  'DHL':    'DHL.DE',
  // UK
  'WISE':   'WISE.L',
  // Scandinavian
  'ORSTED': 'ORSTED.CO',
  // Hong Kong
  'XIAOMI': '1810.HK',
  'BYD':    '1211.HK',
  'HORIZON':'9660.HK',
  'GEEKPLUS':'2030.HK',
  // China ADR / OTC
  'BABA':   'BABA',
  'TCEHY':  'TCEHY',
  // Medtech
  'VEEV':   'VEEV',
  'DT':     'DT',
};

export default async function handler(req, res) {
  // Allow manual trigger via GET, or automated via cron
  try {
    console.log('Starting price update...');

    // 1. Fetch current companies from JSONBin
    const jbRes = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`,
      { headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' } }
    );
    const jbData = await jbRes.json();
    const companies = jbData?.companies || [];

    if (!companies.length) {
      return res.status(200).json({ message: 'No companies found in JSONBin' });
    }

    // 2. Build Yahoo Finance batch symbols string
    const symbols = companies
      .map(c => YAHOO_MAP[c.ticker])
      .filter(Boolean)
      .join(',');

    console.log(`Fetching prices for: ${symbols}`);

    // 3. Fetch current quotes (batch) from Yahoo Finance
    const quoteRes = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,regularMarketChangePercent`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        }
      }
    );
    const quoteData = await quoteRes.json();
    const quotes = quoteData?.quoteResponse?.result || [];

    // Build lookup map: yahoo_symbol -> data
    const quoteMap = {};
    quotes.forEach(q => { quoteMap[q.symbol] = q; });

    // 4. Fetch 8-day historical for 7d performance calculation
    // Use Yahoo Finance spark endpoint (batch, efficient)
    const sparkRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=8d&interval=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        }
      }
    );
    const sparkData = await sparkRes.json();
    const sparks = sparkData?.spark?.result || [];

    // Build spark lookup
    const sparkMap = {};
    sparks.forEach(s => {
      if (s?.response?.[0]) {
        const r = s.response[0];
        const closes = r?.indicators?.quote?.[0]?.close || [];
        sparkMap[s.symbol] = closes;
      }
    });

    // 5. Update companies with fresh data
    let updated = 0;
    const updatedCompanies = companies.map(c => {
      const yahooSym = YAHOO_MAP[c.ticker];
      if (!yahooSym) return c;

      const quote = quoteMap[yahooSym];
      const closes = sparkMap[yahooSym] || [];

      // Current price
      const currentPrice = quote?.regularMarketPrice || null;

      // 7d performance: compare last close to close 7 days ago
      const validCloses = closes.filter(x => x !== null && x !== undefined);
      let perf7d = null;
      if (validCloses.length >= 2) {
        const latest = validCloses[validCloses.length - 1];
        const oldest = validCloses[0];
        if (oldest && oldest !== 0) {
          perf7d = Math.round(((latest - oldest) / oldest) * 1000) / 10; // 1 decimal
        }
      }

      updated++;
      return {
        ...c,
        currentPrice: currentPrice ? `${currentPrice}` : c.price,
        perf7d: perf7d,
        priceUpdatedAt: new Date().toISOString(),
      };
    });

    console.log(`Updated ${updated} companies`);

    // 6. Write back to JSONBin
    const putRes = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_KEY,
        },
        body: JSON.stringify({
          companies: updatedCompanies,
          pricesUpdatedAt: new Date().toISOString(),
        }),
      }
    );

    const putData = await putRes.json();
    console.log('JSONBin updated:', putRes.status);

    return res.status(200).json({
      success: true,
      updated,
      timestamp: new Date().toISOString(),
      sample: updatedCompanies.slice(0, 3).map(c => ({
        ticker: c.ticker,
        perf7d: c.perf7d,
        currentPrice: c.currentPrice,
      })),
    });

  } catch (error) {
    console.error('Price update error:', error);
    return res.status(500).json({ error: error.message });
  }
}
