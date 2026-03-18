// /api/update-prices.js - Finnhub (US) + Stooq (International)

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';

const FINNHUB_MAP = {
  'DDOG':'DDOG','TEAM':'TEAM','WDAY':'WDAY','NOW':'NOW','CRM':'CRM',
  'HUBS':'HUBS','SNOW':'SNOW','PANW':'PANW','GOOGL':'GOOGL','OKTA':'OKTA',
  'AMZN':'AMZN','META':'META','MSFT':'MSFT','FSLR':'FSLR','FLNC':'FLNC',
  'NFLX':'NFLX','MDT':'MDT','ISRG':'ISRG','MU':'MU','NU':'NU',
  'TSMC':'TSM','UBER':'UBER','TEM':'TEM','UPWK':'UPWK','VEEV':'VEEV',
  'DT':'DT','BABA':'BABA','TCEHY':'TCEHY',
};

// Stooq symbols for international tickers
const STOOQ_MAP = {
  'MUV2':   'muv2.de',
  'SREN':   'sren.sw',
  'TEG':    'teg.de',
  'DHL':    'dhl.de',
  'WISE':   'wise.l',
  'ORSTED': 'orsted.co',
  'XIAOMI': '1810.hk',
  'BYD':    '1211.hk',
  'HORIZON':'9660.hk',
  'GEEKPLUS':'2030.hk',
};

// Fetch Stooq CSV with explicit 12-day date range for accurate 7d perf
async function fetchStooq(symbol) {
  const now = new Date();
  const d2 = now.toISOString().slice(0,10).replace(/-/g,'');
  const past = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);
  const d1 = past.toISOString().slice(0,10).replace(/-/g,'');
  const res = await fetch(
    `https://stooq.com/q/d/l/?s=${symbol}&d1=${d1}&d2=${d2}&i=d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const csv = await res.text();
  const lines = csv.trim().split('
').filter(l => l && !l.startsWith('Date') && l.includes(','));
  if (lines.length < 2) return null;
  const parse = line => { const cols = line.split(','); return { close: parseFloat(cols[4]) }; };
  const entries = lines.map(parse).filter(e => !isNaN(e.close));
  if (!entries.length) return null;
  const latest = entries[entries.length - 1];
  const oldest = entries[0];
  const perf7d = (entries.length >= 2 && oldest.close && oldest.close !== latest.close)
    ? Math.round(((latest.close - oldest.close) / oldest.close) * 1000) / 10
    : null;
  return { currentPrice: String(Math.round(latest.close * 100) / 100), perf7d };
}

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

    // 2a. Fetch Finnhub quotes for US tickers
    const usTickers = companies
      .map(c => ({ ticker: c.ticker, sym: FINNHUB_MAP[c.ticker] }))
      .filter(x => x.sym);

    const finnhubResults = await Promise.all(usTickers.map(async ({ ticker, sym }) => {
      try {
        const [qRes, mRes] = await Promise.all([
          fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`),
          fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${FINNHUB_KEY}`)
        ]);
        const [quote, metrics] = await Promise.all([qRes.json(), mRes.json()]);
        const currentPrice = quote?.c ? String(Math.round(quote.c * 100) / 100) : null;
        const m = metrics?.metric || {};
        const perf7d = m['5DayPriceReturnDaily'] != null
          ? Math.round(m['5DayPriceReturnDaily'] * 10) / 10
          : m['weekPriceReturnDaily'] != null
            ? Math.round(m['weekPriceReturnDaily'] * 10) / 10
            : null;
        return { ticker, currentPrice, perf7d };
      } catch(e) {
        return { ticker, currentPrice: null, perf7d: null };
      }
    }));

    // 2b. Fetch Stooq data for international tickers
    const intlTickers = companies
      .map(c => ({ ticker: c.ticker, sym: STOOQ_MAP[c.ticker] }))
      .filter(x => x.sym);

    const stooqResults = await Promise.all(intlTickers.map(async ({ ticker, sym }) => {
      try {
        const data = await fetchStooq(sym);
        return { ticker, currentPrice: data?.currentPrice || null, perf7d: data?.perf7d || null };
      } catch(e) {
        return { ticker, currentPrice: null, perf7d: null };
      }
    }));

    // 3. Merge results
    const dataMap = {};
    [...finnhubResults, ...stooqResults].forEach(r => { dataMap[r.ticker] = r; });

    let updated = 0;
    const updatedCompanies = companies.map(c => {
      const d = dataMap[c.ticker];
      if (!d?.currentPrice) return c;
      updated++;
      return {
        ...c,
        currentPrice: d.currentPrice,
        perf7d: d.perf7d,
        priceUpdatedAt: new Date().toISOString(),
      };
    });

    // 4. Write back to JSONBin
    await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify({ companies: updatedCompanies, pricesUpdatedAt: new Date().toISOString() }),
    });

    const intlSample = updatedCompanies
      .filter(c => STOOQ_MAP[c.ticker])
      .slice(0, 5)
      .map(c => ({ ticker: c.ticker, currentPrice: c.currentPrice, perf7d: c.perf7d }));

    return res.status(200).json({
      success: true,
      updated,
      total: companies.length,
      timestamp: new Date().toISOString(),
      usSample: updatedCompanies.slice(0, 3).map(c => ({ ticker: c.ticker, currentPrice: c.currentPrice, perf7d: c.perf7d })),
      intlSample,
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
