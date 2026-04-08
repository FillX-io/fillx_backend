const USGS_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";

let cache: { data: unknown; expires: number } | null = null;
const TTL = 2 * 60 * 1000;

export async function fetchEarthquakes() {
  if (cache && Date.now() < cache.expires) return cache.data;

  const res = await fetch(USGS_URL);
  const data = await res.json();

  cache = { data, expires: Date.now() + TTL };
  return data;
}
