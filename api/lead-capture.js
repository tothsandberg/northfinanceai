// api/lead-capture.js
// Vercel serverless function for the CFO-Diagnose popup submission.
//   1. Validates form data
//   2. Emails Krisztina with the full diagnosis (notification, in DE)
//   3. Emails the lead with confirmation + a catalogue request CTA
//      (in the lead's chosen language — DE or EN)
//
// Required env vars:
//   RESEND_API_KEY     - for sending emails
//   APPROVAL_SECRET    - for signing the lead token used in the catalogue request button

import crypto from 'node:crypto';

const OWNER_EMAIL = 'krisztina@northfinanceai.com';
const FROM_EMAIL = 'North Finance AI <noreply@northfinanceai.com>';
const SITE_URL = 'https://northfinanceai.com';

// Signed lead-token is valid for 30 days — gives the lead a reasonable window
// to come back to the confirmation email and click the catalogue request CTA.
const LEAD_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

    // Validation
    if (!data.name || !data.company || !data.phone || !data.email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (String(data.phone).replace(/\D/g, '').length < 6) {
      return res.status(400).json({ error: 'Invalid phone' });
    }

    // Language: 'de' (default) or 'en'
    const lang = (data.lang === 'en') ? 'en' : 'de';

    const submittedAt = new Date(data.submitted_at || Date.now())
      .toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', {
        timeZone: 'Europe/Berlin',
        dateStyle: 'long',
        timeStyle: 'short'
      });

    const diag = data.diagnosis || {};

    // ─── Generate signed lead token for the catalogue request button ─────
    const leadToken = sign({
      name: data.name,
      email: data.email,
      company: data.company,
      lang: lang,
      exp: Date.now() + LEAD_TOKEN_TTL_MS
    }, process.env.APPROVAL_SECRET);

    const katalogRequestUrl = `${SITE_URL}/katalog-anfragen?token=${encodeURIComponent(leadToken)}`;

    // ─── Email 1: Notification to Krisztina (always DE, with language tag) ───
    const langFlag = lang === 'en' ? '🇬🇧 EN' : '🇩🇪 DE';
    const ownerHtml = `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 640px; color: #2a2a2a;">
        <h2 style="color: #0a1f3d; border-bottom: 2px solid #c9a961; padding-bottom: 8px;">
          ${langFlag} · Neue Strategy-Call Anfrage${lang === 'en' ? ' (English Lead)' : ''}
        </h2>
        <p style="color: #777; font-size: 13px;">Eingegangen ${submittedAt}</p>

        ${lang === 'en' ? `
        <div style="background: #fff8ec; border: 1px solid #e8d8b8; padding: 14px 18px; margin: 16px 0; font-size: 13px; color: #6b5530;">
          <strong>🇬🇧 Englischer Lead</strong> — der Strategy-Call wird auf Englisch erwartet. Bestätigungsmail wurde auf Englisch zugestellt.
        </div>
        ` : ''}

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
          URL: ${esc(data.url || '—')}<br>
          Sprache: ${lang.toUpperCase()}
        </p>
      </div>
    `;

    await sendEmail({
      from: FROM_EMAIL,
      to: OWNER_EMAIL,
      reply_to: data.email,
      subject: `${langFlag} · Neue Strategy-Call Anfrage: ${data.name} (${data.company})`,
      html: ownerHtml
    });

    // ─── Email 2: Confirmation to the lead (in their chosen language) ────
    const customerHtml = lang === 'en'
      ? buildCustomerEmailEN(data, katalogRequestUrl)
      : buildCustomerEmailDE(data, katalogRequestUrl);

    const customerSubject = lang === 'en'
      ? 'Your enquiry to North Finance AI has been received'
      : 'Ihre Anfrage bei North Finance AI ist eingegangen';

    await sendEmail({
      from: FROM_EMAIL,
      to: data.email,
      reply_to: OWNER_EMAIL,
      subject: customerSubject,
      html: customerHtml
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Lead capture failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────

function buildCustomerEmailDE(data, katalogRequestUrl) {
  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a; line-height: 1.6;">
      <p>Sehr geehrte/r ${esc(data.name)},</p>

      <p>vielen Dank für Ihre Anfrage. Wir haben Ihre Angaben erhalten und Krisztina wird sich <strong>innerhalb von 24 Stunden</strong> persönlich auf der von Ihnen angegebenen Nummer (${esc(data.phone)}) bei Ihnen melden.</p>

      <p>Im Gespräch konkretisieren wir die Hebel auf Ihre Zahlen und sagen Ihnen, ob ein Projekt sinnvoll ist. Wenn nicht, sagen wir das auch — die Rücksprache ist kostenlos und ohne Folgekosten.</p>

      <div style="background: #f5f0e6; border-left: 3px solid #c9a961; padding: 24px; margin: 32px 0;">
        <div style="font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: #c9a961; font-weight: 700; margin-bottom: 12px;">Optional · Vor dem Gespräch</div>
        <h3 style="font-family: 'Playfair Display', Georgia, serif; font-size: 22px; color: #0a1f3d; margin: 0 0 12px; line-height: 1.3;">Detaillierten Leistungskatalog anfragen</h3>
        <p style="margin: 0 0 18px; font-size: 14px;">Konditionen, Paketdetails und Preise teilen wir nicht öffentlich. Auf Anfrage prüft Krisztina persönlich und stellt Ihnen einen vertraulichen Zugang zum Leistungskatalog bereit.</p>
        <a href="${katalogRequestUrl}" style="display: inline-block; background: #0a1f3d; color: white; padding: 14px 28px; text-decoration: none; font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;">Leistungskatalog anfragen</a>
      </div>

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
}

function buildCustomerEmailEN(data, katalogRequestUrl) {
  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a; line-height: 1.6;">
      <p>Dear ${esc(data.name)},</p>

      <p>Thank you for your enquiry. We have received your details, and Krisztina will personally contact you <strong>within 24 hours</strong> on the number you provided (${esc(data.phone)}).</p>

      <p>In the call, we will translate the potential levers to your actual numbers and tell you whether a project makes sense. If it doesn't, we will say so — the call is free and carries no commitment.</p>

      <div style="background: #f5f0e6; border-left: 3px solid #c9a961; padding: 24px; margin: 32px 0;">
        <div style="font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: #c9a961; font-weight: 700; margin-bottom: 12px;">Optional · Before the call</div>
        <h3 style="font-family: 'Playfair Display', Georgia, serif; font-size: 22px; color: #0a1f3d; margin: 0 0 12px; line-height: 1.3;">Request the detailed service catalogue</h3>
        <p style="margin: 0 0 18px; font-size: 14px;">We do not publish package details, conditions and prices openly. On request, Krisztina personally reviews and provides you with confidential access to the full catalogue.</p>
        <a href="${katalogRequestUrl}" style="display: inline-block; background: #0a1f3d; color: white; padding: 14px 28px; text-decoration: none; font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;">Request catalogue access</a>
      </div>

      <p>If you need to reach us immediately, you can write directly to <a href="mailto:krisztina@northfinanceai.com" style="color: #c9a961;">krisztina@northfinanceai.com</a>.</p>

      <p style="margin-top: 32px;">
        Kind regards,<br>
        <strong>Krisztina Toth</strong><br>
        North Finance AI
      </p>

      <hr style="border: none; border-top: 1px solid #ddd; margin: 28px 0;">
      <p style="font-size: 12px; color: #888;">
        This is an automated confirmation of your enquiry via northfinanceai.com.<br>
        GDPR-compliant · No data shared with third parties · Unsubscribe at any time by replying to this email.
      </p>
    </div>
  `;
}

// ─── HELPERS ────────────────────────────────────────────────────────────

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

// HMAC-SHA256 signing for tamper-proof tokens.
// Token format:  base64url(payload).base64url(signature)
function sign(payload, secret) {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', secret || 'dev-secret').update(data).digest('base64url');
  return `${data}.${sig}`;
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
