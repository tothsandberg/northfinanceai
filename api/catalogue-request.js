// api/catalogue-request.js
// Lead clicks "Leistungskatalog anfragen" in their confirmation email →
// katalog-anfragen.html → "Anfrage absenden" → POSTs here.
//
// This function:
//   1. Verifies the signed lead token
//   2. Generates a random code (e.g. MUELLER-K7X3)
//   3. Stores it in KV as PENDING (auto-expires in 14 days if not approved)
//   4. Emails the lead: "Anfrage eingegangen"
//   5. Emails Krisztina with ✅ Freigeben / ❌ Ablehnen buttons
//
// Required env vars:
//   RESEND_API_KEY, APPROVAL_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN

import crypto from 'node:crypto';

const OWNER_EMAIL = 'krisztina@northfinanceai.com';
const FROM_EMAIL = 'North Finance AI <noreply@northfinanceai.com>';
const SITE_URL = 'https://northfinanceai.com';

// Pending codes auto-expire after 14 days if Krisztina hasn't approved them.
const PENDING_TTL_SECONDS = 14 * 24 * 60 * 60;

// Approval tokens are valid for 14 days (matches the pending code's TTL).
const APPROVAL_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing token' });

    // Verify the signed lead token (issued by lead-capture.js)
    const lead = verify(token, process.env.APPROVAL_SECRET);
    if (!lead) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Idempotency: if this lead already has a pending request, just resend the lead's confirmation
    // and skip generating a new code or re-notifying Krisztina.
    const existingPending = await kvGet(`catalogue:pending-by-email:${lead.email.toLowerCase()}`);
    if (existingPending) {
      await sendLeadConfirmation(lead);
      return res.status(200).json({ ok: true, deduped: true });
    }

    // Generate a fresh code
    const code = generateCode(lead.name);
    const requestedAt = Date.now();

    // Store as PENDING in KV (with auto-expiry)
    const pendingRecord = {
      code,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      requested_at: requestedAt,
      status: 'pending'
    };
    await kvSet(`catalogue:pending:${code}`, pendingRecord, PENDING_TTL_SECONDS);
    await kvSet(`catalogue:pending-by-email:${lead.email.toLowerCase()}`, code, PENDING_TTL_SECONDS);

    // Generate signed approval/reject tokens
    const approvalToken = sign({
      code,
      action: 'approve',
      exp: Date.now() + APPROVAL_TOKEN_TTL_MS
    }, process.env.APPROVAL_SECRET);
    const rejectToken = sign({
      code,
      action: 'reject',
      exp: Date.now() + APPROVAL_TOKEN_TTL_MS
    }, process.env.APPROVAL_SECRET);

    const approveUrl = `${SITE_URL}/api/catalogue-approve?token=${encodeURIComponent(approvalToken)}`;
    const rejectUrl = `${SITE_URL}/api/catalogue-reject?token=${encodeURIComponent(rejectToken)}`;

    const timestampStr = new Date(requestedAt).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'short'
    });

    // ─── Email 1: Confirmation to the lead ──────────────────────────────
    await sendLeadConfirmation(lead);

    // ─── Email 2: Notification to Krisztina with ✅ / ❌ buttons ────────
    const ownerHtml = `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 600px; color: #2a2a2a;">
        <h2 style="color: #0a1f3d; border-bottom: 2px solid #c9a961; padding-bottom: 8px;">
          📩 Neue Katalog-Anfrage
        </h2>
        <p style="color: #777; font-size: 13px;">Anfrage eingegangen ${timestampStr}</p>

        <table cellpadding="8" style="border-collapse: collapse; font-size: 15px; margin-top: 20px;">
          <tr><td><strong>Name:</strong></td><td>${esc(lead.name)}</td></tr>
          <tr><td><strong>Unternehmen:</strong></td><td>${esc(lead.company)}</td></tr>
          <tr><td><strong>E-Mail:</strong></td><td><a href="mailto:${esc(lead.email)}" style="color: #c9a961;">${esc(lead.email)}</a></td></tr>
          <tr><td><strong>Generierter Code:</strong></td><td><code style="background: #f5f0e6; padding: 4px 8px; font-size: 16px;">${esc(code)}</code></td></tr>
        </table>

        <div style="margin: 36px 0; padding: 24px; background: #f5f0e6; border-left: 3px solid #c9a961;">
          <p style="margin: 0 0 18px; font-size: 15px; color: #0a1f3d;"><strong>Ihre Entscheidung:</strong></p>
          <p style="margin: 0 0 22px; font-size: 14px; color: #555;">Mit einem Klick freigeben oder ablehnen. Der Code wird erst nach Ihrer Freigabe an den Kunden versendet.</p>

          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td>
              <a href="${approveUrl}" style="display: inline-block; background: #2d7a4f; color: white; padding: 14px 28px; text-decoration: none; font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 600;">✅ Freigeben &amp; Code versenden</a>
            </td>
            <td style="width: 16px;"></td>
            <td>
              <a href="${rejectUrl}" style="display: inline-block; background: #999; color: white; padding: 14px 28px; text-decoration: none; font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 600;">❌ Ablehnen</a>
            </td>
          </tr></table>
        </div>

        <p style="color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
          Beide Links sind <strong>14 Tage gültig</strong>. Die Anfrage verfällt automatisch, falls Sie nicht reagieren — der Code wird dann nicht an den Kunden versendet.
        </p>
      </div>
    `;

    await sendEmail({
      to: OWNER_EMAIL,
      reply_to: lead.email,
      subject: `📩 Katalog-Anfrage: ${lead.name} (${lead.company})`,
      html: ownerHtml
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Catalogue request failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── EMAIL HELPER ────────────────────────────────────────────────────────

async function sendLeadConfirmation(lead) {
  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; color: #2a2a2a; line-height: 1.6;">
      <p>Sehr geehrte/r ${esc(lead.name)},</p>

      <p>vielen Dank — Ihre Anfrage für den vertraulichen Leistungskatalog ist eingegangen.</p>

      <p>Krisztina prüft die Anfrage persönlich. <strong>Innerhalb der nächsten 24 Stunden</strong> erhalten Sie entweder eine separate E-Mail mit Ihrem persönlichen Zugangscode und dem Link zum Katalog — oder eine kurze Rücksprache, falls noch Fragen offen sind.</p>

      <p>Bei dringenden Rückfragen erreichen Sie Krisztina direkt unter <a href="mailto:krisztina@northfinanceai.com" style="color: #c9a961;">krisztina@northfinanceai.com</a>.</p>

      <p style="margin-top: 32px;">
        Mit freundlichen Grüßen<br>
        <strong>Krisztina Toth</strong><br>
        North Finance AI
      </p>

      <hr style="border: none; border-top: 1px solid #ddd; margin: 28px 0;">
      <p style="font-size: 12px; color: #888;">
        Diese E-Mail ist eine automatische Bestätigung Ihrer Katalog-Anfrage. DSGVO-konform · Keine Weitergabe an Dritte.
      </p>
    </div>
  `;

  await sendEmail({
    to: lead.email,
    reply_to: OWNER_EMAIL,
    subject: 'Ihre Katalog-Anfrage ist eingegangen',
    html: html
  });
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

// Generate a code like MUELLER-K7X3
function generateCode(fullName) {
  const lastName = extractLastName(fullName);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes I, O, 0, 1 (avoid confusion)
  const bytes = crypto.randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[bytes[i] % chars.length];
  }
  return `${lastName}-${suffix}`;
}

function extractLastName(fullName) {
  if (!fullName) return 'KUNDE';
  const parts = String(fullName).trim().split(/\s+/);
  const last = parts[parts.length - 1] || 'KUNDE';
  return last.toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .replace(/[^A-Z]/g, '')
    .substring(0, 8) || 'KUNDE';
}

// HMAC-SHA256 token signing / verification
function sign(payload, secret) {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', secret || 'dev-secret').update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret || 'dev-secret').update(data).digest('base64url');
  // Constant-time comparison
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ─── KV (Upstash REST) HELPERS ───────────────────────────────────────────

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

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
