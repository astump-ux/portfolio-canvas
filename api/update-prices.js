// /api/update-prices.js - Finnhub (US) + Stooq (International) - batched

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

const STOOQ_MAP = {
  'MUV2':'muv2.de','SREN':'sr9.de','TEG':'teg.de','DHL':'dhl.de',
  'WISE':'wise.uk','ORSTED':'d2g.de',
  'XIAOMI':'1810.hk','BYD':'1211.hk','HORIZON':'9660.hk','GEEKPLUS':'2590.hk',
};

function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

async function fetchFinnhub(sym, key) {
  var qRes = await fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(sym) + '&token=' + key);
  var mRes = await fetch('https://finnhub.io/api/v1/stock/metric?symbol=' + encodeURIComponent(sym) + '&metric=all&token=' + key);
  var quote = await qRes.json();
  var metrics = await mRes.json();
  var currentPrice = quote && quote.c ? String(Math.round(quote.c * 100) / 100) : null;
  var m = (metrics && metrics.metric) || {};
  var perf7d = m['5DayPriceReturnDaily'] != null
    ? Math.round(m['5DayPriceReturnDaily'] * 10) / 10
    : m['weekPriceReturnDaily'] != null
      ? Math.round(m['weekPriceReturnDaily'] * 10) / 10
      : null;
  return { currentPrice: currentPrice, perf7d: perf7d };
}

async function fetchStooq(symbol) {
  var now = new Date();
  var d2 = now.toISOString().slice(0,10).replace(/-/g,'');
  var past = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);
  var d1 = past.toISOString().slice(0,10).replace(/-/g,'');
  var url = 'https://stooq.com/q/d/l/?s=' + symbol + '&d1=' + d1 + '&d2=' + d2 + '&i=d';
  var res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  var csv = await res.text();
  var lines = csv.trim().split('\n').filter(function(l){ return l && !l.startsWith('Date') && l.indexOf(',') !== -1; });
  if (lines.length < 2) return null;
  var entries = lines.map(function(line){
    var cols = line.split(',');
    return { close: parseFloat(cols[4]) };
  }).filter(function(e){ return !isNaN(e.close); });
  if (!entries.length) return null;
  var latest = entries[entries.length - 1];
  var oldest = entries[0];
  var perf7d = (entries.length >= 2 && oldest.close && oldest.close !== latest.close)
    ? Math.round(((latest.close - oldest.close) / oldest.close) * 1000) / 10
    : null;
  return { currentPrice: String(Math.round(latest.close * 100) / 100), perf7d: perf7d };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  var FINNHUB_KEY = process.env.FINNHUB_KEY;
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set' });

  try {
    // 1. Load companies from JSONBin
    var jbRes = await fetch(
      'https://api.jsonbin.io/v3/b/' + JSONBIN_ID + '/latest',
      { headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' } }
    );
    var jbData = await jbRes.json();
    var companies = jbData && jbData.companies;
    if (!Array.isArray(companies)) companies = Object.values(companies || {});
    if (!companies.length) return res.status(200).json({ message: 'No companies found' });

    var dataMap = {};

    // 2a. Finnhub in batches of 10 with 1s pause between batches
    var usTickers = companies
      .map(function(c){ return { ticker: c.ticker, sym: FINNHUB_MAP[c.ticker] }; })
      .filter(function(x){ return x.sym; });

    var BATCH = 10;
    for (var i = 0; i < usTickers.length; i += BATCH) {
      var batch = usTickers.slice(i, i + BATCH);
      var results = await Promise.all(batch.map(async function(item) {
        try {
          var d = await fetchFinnhub(item.sym, FINNHUB_KEY);
          return { ticker: item.ticker, currentPrice: d.currentPrice, perf7d: d.perf7d };
        } catch(e) {
          return { ticker: item.ticker, currentPrice: null, perf7d: null };
        }
      }));
      results.forEach(function(r){ dataMap[r.ticker] = r; });
      if (i + BATCH < usTickers.length) await sleep(1000);
    }

    // 2b. Stooq for international — sequential with 300ms pause to avoid rate limit
    var intlTickers = companies
      .map(function(c){ return { ticker: c.ticker, sym: STOOQ_MAP[c.ticker] }; })
      .filter(function(x){ return x.sym; });

    for (var j = 0; j < intlTickers.length; j++) {
      var item = intlTickers[j];
      try {
        var data = await fetchStooq(item.sym);
        dataMap[item.ticker] = { ticker: item.ticker, currentPrice: data ? data.currentPrice : null, perf7d: data ? data.perf7d : null };
      } catch(e) {
        dataMap[item.ticker] = { ticker: item.ticker, currentPrice: null, perf7d: null };
      }
      if (j < intlTickers.length - 1) await sleep(300);
    }

    // 3. Update companies
    var updated = 0;
    var updatedCompanies = companies.map(function(c) {
      var d = dataMap[c.ticker];
      if (!d || !d.currentPrice) return c;
      updated++;
      return Object.assign({}, c, {
        currentPrice: d.currentPrice,
        perf7d: d.perf7d,
        priceUpdatedAt: new Date().toISOString(),
      });
    });

    // 4. Write back to JSONBin
    await fetch('https://api.jsonbin.io/v3/b/' + JSONBIN_ID, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify({ companies: updatedCompanies, pricesUpdatedAt: new Date().toISOString() }),
    });

    return res.status(200).json({
      success: true,
      updated: updated,
      total: companies.length,
      timestamp: new Date().toISOString(),
      usSample: updatedCompanies.slice(0,3).map(function(c){ return { ticker: c.ticker, currentPrice: c.currentPrice, perf7d: c.perf7d }; }),
      intlSample: updatedCompanies.filter(function(c){ return STOOQ_MAP[c.ticker]; }).map(function(c){ return { ticker: c.ticker, currentPrice: c.currentPrice, perf7d: c.perf7d }; }),
    });

  } catch(error) {
    return res.status(500).json({ error: error.message });
  }
}
