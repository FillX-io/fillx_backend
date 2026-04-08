const FH_CACHE_TTL = 30 * 1000; // 30 seconds
const SYMBOL_PATTERN = /^[A-Za-z0-9.^]+$/;
const MAX_SYMBOLS = 20;
const MAX_SYMBOL_LENGTH = 10;

const cacheMap = new Map<string, { data: unknown; expires: number }>();

function validateSymbols(symbolsParam: string | null): string[] | null {
  if (!symbolsParam) return null;

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length <= MAX_SYMBOL_LENGTH && SYMBOL_PATTERN.test(s))
    .slice(0, MAX_SYMBOLS);

  return symbols.length > 0 ? symbols : null;
}

interface FinnhubQuote {
  symbol: string;
  price?: number;
  change?: number;
  changePercent?: number;
  high?: number;
  low?: number;
  open?: number;
  previousClose?: number;
  timestamp?: number;
  error?: string;
}

async function fetchQuote(
  symbol: string,
  apiKey: string
): Promise<FinnhubQuote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    return { symbol, error: `HTTP ${response.status}` };
  }

  const data = await response.json();

  if (data.c === 0 && data.h === 0 && data.l === 0) {
    return { symbol, error: "No data available" };
  }

  return {
    symbol,
    price: data.c,
    change: data.d,
    changePercent: data.dp,
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
    timestamp: data.t,
  };
}

export async function fetchFinnhub(params: { symbols: string }) {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    return {
      quotes: [],
      skipped: true,
      reason: "FINNHUB_API_KEY not configured",
    };
  }

  const symbols = validateSymbols(params.symbols);
  if (!symbols) {
    throw new Error("Invalid or missing symbols parameter");
  }

  const cacheKey = `finnhub:${symbols.join(",")}`;
  const cached = cacheMap.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  const quotes = await Promise.all(
    symbols.map((symbol) => fetchQuote(symbol, apiKey))
  );

  const result = { quotes };
  cacheMap.set(cacheKey, { data: result, expires: Date.now() + FH_CACHE_TTL });
  return result;
}
