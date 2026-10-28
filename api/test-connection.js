export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { server, user, pass } = req.body || {};
  let base = String(server || '').trim().replace(/\/+$/, '');
  if (!base) return res.status(400).json({ success: false, error: 'Server URL required' });
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;

  const target = new URL(`${base}/player_api.php`);
  target.searchParams.set('username', user || '');
  target.searchParams.set('password', pass || '');

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'IPTVSmartersPro/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!upstream.ok) {
      return res.status(200).json({ success: false, error: `Provider returned HTTP ${upstream.status}` });
    }

    const data = await upstream.json();
    if (data?.user_info?.auth === 0) {
      return res.status(200).json({ success: false, error: 'Invalid username or password' });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'Connection failed' });
  }
}