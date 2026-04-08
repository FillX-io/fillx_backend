const BASE = "https://api.coingecko.com/api/v3";

let cache: { key: string; data: unknown; expires: number } | null = null;
const TTL = 60 * 1000;

interface Params {
  ids?: string;
  vs_currencies: string;
  per_page: number;
}

export async function fetchCoingecko(params: Params) {
  const cacheKey = JSON.stringify(params);
  if (cache && cache.key === cacheKey && Date.now() < cache.expires) {
    return cache.data;
  }

  const url = new URL(`${BASE}/coins/markets`);
  url.searchParams.set("vs_currency", params.vs_currencies);
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", String(params.per_page));
  url.searchParams.set("sparkline", "true");
  if (params.ids) url.searchParams.set("ids", params.ids);

  const res = await fetch(url);
  const data = await res.json();

  cache = { key: cacheKey, data, expires: Date.now() + TTL };
  return data;
}
