// /api/update-prices.js - Finnhub, CommonJS compatible

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

const FINNHUB_MAP = {
  'DDOG':'DDOG','TEAM':'TEAM','WDAY':'WDAY','NOW':'NOW','CRM':'CRM',
  'HUBS':'HUBS','SNOW':'SNOW','PANW':'PANW','GOOGL':'GOOGL','OKTA':'OKTA',
  'AMZN':'AMZN','META':'META','MSFT':'MSFT','FSLR':'FSLR','FLNC':'FLNC',
  'NFLX':'NFLX','MDT':'MDT','ISRG':'ISRG','MU':'MU','NU':'NU',
  'TSMC':'TSM','UBER':'UBER','TEM':'TEM','UPWK':'UPWK','VEEV':'VEEV',
  'DT':'DT','BABA':'BABA','TCEHY':'TCEHY',
  'MUV2':'MUV2:XETRA','SREN':'SREN:SW','TEG':'TEG:XETRA','DHL':'DHL:XETRA',
  'WISE':'WISE:LSE','ORSTED':'ORSTED:OMXCOP',
  'XIAOMI':'1810:HKEX','BYD':'1211:HKEX','HORIZON':'9660:HKEX','GEEKPLUS':'2030:HKEX',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const FINNHUB_KEY = process.env.FINNHUB_KEY;
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set' });

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

    // 2. Fetch quotes + candles for all tickers in parallel
    const tickers = companies
      .map(c => ({ ticker: c.ticker, sym: FINNHUB_MAP[c.ticker] }))
      .filter(x => x.sym);

    const fetched = await Promise.all(tickers.map(async ({ ticker, sym }) => {
      try {
        const to = Math.floor(Date.now() / 1000);
        const from = to - (9 * 24 * 60 * 60);
        const [qRes, cRes] = await Promise.all([
          fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`),
          fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(sym)}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`)
        ]);
        const [quote, candles] = await Promise.all([qRes.json(), cRes.json()]);
        return { ticker, quote, candles };
      } catch(e) {
        return { ticker, quote: null, candles: null };
      }
    }));

    const dataMap = {};
    fetched.forEach(f => { dataMap[f.ticker] = f; });

    // 3. Update companies
    let updated = 0;
    const updatedCompanies = companies.map(c => {
      const d = dataMap[c.ticker];
      if (!d?.quote) return c;
      const currentPrice = d.quote.c || null;
      let perf7d = null;
      if (d.candles?.c?.length >= 2) {
        const closes = d.candles.c.filter(x => x != null);
        if (closes.length >= 2) {
          const latest = closes[closes.length - 1];
          const oldest = closes[0];
          if (oldest) perf7d = Math.round(((latest - oldest) / oldest) * 1000) / 10;
        }
      }
      if (currentPrice) updated++;
      return {
        ...c,
        currentPrice: currentPrice ? String(Math.round(currentPrice * 100) / 100) : (c.currentPrice || c.price),
        perf7d,
        priceUpdatedAt: new Date().toISOString(),
      };
    });

    // 4. Write back to JSONBin
    await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify({ companies: updatedCompanies, pricesUpdatedAt: new Date().toISOString() }),
    });

    return res.status(200).json({
      success: true,
      updated,
      total: companies.length,
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
