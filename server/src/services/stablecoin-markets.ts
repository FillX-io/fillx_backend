const CACHE_TTL = 120 * 1000; // 2 minutes

const DEFAULT_COINS = "tether,usd-coin,dai,first-digital-usd,ethena-usde";

let cache: { key: string; data: unknown; expires: number } | null = null;

interface Stablecoin {
  id: string;
  symbol: string;
  name: string;
  price: number;
  deviation: number;
  pegStatus: string;
  marketCap: number;
  volume24h: number;
  change24h: number;
  change7d: number;
  image: string;
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalMarketCap: 0,
      totalVolume24h: 0,
      coinCount: 0,
      depeggedCount: 0,
      healthStatus: "UNAVAILABLE",
    },
    stablecoins: [] as Stablecoin[],
    unavailable: true,
  };
}

export async function fetchStablecoinMarkets(params?: { coins?: string }) {
  const rawCoins = params?.coins || DEFAULT_COINS;
  const cacheKey = `stablecoin-markets:v1:${rawCoins}`;

  if (cache && cache.key === cacheKey && Date.now() < cache.expires) {
    return cache.data;
  }

  const coins =
    rawCoins
      .split(",")
      .filter((c) => /^[a-z0-9-]+$/.test(c))
      .join(",") || DEFAULT_COINS;

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);

    const apiUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coins}&order=market_cap_desc&sparkline=false&price_change_percentage=7d`;
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(id);

    if (res.status === 429) {
      if (cache) return cache.data;
      throw new Error("Rate limited");
    }

    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = await res.json();

    const stablecoins: Stablecoin[] = (data as any[]).map((coin) => {
      const price = coin.current_price || 0;
      const deviation = Math.abs(price - 1.0);
      let pegStatus: string;
      if (deviation <= 0.005) pegStatus = "ON PEG";
      else if (deviation <= 0.01) pegStatus = "SLIGHT DEPEG";
      else pegStatus = "DEPEGGED";

      return {
        id: coin.id,
        symbol: (coin.symbol || "").toUpperCase(),
        name: coin.name,
        price,
        deviation: +(deviation * 100).toFixed(3),
        pegStatus,
        marketCap: coin.market_cap || 0,
        volume24h: coin.total_volume || 0,
        change24h: coin.price_change_percentage_24h || 0,
        change7d: coin.price_change_percentage_7d_in_currency || 0,
        image: coin.image,
      };
    });

    const totalMarketCap = stablecoins.reduce(
      (sum, c) => sum + c.marketCap,
      0
    );
    const totalVolume24h = stablecoins.reduce(
      (sum, c) => sum + c.volume24h,
      0
    );
    const depeggedCount = stablecoins.filter(
      (c) => c.pegStatus === "DEPEGGED"
    ).length;

    const result = {
      timestamp: new Date().toISOString(),
      summary: {
        totalMarketCap,
        totalVolume24h,
        coinCount: stablecoins.length,
        depeggedCount,
        healthStatus:
          depeggedCount === 0
            ? "HEALTHY"
            : depeggedCount === 1
              ? "CAUTION"
              : "WARNING",
      },
      stablecoins,
    };

    cache = { key: cacheKey, data: result, expires: Date.now() + CACHE_TTL };
    return result;
  } catch {
    const fallback = cache?.data || buildFallbackResult();
    cache = {
      key: cacheKey,
      data: fallback,
      expires: Date.now() + 30_000,
    };
    return fallback;
  }
}
