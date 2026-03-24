// api/check-events.js
// Runs daily via Vercel Cron — checks JSONBin for events in 2 days, sends email via Resend

const JSONBIN_ID = '69b68c14aa77b81da9e78b7e';
const JSONBIN_KEY = '$2a$10$ehBtWQSMp.KI0cqlW569/OT9CjP9tSioF3M3edlZXSC1XiV3vI7Z2';
const RESEND_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;

module.exports = async function handler(req, res) {
  // Allow manual trigger via GET, cron via GET as well
  if (req.method !== 'GET') { res.status(405).end(); return; }

  if (!RESEND_KEY || !NOTIFY_EMAIL) {
    res.status(500).json({ error: 'RESEND_API_KEY or NOTIFY_EMAIL not set' }); return;
  }

  try {
    // Load portfolio from JSONBin
    const r = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' }
    });
    const data = await r.json();
    const companies = Array.isArray(data.companies) ? data.companies : [];

    // Find events in exactly 2 days (± 1 day window)
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + 2);
    target.setHours(0, 0, 0, 0);

    const upcoming = [];
    for (const co of companies) {
      for (const ev of (co.events || [])) {
        if (!ev.title || !ev.dateSort) continue;
        const d = new Date(ev.dateSort);
        if (isNaN(d.getTime())) continue;
        d.setHours(0, 0, 0, 0);
        const diffDays = Math.round((d - now) / (1000 * 60 * 60 * 24));
        if (diffDays === 2) {
          upcoming.push({ co, ev, diffDays });
        }
      }
    }

    if (upcoming.length === 0) {
      res.status(200).json({ message: 'No events in 2 days', checked: companies.length });
      return;
    }

    // Build email HTML
    const rows = upcoming.map(({ co, ev }) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;">
          <strong style="color:#1E293B;">${co.name}</strong>
          <span style="color:#64748B;font-size:12px;margin-left:6px;">${co.ticker}</span>
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;color:#1E293B;">${ev.title}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;color:#0052FF;font-weight:600;">${ev.date}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;">${ev.desc || '–'}</td>
      </tr>
    `).join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Segoe UI',system-ui,sans-serif;background:#F8FAFC;margin:0;padding:32px;">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 6px -1px rgb(0 0 0/0.07);overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0052FF,#6B9FFF);padding:28px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800;">📅 Upcoming Events — In 2 Tagen</h1>
      <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px;">${new Date().toLocaleDateString('de-DE', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
    </div>
    <div style="padding:24px 32px;">
      <p style="color:#64748B;font-size:13px;margin-bottom:20px;">
        ${upcoming.length} Event${upcoming.length > 1 ? 's stehen' : ' steht'} in 2 Tagen an:
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#F8FAFC;">
            <th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748B;font-weight:700;border-bottom:2px solid #E2E8F0;">Aktie</th>
            <th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748B;font-weight:700;border-bottom:2px solid #E2E8F0;">Event</th>
            <th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748B;font-weight:700;border-bottom:2px solid #E2E8F0;">Datum</th>
            <th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748B;font-weight:700;border-bottom:2px solid #E2E8F0;">Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding:16px 32px 24px;border-top:1px solid #E2E8F0;">
      <a href="https://portfolio-canvas-ten.vercel.app" style="display:inline-block;background:#0052FF;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
        Portfolio öffnen →
      </a>
    </div>
    <div style="padding:12px 32px 20px;">
      <p style="font-size:11px;color:#94A3B8;margin:0;">Aktienanalyse Canvas v2.2 · Automatische Benachrichtigung</p>
    </div>
  </div>
</body>
</html>`;

    // Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Portfolio Canvas <onboarding@resend.dev>',
        to: [NOTIFY_EMAIL],
        subject: `📅 ${upcoming.length} Event${upcoming.length > 1 ? 's' : ''} in 2 Tagen — ${upcoming.map(u => u.co.ticker).join(', ')}`,
        html
      })
    });

    const emailData = await emailRes.json();
    if (!emailRes.ok) throw new Error(emailData.message || 'Resend error');

    res.status(200).json({
      sent: true,
      events: upcoming.length,
      tickers: upcoming.map(u => u.co.ticker),
      emailId: emailData.id
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
