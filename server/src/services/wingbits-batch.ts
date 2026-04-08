// Wingbits batch aircraft details service
// Fetches details for multiple aircraft in parallel by ICAO24 hex codes

interface BatchResult {
  results: Record<string, unknown>;
  fetched: number;
  requested: number;
}

interface CacheEntry {
  data: Record<string, unknown>;
  timestamp: number;
}

const cacheMap = new Map<string, CacheEntry>();
const CACHE_TTL = 300_000; // 5 minutes

export async function fetchWingbitsBatch(
  icao24s: string[]
): Promise<BatchResult> {
  const apiKey = process.env.WINGBITS_API_KEY;

  if (!apiKey) {
    throw new Error('Wingbits not configured');
  }

  if (!Array.isArray(icao24s) || icao24s.length === 0) {
    throw new Error('icao24s array required');
  }

  // Limit batch size
  const limitedList = icao24s.slice(0, 20).map((id) => id.toLowerCase());
  const results: Record<string, unknown> = {};
  const now = Date.now();

  // Separate cached vs uncached
  const uncachedIds: string[] = [];
  for (const icao24 of limitedList) {
    const cached = cacheMap.get(icao24);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      results[icao24] = cached.data;
    } else {
      uncachedIds.push(icao24);
    }
  }

  // Fetch uncached in parallel
  const fetchPromises = uncachedIds.map(async (icao24) => {
    try {
      const response = await fetch(
        `https://customer-api.wingbits.com/v1/flights/details/${icao24}`,
        {
          headers: {
            'x-api-key': apiKey!,
            Accept: 'application/json',
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        return { icao24, data };
      }
    } catch {
      // Skip failed lookups
    }
    return null;
  });

  const fetchResults = await Promise.all(fetchPromises);

  for (const result of fetchResults) {
    if (result) {
      results[result.icao24] = result.data;
      cacheMap.set(result.icao24, {
        data: result.data as Record<string, unknown>,
        timestamp: now,
      });
    }
  }

  return {
    results,
    fetched: Object.keys(results).length,
    requested: limitedList.length,
  };
}
