// api/catalogue-approve.js
// Krisztina clicks the "✅ Freigeben" button in her notification email.
// That link is a GET to this endpoint with ?token=<signed-approval-token>.
//
// This function:
//   1. Verifies the signed approval token
//   2. Reads the pending request from KV
//   3. Promotes it to ACTIVE in KV (this is what the gate checks against)
//   4. Emails the lead with their access code + URL
//   5. Emails Krisztina confirming the code was delivered
//   6. Returns an HTML success page (designed to match the site)
//
// Required env vars:
//   RESEND_API_KEY, APPROVAL_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN

import crypto from 'node:crypto';

const OWNER_EMAIL = 'krisztina@northfinanceai.com';
const FROM_EMAIL = 'North Finance AI <noreply@northfinanceai.com>';
const SITE_URL = 'https://northfinanceai.com';
const CATALOGUE_URL = `${SITE_URL}/leistungen-detail`;

export default async function handler(req, res) {
  // We accept GET (from email link click) and also POST for completeness
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method not allowed');
  }

  const token = req.query?.token || (req.body && req.body.token);
  if (!token) {
    return sendHtmlError(res, 400, 'Link unvollständig', 'Der Freigabe-Link ist unvollständig. Bitte verwenden Sie den vollständigen Link aus der E-Mail.');
  }

  const payload = verify(token, process.env.APPROVAL_SECRET);
  if (!payload || payload.action !== 'approve') {
    return sendHtmlError(res, 401, 'Link ungültig oder abgelaufen', 'Der Freigabe-Link ist ungültig oder abgelaufen (14 Tage Gültigkeit). Falls die Anfrage noch aktuell ist, bitten Sie den Kunden, eine neue Anfrage zu stellen.');
  }

  const code = payload.code;

  try {
    // Load the pending record
    const pending = await kvGet(`catalogue:pending:${code}`);

    if (!pending) {
      // Check if it's already active (Krisztina clicked the link twice)
      const alreadyActive = await kvGet(`catalogue:active:${code}`);
      if (alreadyActive) {
        return sendHtmlSuccess(res,
          'Bereits freigegeben',
          `Dieser Code wurde bereits freigegeben — ${esc(alreadyActive.name)} (${esc(alreadyActive.company)}) hat den Zugang bereits erhalten.`
        );
      }
      return sendHtmlError(res, 404, 'Anfrage nicht gefunden', 'Diese Anfrage wurde abgelehnt, ist abgelaufen, oder wurde nie erstellt. Falls noch aktuell, kann der Kunde eine neue Anfrage stellen.');
    }

    // Promote to ACTIVE (no TTL — active codes are permanent unless manually revoked)
    const activeRecord = {
      name: pending.name,
      company: pending.company,
      email: pending.email,
      issued: new Date().toISOString().slice(0, 10),
      activated_at: Date.now()
    };
    await kvSet(`catalogue:active:${code}`, activeRecord);

    // Clean up pending entries
    await kvDel(`catalogue:pending:${code}`);
    if (pending.email) {
      await kvDel(`catalogue:pending-by-email:${pending.email.toLowerCase()}`);
    }

    const approvedAtStr = new Date().toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'short'
    });

    // ─── Email 1: Send the code to the lead ─────────────────────────────
    const leadHtml = `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a; line-height: 1.6;">
        <p>Sehr geehrte/r ${esc(pending.name)},</p>

        <p>vielen Dank für Ihre Geduld. Krisztina hat Ihre Anfrage geprüft und Ihnen Zugang zum vertraulichen Leistungskatalog freigegeben.</p>

        <div style="background: #f5f0e6; border-left: 3px solid #c9a961; padding: 28px; margin: 32px 0;">
          <div style="font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: #c9a961; font-weight: 700; margin-bottom: 14px;">Ihr persönlicher Zugang</div>

          <div style="font-size: 13px; color: #555; margin-bottom: 8px;">Zugangscode:</div>
          <div style="font-family: 'Courier New', monospace; font-size: 22px; color: #0a1f3d; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 22px; background: white; padding: 12px 16px; display: inline-block;">${esc(code)}</div>

          <div style="font-size: 13px; color: #555; margin-bottom: 12px;">Katalog öffnen:</div>
          <a href="${CATALOGUE_URL}" style="display: inline-block; background: #0a1f3d; color: white; padding: 14px 28px; text-decoration: none; font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;">Zum Leistungskatalog</a>
        </div>

        <p style="font-size: 14px;">
          Der Code ist <strong>persönlich an Sie ausgestellt</strong> und sollte nicht weitergegeben werden. Bei mehrfachen Zugriffen aus verschiedenen Quellen behält sich Krisztina vor, den Zugang zu deaktivieren.
        </p>

        <p>Bei Rückfragen erreichen Sie Krisztina direkt unter <a href="mailto:krisztina@northfinanceai.com" style="color: #c9a961;">krisztina@northfinanceai.com</a>.</p>

        <p style="margin-top: 32px;">
          Mit freundlichen Grüßen<br>
          <strong>Krisztina Toth</strong><br>
          North Finance AI
        </p>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 28px 0;">
        <p style="font-size: 12px; color: #888;">
          DSGVO-konform · Keine Weitergabe an Dritte · Persönlicher Zugang
        </p>
      </div>
    `;

    await sendEmail({
      to: pending.email,
      reply_to: OWNER_EMAIL,
      subject: 'Ihr Zugang zum Leistungskatalog · North Finance AI',
      html: leadHtml
    });

    // ─── Email 2: Confirmation to Krisztina ─────────────────────────────
    const ownerHtml = `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a;">
        <h2 style="color: #2d7a4f; border-bottom: 2px solid #c9a961; padding-bottom: 8px;">
          ✅ Code freigegeben &amp; versendet
        </h2>

        <p>Der Zugangscode wurde soeben an den Kunden versendet.</p>

        <table cellpadding="8" style="border-collapse: collapse; font-size: 15px; margin-top: 20px;">
          <tr><td><strong>Kunde:</strong></td><td>${esc(pending.name)}</td></tr>
          <tr><td><strong>Unternehmen:</strong></td><td>${esc(pending.company)}</td></tr>
          <tr><td><strong>E-Mail:</strong></td><td><a href="mailto:${esc(pending.email)}" style="color: #c9a961;">${esc(pending.email)}</a></td></tr>
          <tr><td><strong>Code:</strong></td><td><code style="background: #f5f0e6; padding: 4px 8px; font-size: 16px;">${esc(code)}</code></td></tr>
          <tr><td><strong>Freigegeben am:</strong></td><td>${esc(approvedAtStr)}</td></tr>
          <tr><td><strong>Katalog-URL:</strong></td><td><a href="${CATALOGUE_URL}" style="color: #c9a961;">${esc(CATALOGUE_URL)}</a></td></tr>
        </table>

        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          Sie erhalten eine separate E-Mail, sobald der Kunde den Katalog zum ersten Mal öffnet.
        </p>
      </div>
    `;

    await sendEmail({
      to: OWNER_EMAIL,
      subject: `✅ Code freigegeben: ${pending.name} (${pending.company})`,
      html: ownerHtml
    });

    return sendHtmlSuccess(res,
      'Code freigegeben',
      `Der Zugangscode <code style="background: #f5f0e6; padding: 4px 8px; font-family: monospace;">${esc(code)}</code> wurde soeben an <strong>${esc(pending.name)}</strong> (${esc(pending.email)}) versendet. Sie haben eine Bestätigung in Ihrem Posteingang.`
    );

  } catch (err) {
    console.error('Catalogue approval failed:', err);
    return sendHtmlError(res, 500, 'Technisches Problem', 'Bei der Freigabe ist ein technisches Problem aufgetreten. Bitte versuchen Sie es erneut oder kontaktieren Sie den Support.');
  }
}

// ─── HTML RESPONSE HELPERS ───────────────────────────────────────────────

function sendHtmlSuccess(res, title, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderPage('success', title, body));
}

function sendHtmlError(res, code, title, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(code).send(renderPage('error', title, body));
}

function renderPage(variant, title, bodyHtml) {
  const isSuccess = variant === 'success';
  const accentColor = isSuccess ? '#2d7a4f' : '#c53030';
  const eyebrow = isSuccess ? 'Freigabe abgeschlossen' : 'Freigabe fehlgeschlagen';
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · North Finance AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #f7f3ec;
    color: #2a2a2a;
    line-height: 1.6;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: white;
    max-width: 540px;
    width: 100%;
    border-top: 3px solid ${accentColor};
    padding: 56px 48px 44px;
    box-shadow: 0 30px 60px rgba(10, 31, 61, 0.15);
  }
  .logo {
    font-family: 'Playfair Display', serif;
    font-size: 22px;
    color: #0a1f3d;
    margin-bottom: 36px;
    font-weight: 500;
  }
  .logo span { color: #b8935a; font-style: italic; }
  .eyebrow {
    font-size: 11px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: ${accentColor};
    font-weight: 700;
    margin-bottom: 18px;
  }
  h1 {
    font-family: 'Playfair Display', serif;
    font-size: 30px;
    font-weight: 500;
    color: #0a1f3d;
    line-height: 1.2;
    margin-bottom: 18px;
  }
  p { font-size: 15px; color: #555; line-height: 1.7; margin-bottom: 14px; }
  code { font-family: 'Courier New', monospace; font-size: 15px; color: #0a1f3d; }
  @media (max-width: 560px) { .card { padding: 40px 28px 32px; } h1 { font-size: 26px; } }
</style>
</head>
<body>
<div class="card">
  <div class="logo">North Finance <span>AI</span></div>
  <div class="eyebrow">${esc(eyebrow)}</div>
  <h1>${esc(title)}</h1>
  <p>${bodyHtml}</p>
</div>
</body>
</html>`;
}

// ─── GENERIC HELPERS ─────────────────────────────────────────────────────

async function sendEmail({ to, reply_to, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, reply_to, subject, html })
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorBody}`);
  }
  return response.json();
}

function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret || 'dev-secret').update(data).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

async function kvSet(key, value, ttlSeconds = null) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  let url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  if (ttlSeconds) url += `?EX=${ttlSeconds}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: body
  });
  if (!response.ok) throw new Error(`KV set failed: ${response.status}`);
}

async function kvGet(key) {
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

async function kvDel(key) {
  await fetch(`${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
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
