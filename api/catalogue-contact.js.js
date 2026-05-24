// api/catalogue-contact.js
// Handles Detail-Call requests from customers viewing the catalogue.
// The customer authenticated with a code → that code is in their sessionStorage.
// Frontend POSTs the code (and optional message); this endpoint looks up the
// customer from KV (server-side authoritative), then sends:
//   1) A rich notification email to Krisztina (Reply-To set to customer)
//   2) A confirmation email to the customer
//
// Required env vars:
//   RESEND_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN

const OWNER_EMAIL = 'krisztina@northfinanceai.com';
const FROM_EMAIL = 'North Finance AI <noreply@northfinanceai.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  const optionalMessage = String((req.body && req.body.message) || '').trim().slice(0, 2000);

  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  // ─── Verify the code is active and look up customer ───
  let customer = null;
  try {
    customer = await kvGet(`catalogue:active:${code}`);
  } catch (e) {
    console.error('KV lookup failed:', e);
    return res.status(500).json({ error: 'Server error' });
  }

  if (!customer) {
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  if (!customer.email) {
    // Code is valid but stored record lacks email — shouldn't happen in production
    // but defend against legacy/manual records
    console.error('Customer record missing email for code:', code);
    return res.status(500).json({ error: 'Customer record incomplete' });
  }

  const timestamp = new Date().toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'short'
  });

  // ─── Send notification to Krisztina ───
  try {
    await sendEmail({
      to: OWNER_EMAIL,
      replyTo: customer.email, // hitting "Reply" goes straight to the customer
      subject: `🎯 Detail-Call angefragt — ${customer.name}${customer.company ? ' (' + customer.company + ')' : ''}`,
      html: `
        <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 600px; color: #2a2a2a; line-height: 1.6;">
          <div style="border-top: 3px solid #b8935a; padding-top: 24px;">
            <div style="font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #b8935a; font-weight: 700; margin-bottom: 8px;">
              Heißer Lead
            </div>
            <h2 style="margin: 0 0 16px; color: #0a1f3d; font-size: 24px; font-weight: 500;">
              Detail-Call aus dem Leistungskatalog angefragt
            </h2>
          </div>

          <p style="margin: 0 0 20px;">
            <strong>${esc(customer.name)}</strong>${customer.company ? ' von <strong>' + esc(customer.company) + '</strong>' : ''} hat den Leistungskatalog durchgelesen und einen Detail-Call angefragt.
          </p>

          <div style="background: #f7f3ec; padding: 20px 24px; margin: 24px 0; border-left: 3px solid #b8935a;">
            <table cellpadding="6" style="border-collapse: collapse; font-size: 14px;">
              <tr><td style="color: #777;"><strong>Name:</strong></td><td>${esc(customer.name)}</td></tr>
              ${customer.company ? `<tr><td style="color: #777;"><strong>Firma:</strong></td><td>${esc(customer.company)}</td></tr>` : ''}
              <tr><td style="color: #777;"><strong>E-Mail:</strong></td><td><a href="mailto:${esc(customer.email)}" style="color: #b8935a; text-decoration: none;">${esc(customer.email)}</a></td></tr>
              ${customer.phone ? `<tr><td style="color: #777;"><strong>Telefon:</strong></td><td>${esc(customer.phone)}</td></tr>` : ''}
              <tr><td style="color: #777;"><strong>Code:</strong></td><td><code style="background: white; padding: 2px 6px;">${esc(code)}</code></td></tr>
              <tr><td style="color: #777;"><strong>Zeitpunkt:</strong></td><td>${timestamp}</td></tr>
            </table>
          </div>

          ${optionalMessage ? `
          <div style="background: white; border: 1px solid #e5dfd2; padding: 20px 24px; margin: 24px 0;">
            <div style="font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: #b8935a; font-weight: 700; margin-bottom: 10px;">
              Persönliche Nachricht
            </div>
            <p style="margin: 0; white-space: pre-wrap;">${esc(optionalMessage)}</p>
          </div>
          ` : ''}

          <div style="background: #0a1f3d; color: white; padding: 24px; margin: 32px 0; text-align: center;">
            <p style="margin: 0 0 14px; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: #c9a961;">
              Empfehlung
            </p>
            <p style="margin: 0; font-size: 16px;">
              Diesem Kunden innerhalb von <strong>24 Stunden</strong> zurückmelden — die Conversion-Wahrscheinlichkeit ist jetzt am höchsten.
            </p>
          </div>

          <p style="font-size: 13px; color: #777; margin-top: 32px;">
            Auf <strong>„Antworten"</strong> klicken schreibt direkt an <strong>${esc(customer.email)}</strong>.
          </p>

          <hr style="border: none; border-top: 1px solid #e5dfd2; margin: 32px 0;">
          <p style="font-size: 11px; color: #999; margin: 0;">
            Automatische Benachrichtigung von North Finance AI · Leistungskatalog-Kontakt
          </p>
        </div>
      `
    });
  } catch (err) {
    console.error('Failed to send notification to owner:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }

  // ─── Send confirmation to customer ───
  try {
    await sendEmail({
      to: customer.email,
      subject: 'Ihre Detail-Call-Anfrage ist eingegangen',
      html: `
        <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a; line-height: 1.65;">
          <div style="border-top: 3px solid #b8935a; padding-top: 28px;">
            <div style="font-family: Georgia, serif; font-size: 22px; color: #0a1f3d; margin-bottom: 28px;">
              North Finance <em style="color: #b8935a;">AI</em>
            </div>

            <h2 style="margin: 0 0 20px; color: #0a1f3d; font-size: 26px; font-weight: 500; font-family: Georgia, serif;">
              Vielen Dank, ${esc(customer.name)}.
            </h2>

            <p style="margin: 0 0 16px; font-size: 15px;">
              Ihre Anfrage für einen Detail-Call ist bei uns eingegangen. Krisztina hat eine Benachrichtigung erhalten und meldet sich <strong>innerhalb der nächsten 24 Stunden</strong> persönlich bei Ihnen — per E-Mail an <strong>${esc(customer.email)}</strong>${customer.phone ? ' oder telefonisch unter <strong>' + esc(customer.phone) + '</strong>' : ''}.
            </p>

            <div style="background: #f7f3ec; padding: 24px 28px; margin: 28px 0; border-left: 3px solid #b8935a;">
              <p style="margin: 0 0 14px; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; color: #b8935a; font-weight: 700;">
                Was Sie erwartet
              </p>
              <p style="margin: 0; font-size: 14px;">
                Der Detail-Call dauert ca. 15 Minuten. Wir klären Ihre offenen Punkte aus dem Katalog, identifizieren das passende Paket für Ihre Situation und besprechen den Zeitplan. <strong>Im Anschluss erhalten Sie binnen 5 Werktagen ein schriftliches Festpreis-Angebot</strong> — 14 Tage gültig, ohne Verhandlungsspielchen.
              </p>
            </div>

            <p style="margin: 24px 0 0; font-size: 15px;">
              Falls Sie zwischenzeitlich etwas vorbereiten oder ergänzen möchten, können Sie jederzeit direkt antworten — wir sehen Ihre Antwort umgehend.
            </p>

            <p style="margin: 32px 0 8px; font-size: 15px;">
              Bis bald,
            </p>
            <p style="margin: 0; font-family: Georgia, serif; font-style: italic; color: #b8935a; font-size: 17px;">
              Krisztina Toth
            </p>
            <p style="margin: 4px 0 0; font-size: 13px; color: #777;">
              North Finance AI · München
            </p>

            <hr style="border: none; border-top: 1px solid #e5dfd2; margin: 36px 0 20px;">
            <p style="font-size: 11px; color: #999; margin: 0;">
              Diese E-Mail wurde automatisch generiert, nachdem Sie im Leistungskatalog auf „Detail-Call vereinbaren" geklickt haben. Antworten auf diese Nachricht gehen direkt an Krisztina.
            </p>
          </div>
        </div>
      `
    });
  } catch (err) {
    // Customer confirmation failed but Krisztina was notified — still return success
    console.error('Failed to send customer confirmation:', err);
  }

  return res.status(200).json({ ok: true });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html, replyTo }) {
  const payload = { from: FROM_EMAIL, to, subject, html };
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorBody}`);
  }
  return response.json();
}

async function kvGet(key) {
  if (!process.env.KV_REST_API_URL) return null;
  const response = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`KV get failed: ${response.status}`);
  }
  const data = await response.json();
  if (data.result == null) return null;
  try { return JSON.parse(data.result); } catch (e) { return data.result; }
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
