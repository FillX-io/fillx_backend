// PizzINT GDELT Batch service
// Proxies GDELT geopolitical risk data from https://www.pizzint.watch/api/gdelt/batch

interface GdeltBatchParams {
  pairs?: string;
  dateStart?: string;
  dateEnd?: string;
  method?: string;
}

interface CacheEntry {
  data: string;
  timestamp: number;
}

const cacheMap = new Map<string, CacheEntry>();
const CACHE_TTL = 300_000; // 5 minutes

export async function fetchGdeltBatch(params: GdeltBatchParams = {}): Promise<string> {
  const pairs =
    params.pairs || 'usa_russia,russia_ukraine,usa_china,china_taiwan,usa_iran,usa_venezuela';
  const method = params.method || 'gpr';
  const dateStart = params.dateStart;
  const dateEnd = params.dateEnd;

  const cacheKey = `${pairs}|${method}|${dateStart || ''}|${dateEnd || ''}`;
  const now = Date.now();
  const cached = cacheMap.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  let targetUrl = `https://www.pizzint.watch/api/gdelt/batch?pairs=${encodeURIComponent(pairs)}&method=${method}`;
  if (dateStart) targetUrl += `&dateStart=${dateStart}`;
  if (dateEnd) targetUrl += `&dateEnd=${dateEnd}`;

  const response = await fetch(targetUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GlobalIntel/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream returned ${response.status}`);
  }

  const data = await response.text();

  cacheMap.set(cacheKey, { data, timestamp: now });

  return data;
}
