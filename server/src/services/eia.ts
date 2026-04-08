// EIA (Energy Information Administration) API proxy service
// Keeps API key server-side via process.env.EIA_API_KEY

interface PetroleumDataPoint {
  current: number | undefined;
  previous: number | undefined;
  date: string | undefined;
  unit: string | undefined;
}

interface PetroleumResults {
  wti?: PetroleumDataPoint;
  brent?: PetroleumDataPoint;
  production?: PetroleumDataPoint;
  inventory?: PetroleumDataPoint;
}

interface CacheEntry {
  data: PetroleumResults;
  timestamp: number;
}

let petroleumCache: CacheEntry | null = null;
const CACHE_TTL = 1_800_000; // 30 minutes

export function getEiaHealth(): { configured: boolean; skipped?: boolean; reason?: string } {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    return { configured: false, skipped: true, reason: 'EIA_API_KEY not configured' };
  }
  return { configured: true };
}

export async function fetchEiaPetroleum(): Promise<PetroleumResults> {
  const apiKey = process.env.EIA_API_KEY;

  if (!apiKey) {
    throw new Error('EIA_API_KEY not configured');
  }

  const now = Date.now();
  if (petroleumCache && now - petroleumCache.timestamp < CACHE_TTL) {
    return petroleumCache.data;
  }

  const series: Record<string, string> = {
    wti: 'PET.RWTC.W',
    brent: 'PET.RBRTE.W',
    production: 'PET.WCRFPUS2.W',
    inventory: 'PET.WCESTUS1.W',
  };

  const results: PetroleumResults = {};

  // Fetch all series in parallel
  const fetchPromises = Object.entries(series).map(
    async ([key, seriesId]): Promise<{
      key: string;
      data: PetroleumDataPoint;
    } | null> => {
      try {
        const response = await fetch(
          `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${apiKey}&num=2`,
          { headers: { Accept: 'application/json' } }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const values = data?.response?.data || [];

        if (values.length >= 1) {
          return {
            key,
            data: {
              current: values[0]?.value,
              previous: values[1]?.value || values[0]?.value,
              date: values[0]?.period,
              unit: values[0]?.unit,
            },
          };
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error(`[EIA] Failed to fetch ${key}:`, message);
      }
      return null;
    }
  );

  const fetchResults = await Promise.all(fetchPromises);

  for (const result of fetchResults) {
    if (result) {
      (results as Record<string, PetroleumDataPoint>)[result.key] = result.data;
    }
  }

  petroleumCache = { data: results, timestamp: now };

  return results;
}
