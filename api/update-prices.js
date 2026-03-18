// /api/update-prices.js - v3 using Yahoo Finance proxy on Render.com

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

// ⬇️ Replace with your Render.com URL after deployment
const PROXY_URL = process.env.YAHOO_PROXY_URL || 'https://yahoo-proxy.onrender.com';

const YAHOO_MAP = {
  // US Stocks
  'DDOG':'DDOG','TEAM':'TEAM','WDAY':'WDAY','NOW':'NOW','CRM':'CRM',
  'HUBS':'HUBS','SNOW':'SNOW','PANW':'PANW','GOOGL':'GOOGL','OKTA':'OKTA',
  'AMZN':'AMZN','META':'META','MSFT':'MSFT','FSLR':'FSLR','FLNC':'FLNC',
  'NFLX':'NFLX','MDT':'MDT','ISRG':'ISRG','MU':'MU','NU':'NU',
  'TSMC':'TSM','UBER':'UBER','TEM':'TEM','UPWK':'UPWK','VEEV':'VEEV','DT':'DT',
  'BABA':'BABA','TCEHY':'TCEHY',
  // European
  'MUV2':'MUV2.DE','SREN':'SREN.SW','TEG':'TEG.DE','DHL':'DHL.DE','WISE':'WISE.L',
  // Scandinavian
  'ORSTED':'ORSTED.CO',
  // Hong Kong
  'XIAOMI':'1810.HK','BYD':'1211.HK','HORIZON':'9660.HK','GEEKPLUS':'2030.HK',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // 1. Load companies from JSONBin
    const jbRes = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`,
      { headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' } }
    );
    const jbData = await jbRes.json();
    let companies = jbData?.companies;
    if (!Array.isArray(companies)) companies = Object.values(companies || {});
    if (!companies.length) return res.status(200).json({ message: 'No companies found' });

    // 2. Build symbols string
    const symbols = companies.map(c => YAHOO_MAP[c.ticker]).filter(Boolean).join(',');

    // 3. Fetch quotes via proxy
    const [quoteRes, sparkRes] = await Promise.all([
      fetch(`${PROXY_URL}/quotes?symbols=${encodeURIComponent(symbols)}`),
      fetch(`${PROXY_URL}/spark?symbols=${encodeURIComponent(symbols)}&range=8d&interval=1d`)
    ]);

    const quoteData = await quoteRes.json();
    const sparkData = await sparkRes.json();

    const quotes = quoteData?.quoteResponse?.result || [];
    const sparks = sparkData?.spark?.result || [];

    // Build lookup maps
    const quoteMap = {};
    quotes.forEach(q => { quoteMap[q.symbol] = q; });
    const sparkMap = {};
    sparks.forEach(s => {
      const closes = s?.response?.[0]?.indicators?.quote?.[0]?.close || [];
      sparkMap[s.symbol] = closes.filter(x => x != null);
    });

    // 4. Update companies
    let updated = 0;
    const updatedCompanies = companies.map(c => {
      const sym = YAHOO_MAP[c.ticker];
      if (!sym) return c;
      const q = quoteMap[sym];
      const closes = sparkMap[sym] || [];
      const currentPrice = q?.regularMarketPrice ?? null;
      let perf7d = null;
      if (closes.length >= 2) {
        const latest = closes[closes.length - 1];
        const oldest = closes[0];
        if (oldest) perf7d = Math.round(((latest - oldest) / oldest) * 1000) / 10;
      }
      if (currentPrice !== null || perf7d !== null) updated++;
      return {
        ...c,
        currentPrice: currentPrice ? String(currentPrice) : (c.currentPrice || c.price),
        perf7d,
        priceUpdatedAt: new Date().toISOString(),
      };
    });

    // 5. Write back to JSONBin
    await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify({ companies: updatedCompanies, pricesUpdatedAt: new Date().toISOString() }),
    });

    return res.status(200).json({
      success: true,
      updated,
      quotesReceived: quotes.length,
      sparksReceived: sparks.length,
      timestamp: new Date().toISOString(),
      sample: updatedCompanies.slice(0, 5).map(c => ({
        ticker: c.ticker,
        currentPrice: c.currentPrice,
        perf7d: c.perf7d,
      })),
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
