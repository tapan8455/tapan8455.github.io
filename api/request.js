// Allow connections to IPTV providers with self-signed SSL certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { server, user, pass, action, params = '' } = req.body || {};
  let base = String(server || '').trim().replace(/\/+$/, '');
  if (!base) return res.status(400).json({ error: 'No provider server specified' });
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;

  const target = new URL(`${base}/player_api.php`);
  target.searchParams.set('username', user || '');
  target.searchParams.set('password', pass || '');
  if (action) target.searchParams.set('action', action);
  if (params) {
    const extra = new URLSearchParams(String(params).replace(/^&/, ''));
    for (const [k, v] of extra) target.searchParams.set(k, v);
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'IPTVSmartersPro/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(35000)
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Provider returned HTTP ${upstream.status}` });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Upstream provider connection error' });
  }
}
