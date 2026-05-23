// api/catalogue-reject.js
// Krisztina clicks the "❌ Ablehnen" button in her notification email.
// That link is a GET to this endpoint with ?token=<signed-reject-token>.
//
// This function:
//   1. Verifies the signed reject token
//   2. Reads the pending request from KV
//   3. Deletes the pending entry (cleanly removes the code from the system)
//   4. Does NOT email the lead — Krisztina handles communication personally
//   5. Returns an HTML confirmation page
//
// Required env vars:
//   APPROVAL_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN

import crypto from 'node:crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method not allowed');
  }

  const token = req.query?.token || (req.body && req.body.token);
  if (!token) {
    return sendHtmlError(res, 400, 'Link unvollständig', 'Der Ablehnungs-Link ist unvollständig.');
  }

  const payload = verify(token, process.env.APPROVAL_SECRET);
  if (!payload || payload.action !== 'reject') {
    return sendHtmlError(res, 401, 'Link ungültig oder abgelaufen', 'Der Ablehnungs-Link ist ungültig oder abgelaufen (14 Tage Gültigkeit).');
  }

  const code = payload.code;

  try {
    const pending = await kvGet(`catalogue:pending:${code}`);

    if (!pending) {
      return sendHtmlSuccess(res,
        'Bereits bearbeitet',
        `Diese Anfrage wurde bereits bearbeitet — entweder bereits freigegeben, abgelehnt, oder abgelaufen.`
      );
    }

    // Delete pending entries
    await kvDel(`catalogue:pending:${code}`);
    if (pending.email) {
      await kvDel(`catalogue:pending-by-email:${pending.email.toLowerCase()}`);
    }

    return sendHtmlSuccess(res,
      'Anfrage abgelehnt',
      `Die Katalog-Anfrage von <strong>${esc(pending.name)}</strong> (${esc(pending.company)}) wurde abgelehnt. Es wurde <strong>keine automatische E-Mail</strong> an den Kunden versendet — Sie können den Kunden bei Bedarf persönlich kontaktieren.`
    );

  } catch (err) {
    console.error('Catalogue rejection failed:', err);
    return sendHtmlError(res, 500, 'Technisches Problem', 'Bei der Ablehnung ist ein technisches Problem aufgetreten.');
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
  const accentColor = isSuccess ? '#999' : '#c53030';
  const eyebrow = isSuccess ? 'Ablehnung abgeschlossen' : 'Ablehnung fehlgeschlagen';
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
  p { font-size: 15px; color: #555; line-height: 1.7; }
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
