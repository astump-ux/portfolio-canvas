// Temporary debug endpoint - shows raw Stooq CSV entries + date comparison
const STOOQ_US_MAP = { 'NOW':'now.us', 'DDOG':'ddog.us' };
const STOOQ_MAP = { 'XIAOMI':'1810.hk' };

async function fetchStooq(symbol) {
  var now  = new Date();
  var d2   = now.toISOString().slice(0,10).replace(/-/g,'');
  var past = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  var d1   = past.toISOString().slice(0,10).replace(/-/g,'');
  var url  = 'https://stooq.com/q/d/l/?s=' + symbol + '&d1=' + d1 + '&d2=' + d2 + '&i=d';
  var res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  var csv  = await res.text();
  var lines = csv.trim().split('\n').filter(function(l){ return l && l.indexOf(',') !== -1; });
  return { firstLines: lines.slice(0,3), lastLines: lines.slice(-3), totalLines: lines.length };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  var target = '20260227';
  var results = {};
  for (var ticker of ['now.us', 'ddog.us', '1810.hk']) {
    try {
      var data = await fetchStooq(ticker);
      results[ticker] = { ...data, target };
    } catch(e) { results[ticker] = { error: e.message }; }
  }
  return res.status(200).json(results);
};
