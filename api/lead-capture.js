/**
 * /api/lead-capture.js — Vercel Serverless Function
 *
 * Receives lead-capture submissions from the landing page popup and writes
 * them to Airtable. The Airtable token NEVER reaches the client — it lives
 * only in Vercel environment variables.
 *
 * Required environment variables (set in Vercel → Project → Settings → Environment Variables):
 *   AIRTABLE_TOKEN     Personal Access Token with scope `data.records:write` for your base
 *   AIRTABLE_BASE_ID   Your base ID (starts with "app...", visible in airtable.com/api)
 *   AIRTABLE_TABLE     Your table name (e.g. "Leads") or table ID (starts with "tbl...")
 *
 * Optional:
 *   NOTIFY_EMAIL_TO    If set, payload is also forwarded as a notification email (not implemented here — extend with Resend/SendGrid if desired)
 */

export default async function handler(req, res) {
  // ---------- 1. Method guard ----------
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---------- 2. Parse + validate body ----------
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const name    = (body.name    || '').toString().trim().slice(0, 200);
  const email   = (body.email   || '').toString().trim().slice(0, 200).toLowerCase();
  const company = (body.company || '').toString().trim().slice(0, 200);
  const revenue = (body.revenue || '').toString().trim().slice(0, 50);
  const phone   = (body.phone   || '').toString().trim().slice(0, 50);
  const source  = (body.source  || '').toString().trim().slice(0, 100);
  const url     = (body.url     || '').toString().trim().slice(0, 500);

  // Server-side validation — never trust the client
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!name)             return res.status(400).json({ error: 'Name fehlt' });
  if (!emailRe.test(email)) return res.status(400).json({ error: 'E-Mail ungültig' });
  if (!company)          return res.status(400).json({ error: 'Unternehmen fehlt' });
  if (!revenue)          return res.status(400).json({ error: 'Umsatzklasse fehlt' });
  if (phone.length < 6)  return res.status(400).json({ error: 'Telefon ungültig' });

  // ---------- 3. Env-var check ----------
  const TOKEN  = process.env.AIRTABLE_TOKEN;
  const BASE   = process.env.AIRTABLE_BASE_ID;
  const TABLE  = process.env.AIRTABLE_TABLE;
  if (!TOKEN || !BASE || !TABLE) {
    console.error('Missing Airtable env vars');
    return res.status(500).json({ error: 'Server configuration incomplete' });
  }

  // ---------- 4. Build Airtable record ----------
  // IMPORTANT: Field names below must match your Airtable column names EXACTLY (case-sensitive).
  // If you renamed columns in Airtable, update the keys here accordingly.
  const record = {
    fields: {
      'Name':         name,
      'E-Mail':       email,
      'Unternehmen':  company,
      'Umsatz':       revenue,
      'Telefon':      phone,
      'Quelle':       source || 'website_popup',
      'URL':          url,
      // 'Erstellt am' is filled automatically by Airtable's "Created time" field type
    }
  };

  // ---------- 5. POST to Airtable ----------
  try {
    const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(BASE)}/${encodeURIComponent(TABLE)}`;
    const apiRes = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ records: [record], typecast: true })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Airtable API error:', apiRes.status, errText);
      // Don't leak the real Airtable error to the client
      return res.status(502).json({ error: 'Lead konnte nicht gespeichert werden' });
    }

    const apiJson = await apiRes.json();
    const recordId = apiJson?.records?.[0]?.id || null;

    return res.status(200).json({ ok: true, id: recordId });
  } catch (err) {
    console.error('Lead capture exception:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}/**
 * /api/lead-capture.js — Vercel Serverless Function
 *
 * Receives lead-capture submissions from the landing page popup and writes
 * them to Airtable. The Airtable token NEVER reaches the client — it lives
 * only in Vercel environment variables.
 *
 * Required environment variables (set in Vercel → Project → Settings → Environment Variables):
 *   AIRTABLE_TOKEN     Personal Access Token with scope `data.records:write` for your base
 *   AIRTABLE_BASE_ID   Your base ID (starts with "app...", visible in airtable.com/api)
 *   AIRTABLE_TABLE     Your table name (e.g. "Leads") or table ID (starts with "tbl...")
 *
 * Optional:
 *   NOTIFY_EMAIL_TO    If set, payload is also forwarded as a notification email (not implemented here — extend with Resend/SendGrid if desired)
 */

export default async function handler(req, res) {
  // ---------- 1. Method guard ----------
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---------- 2. Parse + validate body ----------
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const name    = (body.name    || '').toString().trim().slice(0, 200);
  const email   = (body.email   || '').toString().trim().slice(0, 200).toLowerCase();
  const company = (body.company || '').toString().trim().slice(0, 200);
  const revenue = (body.revenue || '').toString().trim().slice(0, 50);
  const phone   = (body.phone   || '').toString().trim().slice(0, 50);
  const source  = (body.source  || '').toString().trim().slice(0, 100);
  const url     = (body.url     || '').toString().trim().slice(0, 500);

  // Server-side validation — never trust the client
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!name)             return res.status(400).json({ error: 'Name fehlt' });
  if (!emailRe.test(email)) return res.status(400).json({ error: 'E-Mail ungültig' });
  if (!company)          return res.status(400).json({ error: 'Unternehmen fehlt' });
  if (!revenue)          return res.status(400).json({ error: 'Umsatzklasse fehlt' });
  if (phone.length < 6)  return res.status(400).json({ error: 'Telefon ungültig' });

  // ---------- 3. Env-var check ----------
  const TOKEN  = process.env.AIRTABLE_TOKEN;
  const BASE   = process.env.AIRTABLE_BASE_ID;
  const TABLE  = process.env.AIRTABLE_TABLE;
  if (!TOKEN || !BASE || !TABLE) {
    console.error('Missing Airtable env vars');
    return res.status(500).json({ error: 'Server configuration incomplete' });
  }

  // ---------- 4. Build Airtable record ----------
  // IMPORTANT: Field names below must match your Airtable column names EXACTLY (case-sensitive).
  // If you renamed columns in Airtable, update the keys here accordingly.
  const record = {
    fields: {
      'Name':         name,
      'E-Mail':       email,
      'Unternehmen':  company,
      'Umsatz':       revenue,
      'Telefon':      phone,
      'Quelle':       source || 'website_popup',
      'URL':          url,
      // 'Erstellt am' is filled automatically by Airtable's "Created time" field type
    }
  };

  // ---------- 5. POST to Airtable ----------
  try {
    const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(BASE)}/${encodeURIComponent(TABLE)}`;
    const apiRes = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ records: [record], typecast: true })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Airtable API error:', apiRes.status, errText);
      // Don't leak the real Airtable error to the client
      return res.status(502).json({ error: 'Lead konnte nicht gespeichert werden' });
    }

    const apiJson = await apiRes.json();
    const recordId = apiJson?.records?.[0]?.id || null;

    return res.status(200).json({ ok: true, id: recordId });
  } catch (err) {
    console.error('Lead capture exception:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
