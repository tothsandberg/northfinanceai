// api/lead-capture.js
// Vercel serverless function that:
//   1. Receives lead-capture POSTs from the CFO-Diagnose popup
//   2. Emails Krisztina with the full diagnosis
//   3. Emails the customer a confirmation
//
// Required env var:  RESEND_API_KEY  (set in Vercel → Settings → Environments → Production)
// No npm packages required — uses fetch + Resend's REST API directly.

// ─── CONFIG ────────────────────────────────────────────────────────────────
const OWNER_EMAIL = 'krisztina@northfinanceai.com';

// Sender address. Domain (northfinanceai.com) must be verified in Resend.
const FROM_EMAIL = 'North Finance AI <noreply@northfinanceai.com>';
// ───────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = req.body || {};

    // Honeypot: bots fill hidden fields. Silently accept and discard.
    if (data.website) {
      return res.status(200).json({ ok: true });
    }

    // Server-side validation (never trust the client)
    if (!data.name || !data.company || !data.phone || !data.email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (String(data.phone).replace(/\D/g, '').length < 6) {
      return res.status(400).json({ error: 'Invalid phone' });
    }

    const submittedAt = new Date(data.submitted_at || Date.now())
      .toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin',
        dateStyle: 'long',
        timeStyle: 'short'
      });

    const diag = data.diagnosis || {};

    // ─── Email 1: Notification to Krisztina ─────────────────────────────────
    const ownerHtml = `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 640px; color: #2a2a2a;">
        <h2 style="color: #0a1f3d; border-bottom: 2px solid #c9a961; padding-bottom: 8px;">
          Neue CFO-Diagnose Anfrage
        </h2>
        <p style="color: #777; font-size: 13px;">Eingegangen ${submittedAt}</p>

        <h3 style="color: #0a1f3d; margin-top: 28px;">Kontakt</h3>
        <table cellpadding="8" style="border-collapse: collapse; font-size: 15px;">
          <tr><td><strong>Name:</strong></td><td>${esc(data.name)}</td></tr>
          <tr><td><strong>Unternehmen:</strong></td><td>${esc(data.company)}</td></tr>
          <tr><td><strong>Telefon:</strong></td><td><a href="tel:${esc(data.phone)}" style="color: #c9a961;">${esc(data.phone)}</a></td></tr>
          <tr><td><strong>E-Mail:</strong></td><td><a href="mailto:${esc(data.email)}" style="color: #c9a961;">${esc(data.email)}</a></td></tr>
        </table>

        <h3 style="color: #0a1f3d; margin-top: 28px;">Diagnose-Antworten</h3>
        <table cellpadding="8" style="border-collapse: collapse; font-size: 15px;">
          <tr><td><strong>Größter Schmerz:</strong></td><td>${esc(diag.pain || '—')}</td></tr>
          ${diag.pain_text ? `<tr><td><strong>Eigene Beschreibung:</strong></td><td>${esc(diag.pain_text)}</td></tr>` : ''}
          <tr><td><strong>Branche:</strong></td><td>${esc(diag.industry || '—')}</td></tr>
          <tr><td><strong>Setup:</strong></td><td>${esc(diag.setup || '—')}</td></tr>
          <tr><td><strong>Auslöser:</strong></td><td>${esc(diag.trigger || '—')}</td></tr>
        </table>

        ${diag.ai_response ? `
          <h3 style="color: #0a1f3d; margin-top: 28px;">KI-Analyse, die der Kunde gesehen hat</h3>
          <div style="background: #f5f0e6; border-left: 3px solid #c9a961; padding: 16px; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${esc(diag.ai_response)}</div>
        ` : ''}

        <p style="color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
          Quelle: ${esc(data.source || '—')}<br>
          URL: ${esc(data.url || '—')}
        </p>
      </div>
    `;

    await sendEmail({
      from: FROM_EMAIL,
      to: OWNER_EMAIL,
      reply_to: data.email,
      subject: `Neue Rücksprache-Anfrage: ${data.name} (${data.company})`,
      html: ownerHtml
    });

    // ─── Email 2: Confirmation to the customer ─────────────────────────────
    const customerHtml = `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; color: #2a2a2a; line-height: 1.6;">
        <p>Sehr geehrte/r ${esc(data.name)},</p>

        <p>vielen Dank für Ihre Anfrage. Wir haben Ihre Angaben erhalten und Krisztina wird sich <strong>innerhalb von 24 Stunden</strong> persönlich auf der von Ihnen angegebenen Nummer (${esc(data.phone)}) bei Ihnen melden.</p>

        <p>Im Gespräch konkretisieren wir die Hebel auf Ihre Zahlen und sagen Ihnen, ob ein Projekt sinnvoll ist. Wenn nicht, sagen wir das auch — die Rücksprache ist kostenlos und ohne Folgekosten.</p>

        <p>Falls Sie zwischenzeitlich unmittelbar Rücksprache wünschen, erreichen Sie uns direkt unter <a href="mailto:krisztina@northfinanceai.com" style="color: #c9a961;">krisztina@northfinanceai.com</a>.</p>

        <p style="margin-top: 32px;">
          Mit freundlichen Grüßen<br>
          <strong>Krisztina Toth</strong><br>
          North Finance AI
        </p>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 28px 0;">
        <p style="font-size: 12px; color: #888;">
          Diese E-Mail ist eine automatische Bestätigung Ihrer Anfrage über northfinanceai.com.<br>
          DSGVO-konform · Keine Weitergabe an Dritte · Abmeldung jederzeit per Antwort an diese E-Mail.
        </p>
      </div>
    `;

    await sendEmail({
      from: FROM_EMAIL,
      to: data.email,
      reply_to: OWNER_EMAIL,
      subject: 'Ihre Anfrage bei North Finance AI ist eingegangen',
      html: customerHtml
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    // Full error visible in Vercel function logs, but not leaked to the client.
    console.error('Lead capture failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

async function sendEmail({ from, to, reply_to, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, reply_to, subject, html })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorBody}`);
  }
  return response.json();
}

// Minimal HTML escaper to prevent injection in the email bodies.
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
