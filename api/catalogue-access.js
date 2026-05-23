// api/catalogue-access.js
// Validates a catalogue access code and emails Krisztina each time:
//   - on SUCCESS: who accessed, when, from where
//   - on FAILURE: which code was tried, IP, browser (so attacks are visible)
//
// Required env vars:
//   RESEND_API_KEY    (already set from lead-capture)
//   CATALOGUE_CODES   (JSON string — see below)
//
// CATALOGUE_CODES format (paste this as the Value in Vercel):
//   {"MUELLER-XY42":{"name":"Hans Müller","company":"Müller GmbH","issued":"2026-05-23"}}
//
// Add new codes by editing the env var in Vercel → Settings → Environments → Production.

const OWNER_EMAIL = 'krisztina@northfinanceai.com';
const FROM_EMAIL = 'North Finance AI <noreply@northfinanceai.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const submittedCode = String((req.body && req.body.code) || '').trim().toUpperCase();
  if (!submittedCode) {
    return res.status(400).json({ error: 'Missing code' });
  }

  // Parse the code list from env var
  let codesData;
  try {
    codesData = JSON.parse(process.env.CATALOGUE_CODES || '{}');
  } catch (e) {
    console.error('Invalid CATALOGUE_CODES env var:', e);
    return res.status(500).json({ error: 'Configuration error' });
  }

  // Case-insensitive match (codes are stored uppercase in the env var)
  const codeMatch = codesData[submittedCode];

  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
  const userAgent = String(req.headers['user-agent'] || 'unknown');
  const referer = String(req.headers['referer'] || 'direkt');
  const timestamp = new Date().toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'medium'
  });

  if (!codeMatch) {
    // INVALID CODE → notify Krisztina so she sees attack attempts
    try {
      await sendEmail({
        to: OWNER_EMAIL,
        subject: '⚠️ Katalog-Zugang FEHLGESCHLAGEN',
        html: `
          <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a;">
            <h2 style="color: #c53030;">Ungültiger Zugangsversuch</h2>
            <p>Jemand hat versucht, mit einem ungültigen Code auf den Leistungskatalog zuzugreifen.</p>

            <table cellpadding="8" style="border-collapse: collapse; font-size: 14px; margin-top: 20px;">
              <tr><td><strong>Versuchter Code:</strong></td><td><code style="background: #f5f5f5; padding: 2px 6px;">${esc(submittedCode)}</code></td></tr>
              <tr><td><strong>Zeit:</strong></td><td>${timestamp}</td></tr>
              <tr><td><strong>IP-Adresse:</strong></td><td>${esc(ip)}</td></tr>
              <tr><td><strong>Browser:</strong></td><td style="font-size: 12px;">${esc(userAgent)}</td></tr>
              <tr><td><strong>Herkunft:</strong></td><td style="font-size: 12px;">${esc(referer)}</td></tr>
            </table>

            <p style="color: #777; font-size: 12px; margin-top: 24px;">
              Einzelne Fehlversuche sind normal (Tippfehler). Mehrere Versuche aus derselben IP innerhalb weniger Minuten könnten einen Angriff bedeuten.
            </p>
          </div>
        `
      });
    } catch (err) {
      console.error('Failed to send failure notification:', err);
    }
    return res.status(401).json({ error: 'Invalid code' });
  }

  // VALID CODE → log access + return customer info
  try {
    await sendEmail({
      to: OWNER_EMAIL,
      subject: `📖 Katalog geöffnet: ${codeMatch.name} (${codeMatch.company})`,
      html: `
        <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a;">
          <h2 style="color: #0a1f3d; border-bottom: 2px solid #c9a961; padding-bottom: 8px;">
            Leistungskatalog wurde geöffnet
          </h2>

          <table cellpadding="8" style="border-collapse: collapse; font-size: 15px; margin-top: 20px;">
            <tr><td><strong>Kunde:</strong></td><td>${esc(codeMatch.name)}</td></tr>
            <tr><td><strong>Unternehmen:</strong></td><td>${esc(codeMatch.company)}</td></tr>
            <tr><td><strong>Code:</strong></td><td><code style="background: #f5f0e6; padding: 2px 6px;">${esc(submittedCode)}</code></td></tr>
            <tr><td><strong>Code ausgegeben:</strong></td><td>${esc(codeMatch.issued || '—')}</td></tr>
            <tr><td><strong>Zugriff am:</strong></td><td>${timestamp}</td></tr>
            <tr><td><strong>IP-Adresse:</strong></td><td>${esc(ip)}</td></tr>
          </table>

          <div style="background: #f5f0e6; border-left: 3px solid #c9a961; padding: 16px; margin-top: 24px;">
            <p style="margin: 0; font-style: italic; color: #6b5530;">
              <strong>💡 Sales-Signal:</strong> Wenn dieser Kunde den Katalog mehrfach innerhalb einer Woche öffnet, ist das ein starkes Kaufsignal. Sie können dann proaktiv nachfassen.
            </p>
          </div>
        </div>
      `
    });
  } catch (err) {
    // Don't block the customer if the notification email fails — still grant access.
    console.error('Failed to send access notification:', err);
  }

  return res.status(200).json({
    ok: true,
    customer: {
      name: codeMatch.name,
      company: codeMatch.company
    }
  });
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: to,
      subject: subject,
      html: html
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorBody}`);
  }
  return response.json();
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
