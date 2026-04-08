// Wingbits single aircraft details service
// Fetches details for a single aircraft by ICAO24 hex code

interface CacheEntry {
  data: Record<string, unknown>;
  timestamp: number;
}

const cacheMap = new Map<string, CacheEntry>();
const CACHE_TTL = 86_400_000; // 24 hours - aircraft details rarely change

export async function fetchWingbitsDetails(
  icao24: string
): Promise<Record<string, unknown>> {
  const apiKey = process.env.WINGBITS_API_KEY;

  if (!apiKey) {
    throw new Error('Wingbits not configured');
  }

  if (!icao24 || !/^[a-f0-9]+$/i.test(icao24)) {
    throw new Error('Invalid icao24');
  }

  const id = icao24.toLowerCase();
  const now = Date.now();
  const cached = cacheMap.get(id);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const response = await fetch(
    `https://customer-api.wingbits.com/v1/flights/details/${id}`,
    {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Wingbits API error: ${response.status}`);
  }

  const data = await response.json();

  cacheMap.set(id, { data, timestamp: now });

  return data;
}
