// =======================================================================
// /api/cfo-diagnose.js
// Vercel Serverless Function — proxies the CFO-Diagnose popup to Claude.
//
// Frontend (index.html) sendet POST mit { model, max_tokens, system, messages }.
// Diese Funktion reicht das an die Anthropic API weiter und schickt
// die Antwort zurück an den Browser. Der API-Key bleibt SERVER-SEITIG.
// =======================================================================

export default async function handler(req, res) {
  // Nur POST erlaubt
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // API-Key aus Environment Variable lesen (NIEMALS hier hardcoden!)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY environment variable is not set.');
    return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
  }

  try {
    const { model, max_tokens, system, messages } = req.body || {};

    // Minimal-Validierung
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Ungültige Anfrage: messages fehlt' });
    }

    // An Anthropic weiterleiten
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: typeof max_tokens === 'number' ? max_tokens : 700,
        system: system || '',
        messages: messages
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API returned non-OK:', anthropicRes.status, errText);
      return res.status(anthropicRes.status).json({
        error: 'AI-Dienst nicht verfügbar',
        status: anthropicRes.status
      });
    }

    const data = await anthropicRes.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Interner Fehler' });
  }
}
