const FRED_CACHE_TTL = 3600 * 1000; // 1 hour

const cacheMap = new Map<string, { data: unknown; expires: number }>();

interface FredParams {
  series_id: string;
  observation_start?: string;
  observation_end?: string;
}

export async function fetchFredData(params: FredParams) {
  const { series_id, observation_start, observation_end } = params;

  if (!series_id) {
    throw new Error("Missing series_id parameter");
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return {
      observations: [],
      skipped: true,
      reason: "FRED_API_KEY not configured",
    };
  }

  const cacheKey = `fred:${series_id}:${observation_start || ""}:${observation_end || ""}`;
  const cached = cacheMap.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  const queryParams = new URLSearchParams({
    series_id,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "10",
  });

  if (observation_start) queryParams.set("observation_start", observation_start);
  if (observation_end) queryParams.set("observation_end", observation_end);

  const fredUrl = `https://api.stlouisfed.org/fred/series/observations?${queryParams}`;
  const response = await fetch(fredUrl, {
    headers: { Accept: "application/json" },
  });

  const data = await response.json();
  cacheMap.set(cacheKey, { data, expires: Date.now() + FRED_CACHE_TTL });
  return data;
}
