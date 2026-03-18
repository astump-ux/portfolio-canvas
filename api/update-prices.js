// /api/update-prices.js - v2 with better Yahoo Finance handling

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

const YAHOO_MAP = {
  'DDOG':'DDOG','TEAM':'TEAM','WDAY':'WDAY','NOW':'NOW','CRM':'CRM',
  'HUBS':'HUBS','SNOW':'SNOW','PANW':'PANW','GOOGL':'GOOGL','OKTA':'OKTA',
  'AMZN':'AMZN','META':'META','MSFT':'MSFT','FSLR':'FSLR','FLNC':'FLNC',
  'NFLX':'NFLX','MDT':'MDT','ISRG':'ISRG','MU':'MU','NU':'NU',
  'TSMC':'TSM','UBER':'UBER','TEM':'TEM','UPWK':'UPWK','VEEV':'VEEV',
  'DT':'DT','MUV2':'MUV2.DE','SREN':'SREN.SW','TEG':'TEG.DE','DHL':'DHL.DE',
  'WISE':'WISE.L','ORSTED':'ORSTED.CO','XIAOMI':'1810.HK','BYD':'1211.HK',
  'HORIZON':'9660.HK','GEEKPLUS':'2030.HK','BABA':'BABA','TCEHY':'TCEHY',
};

export default async function handler(req, res) {
  // Allow CORS for manual browser testing
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // 1. Fetch companies from JSONBin
    const jbRes = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`,
      { headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' } }
    );
    const jbData = await jbRes.json();
    let companies = jbData?.companies;
    if (!Array.isArray(companies)) companies = Object.values(companies || {});
    if (!companies.length) return res.status(200).json({ message: 'No companies' });

    // 2. Build symbol list
    const symbols = companies
      .map(c => YAHOO_MAP[c.ticker]).filter(Boolean).join(',');

    // 3. Fetch quotes via Yahoo Finance v7 with crumb workaround
    // First get a crumb
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/csrfToken', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      }
    });
    const crumbData = await crumbRes.json();
    const crumb = crumbData?.csrfToken || '';

    // 4. Fetch batch quotes
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&crumb=${crumb}`;
    const quoteRes = await fetch(quoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Cookie': crumbRes.headers.get('set-cookie') || '',
      }
    });

    const quoteData = await quoteRes.json();
    const quotes = quoteData?.quoteResponse?.result || [];

    // 5. Fetch 8d historical for perf7d
    const sparkUrl = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=8d&interval=1d`;
    const sparkRes = await fetch(sparkUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Cookie': crumbRes.headers.get('set-cookie') || '',
      }
    });
    const sparkData = await sparkRes.json();
    const sparks = sparkData?.spark?.result || [];

    // Build lookup maps
    const quoteMap = {};
    quotes.forEach(q => { quoteMap[q.symbol] = q; });
    const sparkMap = {};
    sparks.forEach(s => {
      const closes = s?.response?.[0]?.indicators?.quote?.[0]?.close || [];
      sparkMap[s.symbol] = closes.filter(x => x != null);
    });

    // 6. Update companies
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
        currentPrice: currentPrice ? String(currentPrice) : c.currentPrice || c.price,
        perf7d,
        priceUpdatedAt: new Date().toISOString(),
      };
    });

    // 7. Write back to JSONBin
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
      sample: updatedCompanies.slice(0, 3).map(c => ({
        ticker: c.ticker,
        currentPrice: c.currentPrice,
        perf7d: c.perf7d,
      })),
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack?.slice(0, 300) });
  }
}
