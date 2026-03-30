// /api/historical-price.js
// Fetches closing prices for a batch of tickers at their analysis dates
// Query: ?data=[{"ticker":"NOW","date":"27.02.2026"},...]  (JSON, URL-encoded)
// Returns: {"NOW":"103.45","TEAM":"79.12",...}

const STOOQ_MAP = {
  'DDOG':'ddog.us','TEAM':'team.us','WDAY':'wday.us','NOW':'now.us','CRM':'crm.us',
  'HUBS':'hubs.us','SNOW':'snow.us','PANW':'panw.us','GOOGL':'googl.us','OKTA':'okta.us',
  'AMZN':'amzn.us','META':'meta.us','MSFT':'msft.us','FSLR':'fslr.us','FLNC':'flnc.us',
  'NFLX':'nflx.us','MDT':'mdt.us','ISRG':'isrg.us','MU':'mu.us','NU':'nu.us',
  'TSMC':'tsm.us','UBER':'uber.us','TEM':'tem.us','UPWK':'upwk.us','VEEV':'veev.us',
  'DT':'dt.us','BABA':'baba.us','TCEHY':'tcehy.us',
  // International
  'MUV2':'muv2.de','SREN':'sr9.de','TEG':'teg.de','DHL':'dhl.de',
  'WISE':'wise.uk','ORSTED':'d2g.de',
  'XIAOMI':'1810.hk','BYD':'1211.hk','HORIZON':'9660.hk','GEEKPLUS':'2590.hk',
};

function parseDDMMYYYY(s) {
  if (!s) return null;
  // Handle "27.02.2026" or "~$103" style — only parse if matches date pattern
  var m = s.match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return m[3] + m[2].padStart(2,'0') + m[1].padStart(2,'0'); // YYYYMMDD
}

function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

async function fetchStooqAtDate(symbol, targetYYYYMMDD) {
  // Fetch 7 days around the target date (to handle weekends/holidays)
  var target = new Date(
    parseInt(targetYYYYMMDD.slice(0,4)),
    parseInt(targetYYYYMMDD.slice(4,6)) - 1,
    parseInt(targetYYYYMMDD.slice(6,8))
  );
  var d1Date = new Date(target.getTime() - 5 * 86400000);
  var d2Date = new Date(target.getTime() + 2 * 86400000);
  var d1 = d1Date.toISOString().slice(0,10).replace(/-/g,'');
  var d2 = d2Date.toISOString().slice(0,10).replace(/-/g,'');

  var url = 'https://stooq.com/q/d/l/?s=' + symbol + '&d1=' + d1 + '&d2=' + d2 + '&i=d';
  var res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  var csv = await res.text();
  var lines = csv.trim().split('\n').filter(function(l){
    return l && !l.startsWith('Date') && l.indexOf(',') !== -1;
  });
  if (!lines.length) return null;

  // Find the entry closest to (and not after) the target date
  var entries = lines.map(function(line){
    var cols = line.split(',');
    return { date: cols[0].replace(/-/g,''), close: parseFloat(cols[4]) };
  }).filter(function(e){ return !isNaN(e.close) && e.date <= targetYYYYMMDD; });

  if (!entries.length) return null;
  // Sort descending by date, take closest
  entries.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  var price = entries[0].close;
  return String(Math.round(price * 100) / 100);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var dataParam = req.query && req.query.data;
  if (!dataParam) return res.status(400).json({ error: 'Missing data param' });

  var items;
  try { items = JSON.parse(dataParam); }
  catch(e) { return res.status(400).json({ error: 'Invalid JSON in data param' }); }

  if (!Array.isArray(items) || !items.length) return res.status(200).json({});

  var result = {};

  for (var i = 0; i < items.length; i++) {
    var ticker = items[i].ticker;
    var date = items[i].date; // DD.MM.YYYY
    var sym = STOOQ_MAP[ticker];
    if (!sym) { result[ticker] = null; continue; }
    var yyyymmdd = parseDDMMYYYY(date);
    if (!yyyymmdd) { result[ticker] = null; continue; }
    try {
      var price = await fetchStooqAtDate(sym, yyyymmdd);
      result[ticker] = price;
    } catch(e) {
      result[ticker] = null;
    }
    if (i < items.length - 1) await sleep(250);
  }

  return res.status(200).json(result);
};
