// PizzINT Dashboard Data service
// Fetches dashboard data from https://www.pizzint.watch/api/dashboard-data

interface CacheEntry {
  data: string;
  timestamp: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL = 60_000; // 60 seconds

export async function fetchPizzintData(): Promise<string> {
  const now = Date.now();

  if (cache && now - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  const response = await fetch('https://www.pizzint.watch/api/dashboard-data', {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GlobalIntel/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream returned ${response.status}`);
  }

  const data = await response.text();

  cache = { data, timestamp: now };

  return data;
}
