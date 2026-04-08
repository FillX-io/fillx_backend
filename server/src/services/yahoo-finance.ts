const YF_CACHE_TTL = 60 * 1000;
const SYMBOL_PATTERN = /^[A-Za-z0-9.^=\-]+$/;
const MAX_SYMBOL_LENGTH = 20;

let cache: { key: string; data: unknown; expires: number } | null = null;

function validateSymbol(symbol: string | null): string | null {
  if (!symbol) return null;
  const trimmed = symbol.trim().toUpperCase();
  if (trimmed.length > MAX_SYMBOL_LENGTH) return null;
  if (!SYMBOL_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export async function fetchYahooFinance(params: { symbol: string }) {
  const symbol = validateSymbol(params.symbol);
  if (!symbol) {
    throw new Error("Invalid or missing symbol parameter");
  }

  const cacheKey = `yf:${symbol}`;
  if (cache && cache.key === cacheKey && Date.now() < cache.expires) {
    return cache.data;
  }

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const response = await fetch(yahooUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  const data = await response.json();
  cache = { key: cacheKey, data, expires: Date.now() + YF_CACHE_TTL };
  return data;
}
