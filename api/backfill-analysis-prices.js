// /api/backfill-analysis-prices.js
// One-time backfill: fetches closing price at analysis date for each company.
// Uses Finnhub candles for US stocks, Stooq exchange-symbol for international.
// Skips companies that already have analysisPrice set.
// Safe to call multiple times — idempotent.

const JSONBIN_ID  = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';
const GITHUB_RAW  = process.env.GITHUB_INDEX_URL || '';

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

function sleep(ms) { return new Promise(function(r){ setTimeout(r,ms); }); }

function parseDDMMYYYY(s) {
  if (!s) return null;
  var m = s.match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return { y: parseInt(m[3]), mo: parseInt(m[2])-1, d: parseInt(m[1]) };
}

async function fetchFinnhubAtDate(sym, pd, key) {
  var from = new Date(Date.UTC(pd.y, pd.mo, pd.d - 5));
  var to   = new Date(Date.UTC(pd.y, pd.mo, pd.d + 1));
  var url = 'https://finnhub.io/api/v1/stock/candle?symbol=' + encodeURIComponent(sym)
    + '&resolution=D'
    + '&from=' + Math.floor(from.getTime()/1000)
    + '&to='   + Math.floor(to.getTime()/1000)
    + '&token=' + key;
  var res = await fetch(url);
  var data = await res.json();
  if (!data || data.s === 'no_data' || !data.c || !data.c.length) return null;
  var last = data.c[data.c.length - 1];
  return last ? String(Math.round(last * 100) / 100) : null;
}

async function fetchStooqAtDate(symbol, pd) {
  var target  = new Date(Date.UTC(pd.y, pd.mo, pd.d));
  var d1Date  = new Date(target.getTime() - 5 * 86400000);
  var d2Date  = new Date(target.getTime() + 2 * 86400000);
  var fmt = function(d){ return d.toISOString().slice(0,10).replace(/-/g,''); };
  var targetStr = String(pd.y) + String(pd.mo+1).padStart(2,'0') + String(pd.d).padStart(2,'0');
  var url = 'https://stooq.com/q/d/l/?s=' + symbol + '&d1=' + fmt(d1Date) + '&d2=' + fmt(d2Date) + '&i=d';
  var res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  var csv = await res.text();
  var lines = csv.trim().split('\n').filter(function(l){
    return l && !l.startsWith('Date') && l.indexOf(',') !== -1;
  });
  if (!lines.length) return null;
  var entries = lines.map(function(line){
    var cols = line.split(',');
    return { date: (cols[0]||'').replace(/-/g,''), close: parseFloat(cols[4]) };
  }).filter(function(e){ return !isNaN(e.close) && e.date <= targetStr; });
  if (!entries.length) return null;
  entries.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return String(Math.round(entries[0].close * 100) / 100);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  var FINNHUB_KEY = process.env.FINNHUB_KEY;
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set' });

  try {
    // Load companies from JSONBin
    var jbRes = await fetch(
      'https://api.jsonbin.io/v3/b/' + JSONBIN_ID + '/latest',
      { headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' } }
    );
    var jbData = await jbRes.json();
    var companies = jbData && jbData.companies;
    if (!Array.isArray(companies)) companies = Object.values(companies || {});
    if (!companies.length) return res.status(200).json({ message: 'No companies found' });

    var toFetch = companies.filter(function(c){
      return !c.analysisPrice && c.priceDate && (FINNHUB_MAP[c.ticker] || STOOQ_MAP[c.ticker]);
    });

    if (!toFetch.length) {
      return res.status(200).json({ message: 'All companies already have analysisPrice', total: companies.length });
    }

    var results = [];
    for (var i = 0; i < toFetch.length; i++) {
      var c = toFetch[i];
      var pd = parseDDMMYYYY(c.priceDate);
      var price = null;
      var source = null;
      if (!pd) { results.push({ ticker: c.ticker, price: null, reason: 'bad date: '+c.priceDate }); continue; }
      try {
        if (FINNHUB_MAP[c.ticker]) {
          price = await fetchFinnhubAtDate(FINNHUB_MAP[c.ticker], pd, FINNHUB_KEY);
          source = 'finnhub';
        } else if (STOOQ_MAP[c.ticker]) {
          price = await fetchStooqAtDate(STOOQ_MAP[c.ticker], pd);
          source = 'stooq:' + STOOQ_MAP[c.ticker];
        }
      } catch(e) { results.push({ ticker: c.ticker, price: null, reason: e.message }); continue; }
      results.push({ ticker: c.ticker, price: price, source: source, date: c.priceDate });
      if (i < toFetch.length - 1) await sleep(400);
    }

    // Merge into companies and write back
    var priceMap = {};
    results.forEach(function(r){ if (r.price) priceMap[r.ticker] = r.price; });
    var updatedCompanies = companies.map(function(c){
      if (c.analysisPrice || !priceMap[c.ticker]) return c;
      return Object.assign({}, c, { analysisPrice: priceMap[c.ticker] });
    });

    await fetch('https://api.jsonbin.io/v3/b/' + JSONBIN_ID, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify(Object.assign({}, jbData, { companies: updatedCompanies })),
    });

    return res.status(200).json({
      success: true,
      fetched: results.filter(function(r){ return r.price; }).length,
      failed:  results.filter(function(r){ return !r.price; }).length,
      details: results,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
