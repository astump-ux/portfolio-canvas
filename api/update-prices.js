// /api/update-prices.js - Finnhub (US) + Stooq (International) - batched
// analysisPrice extracted for free from already-fetched Stooq CSVs (60-day window)

const JSONBIN_ID  = '69b68c14aa77b81da9e78b7e';
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

const STOOQ_US_MAP = {
  'DDOG':'ddog.us','TEAM':'team.us','WDAY':'wday.us','NOW':'now.us','CRM':'crm.us',
  'HUBS':'hubs.us','SNOW':'snow.us','PANW':'panw.us','GOOGL':'googl.us','OKTA':'okta.us',
  'AMZN':'amzn.us','META':'meta.us','MSFT':'msft.us','FSLR':'fslr.us','FLNC':'flnc.us',
  'NFLX':'nflx.us','MDT':'mdt.us','ISRG':'isrg.us','MU':'mu.us','NU':'nu.us',
  'TSMC':'tsm.us','UBER':'uber.us','TEM':'tem.us','UPWK':'upwk.us','VEEV':'veev.us',
  'DT':'dt.us','BABA':'baba.us','TCEHY':'tcehy.us',
};

function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

function parseDDMMYYYY(s) {
  if (!s) return null;
  var m = s.match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return m[3] + m[2].padStart(2,'0') + m[1].padStart(2,'0');
}

function priceAtDate(entries, targetYYYYMMDD) {
  if (!entries || !entries.length || !targetYYYYMMDD) return null;
  var candidates = entries.filter(function(e){ return e.date <= targetYYYYMMDD; });
  if (!candidates.length) return null;
  candidates.sort(function(a, b){ return b.date > a.date ? 1 : -1; });
  return String(Math.round(candidates[0].close * 100) / 100);
}

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
  var now  = new Date();
  var d2   = now.toISOString().slice(0,10).replace(/-/g,'');
  var past = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  var d1   = past.toISOString().slice(0,10).replace(/-/g,'');
  var url  = 'https://stooq.com/q/d/l/?s=' + symbol + '&d1=' + d1 + '&d2=' + d2 + '&i=d';
  var res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  var csv  = await res.text();
  var lines = csv.trim().split('\n').filter(function(l){
    return l && !l.startsWith('Date') && l.indexOf(',') !== -1;
  });
  if (lines.length < 2) return null;
  var entries = lines.map(function(line){
    var cols = line.split(',');
    return { date: (cols[0]||'').replace(/-/g,''), close: parseFloat(cols[4]) };
  }).filter(function(e){ return !isNaN(e.close); });
  if (!entries.length) return null;
  var latest    = entries[entries.length - 1];
  var oldest    = entries[0];
  var week7entry = entries[Math.max(0, entries.length - 6)];
  var perf7d = (week7entry && week7entry.close !== latest.close)
    ? Math.round(((latest.close - week7entry.close) / week7entry.close) * 1000) / 10
    : null;
  var perf1m = (entries.length >= 3 && oldest.close !== latest.close)
    ? Math.round(((latest.close - oldest.close) / oldest.close) * 1000) / 10
    : null;
  return { currentPrice: String(Math.round(latest.close * 100) / 100), perf7d: perf7d, perf1m: perf1m, entries: entries };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  var FINNHUB_KEY = process.env.FINNHUB_KEY;
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set' });

  try {
    var jbRes = await fetch(
      'https://api.jsonbin.io/v3/b/' + JSONBIN_ID + '/latest',
      { headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' } }
    );
    var jbData = await jbRes.json();
    var companies = jbData && jbData.companies;
    if (!Array.isArray(companies)) companies = Object.values(companies || {});
    if (!companies.length) return res.status(200).json({ message: 'No companies found' });

    var dataMap = {};

    // 2a. Finnhub — current price + 7d perf for US tickers
    var usTickers = companies
      .map(function(c){ return { ticker: c.ticker, sym: FINNHUB_MAP[c.ticker] }; })
      .filter(function(x){ return x.sym; });
    for (var i = 0; i < usTickers.length; i += 10) {
      var batch = usTickers.slice(i, i + 10);
      var batchResults = await Promise.all(batch.map(async function(item) {
        try {
          var d = await fetchFinnhub(item.sym, FINNHUB_KEY);
          return { ticker: item.ticker, currentPrice: d.currentPrice, perf7d: d.perf7d };
        } catch(e) { return { ticker: item.ticker, currentPrice: null, perf7d: null }; }
      }));
      batchResults.forEach(function(r){ dataMap[r.ticker] = r; });
      if (i + 10 < usTickers.length) await sleep(1000);
    }

    // 2b. Stooq intl — current price, perf, AND analysisPrice from same CSV
    var intlTickers = companies
      .map(function(c){ return { ticker: c.ticker, sym: STOOQ_MAP[c.ticker], co: c }; })
      .filter(function(x){ return x.sym; });
    for (var j = 0; j < intlTickers.length; j++) {
      var item = intlTickers[j];
      try {
        var data = await fetchStooq(item.sym);
        dataMap[item.ticker] = {
          ticker:       item.ticker,
          currentPrice: data ? data.currentPrice : null,
          perf7d:       data ? data.perf7d : null,
          perf1m:       data ? data.perf1m : null,
          analysisPrice: (!item.co.analysisPrice && data && data.entries)
            ? priceAtDate(data.entries, parseDDMMYYYY(item.co.priceDate)) : null,
        };
      } catch(e) { dataMap[item.ticker] = { ticker: item.ticker, currentPrice: null, perf7d: null }; }
      if (j < intlTickers.length - 1) await sleep(300);
    }

    // 2c. Stooq US — perf1m AND analysisPrice from same CSV
    var usStooqTickers = companies
      .map(function(c){ return { ticker: c.ticker, sym: STOOQ_US_MAP[c.ticker], co: c }; })
      .filter(function(x){ return x.sym; });
    for (var k = 0; k < usStooqTickers.length; k++) {
      var usItem = usStooqTickers[k];
      try {
        var usData = await fetchStooq(usItem.sym);
        if (dataMap[usItem.ticker]) {
          dataMap[usItem.ticker].perf1m = usData ? usData.perf1m : null;
          if (!usItem.co.analysisPrice && usData && usData.entries) {
            dataMap[usItem.ticker].analysisPrice =
              priceAtDate(usData.entries, parseDDMMYYYY(usItem.co.priceDate));
          }
        }
      } catch(e) {}
      if (k < usStooqTickers.length - 1) await sleep(300);
    }

    // 3. Update companies
    var updated = 0;
    var updatedCompanies = companies.map(function(c) {
      var d = dataMap[c.ticker];
      if (!d || !d.currentPrice) return c;
      updated++;
      return Object.assign({}, c, {
        currentPrice:   d.currentPrice,
        perf7d:         d.perf7d,
        perf1m:         d.perf1m != null ? d.perf1m : (c.perf1m || null),
        priceUpdatedAt: new Date().toISOString(),
      });
    });

    // 4. Write back to JSONBin — preserve newsCache and other existing fields
    await fetch('https://api.jsonbin.io/v3/b/' + JSONBIN_ID, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify(Object.assign({}, jbData, {
        companies: updatedCompanies,
        pricesUpdatedAt: new Date().toISOString(),
      })),
    });

    return res.status(200).json({
      success: true,
      updated: updated,
      total: companies.length,
      analysisPricesFilled: updatedCompanies.filter(function(c){ return c.analysisPrice; }).length,
      analysisPriceSample: updatedCompanies.filter(function(c){ return c.analysisPrice; }).slice(0,5)
        .map(function(c){ return { ticker: c.ticker, analysisPrice: c.analysisPrice, priceDate: c.priceDate }; }),
      timestamp: new Date().toISOString(),
    });

  } catch(error) {
    return res.status(500).json({ error: error.message });
  }
}
