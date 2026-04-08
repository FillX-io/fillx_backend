// PizzINT Dashboard proxy
// Proxies requests to https://www.pizzint.watch/api/dashboard-data

const PIZZINT_API = 'https://www.pizzint.watch/api/dashboard-data';

interface PizzintDashboardParams {
  _t?: string;
}

interface CacheEntry {
  data: string;
  timestamp: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL = 60_000; // 60 seconds

export async function fetchPizzintDashboard(
  params: PizzintDashboardParams = {}
): Promise<string> {
  const now = Date.now();

  if (cache && now - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  const upstreamUrl = new URL(PIZZINT_API);
  upstreamUrl.searchParams.set('_t', params._t || String(now));

  const upstream = await fetch(upstreamUrl.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GlobalIntel-PizzINT-Proxy/1.0',
    },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    throw new Error(`Upstream ${upstream.status}`);
  }

  const body = await upstream.text();

  cache = { data: body, timestamp: now };

  return body;
}
