const CACHE_TTL = 900 * 1000; // 15 minutes

let cache: { data: unknown; expires: number } | null = null;

interface EtfDef {
  ticker: string;
  issuer: string;
}

const ETF_LIST: EtfDef[] = [
  { ticker: "IBIT", issuer: "BlackRock" },
  { ticker: "FBTC", issuer: "Fidelity" },
  { ticker: "ARKB", issuer: "ARK/21Shares" },
  { ticker: "BITB", issuer: "Bitwise" },
  { ticker: "GBTC", issuer: "Grayscale" },
  { ticker: "HODL", issuer: "VanEck" },
  { ticker: "BRRR", issuer: "Valkyrie" },
  { ticker: "EZBC", issuer: "Franklin" },
  { ticker: "BTCO", issuer: "Invesco" },
  { ticker: "BTCW", issuer: "WisdomTree" },
];

async function fetchChart(ticker: string): Promise<unknown | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

interface EtfResult {
  ticker: string;
  issuer: string;
  price: number;
  priceChange: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  direction: string;
  estFlow: number;
}

function parseChartData(
  chart: any,
  ticker: string,
  issuer: string
): EtfResult | null {
  try {
    const result = chart?.chart?.result?.[0];
    if (!result) return null;

    const quote = result.indicators?.quote?.[0];
    const closes: (number | null)[] = quote?.close || [];
    const volumes: (number | null)[] = quote?.volume || [];

    const validCloses = closes.filter((p): p is number => p != null);
    const validVolumes = volumes.filter((v): v is number => v != null);

    if (validCloses.length < 2) return null;

    const latestPrice = validCloses[validCloses.length - 1];
    const prevPrice = validCloses[validCloses.length - 2];
    const priceChange = prevPrice
      ? ((latestPrice - prevPrice) / prevPrice) * 100
      : 0;

    const latestVolume =
      validVolumes.length > 0 ? validVolumes[validVolumes.length - 1] : 0;
    const avgVolume =
      validVolumes.length > 1
        ? validVolumes.slice(0, -1).reduce((a, b) => a + b, 0) /
          (validVolumes.length - 1)
        : latestVolume;

    const volumeRatio = avgVolume > 0 ? latestVolume / avgVolume : 1;
    const direction =
      priceChange > 0.1
        ? "inflow"
        : priceChange < -0.1
          ? "outflow"
          : "neutral";
    const estFlowMagnitude =
      latestVolume * latestPrice * (priceChange > 0 ? 1 : -1) * 0.1;

    return {
      ticker,
      issuer,
      price: +latestPrice.toFixed(2),
      priceChange: +priceChange.toFixed(2),
      volume: latestVolume,
      avgVolume: Math.round(avgVolume),
      volumeRatio: +volumeRatio.toFixed(2),
      direction,
      estFlow: Math.round(estFlowMagnitude),
    };
  } catch {
    return null;
  }
}

function buildFallbackResult() {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      etfCount: 0,
      totalVolume: 0,
      totalEstFlow: 0,
      netDirection: "UNAVAILABLE",
      inflowCount: 0,
      outflowCount: 0,
    },
    etfs: [] as EtfResult[],
    unavailable: true,
  };
}

export async function fetchEtfFlows() {
  if (cache && Date.now() < cache.expires) {
    return cache.data;
  }

  try {
    const charts = await Promise.allSettled(
      ETF_LIST.map((etf) => fetchChart(etf.ticker))
    );

    const etfs: EtfResult[] = [];
    for (let i = 0; i < ETF_LIST.length; i++) {
      const chart =
        charts[i].status === "fulfilled" ? (charts[i] as PromiseFulfilledResult<unknown>).value : null;
      if (chart) {
        const parsed = parseChartData(
          chart,
          ETF_LIST[i].ticker,
          ETF_LIST[i].issuer
        );
        if (parsed) etfs.push(parsed);
      }
    }

    const totalVolume = etfs.reduce((sum, e) => sum + e.volume, 0);
    const totalEstFlow = etfs.reduce((sum, e) => sum + e.estFlow, 0);
    const inflowCount = etfs.filter((e) => e.direction === "inflow").length;
    const outflowCount = etfs.filter((e) => e.direction === "outflow").length;

    const result = {
      timestamp: new Date().toISOString(),
      summary: {
        etfCount: etfs.length,
        totalVolume,
        totalEstFlow,
        netDirection:
          totalEstFlow > 0
            ? "NET INFLOW"
            : totalEstFlow < 0
              ? "NET OUTFLOW"
              : "NEUTRAL",
        inflowCount,
        outflowCount,
      },
      etfs: etfs.sort((a, b) => b.volume - a.volume),
    };

    cache = { data: result, expires: Date.now() + CACHE_TTL };
    return result;
  } catch {
    const fallback = cache?.data || buildFallbackResult();
    cache = { data: fallback, expires: Date.now() + 30_000 };
    return fallback;
  }
}
