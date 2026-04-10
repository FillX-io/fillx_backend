import type { IncomingMessage, ServerResponse } from "node:http";

// ─── Service imports (same as router.ts) ──────────────────────
import { fetchEarthquakes } from "./services/earthquakes.js";
import { fetchCoingecko } from "./services/coingecko.js";
import { fetchYahooFinance } from "./services/yahoo-finance.js";
import { fetchStockIndex } from "./services/stock-index.js";
import { fetchEtfFlows } from "./services/etf-flows.js";
import { fetchFredData } from "./services/fred-data.js";
import { fetchFinnhub } from "./services/finnhub.js";
import { fetchMacroSignals } from "./services/macro-signals.js";
import { fetchStablecoinMarkets } from "./services/stablecoin-markets.js";
import { fetchPolymarket } from "./services/polymarket.js";
import { fetchAcledProtests } from "./services/acled.js";
import { fetchAcledConflict } from "./services/acled-conflict.js";
import { fetchGdeltDoc } from "./services/gdelt-doc.js";
import { fetchGdeltGeo } from "./services/gdelt-geo.js";
import { fetchCyberThreats } from "./services/cyber-threats.js";
import { fetchUcdpConflicts } from "./services/ucdp.js";
import { fetchUcdpEvents } from "./services/ucdp-events.js";
import { fetchHapiConflictEvents } from "./services/hapi.js";
import { fetchUnhcrPopulation } from "./services/unhcr-population.js";
import { fetchRiskScores } from "./services/risk-scores.js";
import { fetchTheaterPosture } from "./services/theater-posture.js";
import { classifyEvent } from "./services/classify-event.js";
import { classifyBatch } from "./services/classify-batch.js";
import { getCountryIntel } from "./services/country-intel.js";
import { groqSummarize } from "./services/groq-summarize.js";
import { openrouterSummarize } from "./services/openrouter-summarize.js";
import { getClimateAnomalies } from "./services/climate-anomalies.js";
import { getFirmsFires } from "./services/firms-fires.js";
import { fetchRssFeed } from "./services/rss-proxy.js";
import { getFaaStatus } from "./services/faa-status.js";
import { getOpenskyStates } from "./services/opensky.js";
import { getArxivPapers } from "./services/arxiv.js";
import { getHackerNews } from "./services/hackernews.js";
import { getGithubTrending } from "./services/github-trending.js";
import { getAisSnapshot } from "./services/ais-snapshot.js";
import { getCloudflareOutages } from "./services/cloudflare-outages.js";
import { getNgaWarnings } from "./services/nga-warnings.js";
import { getServiceStatus } from "./services/service-status.js";
import { fetchPizzintDashboard } from "./services/pizzint-dashboard.js";
import { getTechEvents } from "./services/tech-events.js";
import { getWorldBankData } from "./services/worldbank.js";
import { getWorldPopExposure } from "./services/worldpop-exposure.js";
import { getLatestVersion } from "./services/version.js";
import { getDownloadUrl } from "./services/download.js";
import { getCacheTelemetrySnapshot } from "./services/cache-telemetry-endpoint.js";
import { translateTexts } from "./services/translate.js";
import { analyzeMarket } from "./services/market-analysis.js";

// ─── Helpers ──────────────────────────────────────────────────

/** Convert URLSearchParams → plain object (all values as strings). */
function qsToObj(sp: URLSearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  sp.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

/** Read the full request body as a parsed JSON object. */
function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** Send a JSON response with CORS headers. */
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

// ─── Route table ──────────────────────────────────────────────

type Handler = (query: Record<string, string>, body: any) => Promise<unknown>;

const GET_ROUTES: Record<string, Handler> = {
  "/api/earthquakes": async () => fetchEarthquakes(),
  "/api/coingecko": async (q) => fetchCoingecko(q as any),
  "/api/yahoo-finance": async (q) => fetchYahooFinance(q as any),
  "/api/stock-index": async (q) => fetchStockIndex(q as any),
  "/api/etf-flows": async () => fetchEtfFlows(),
  "/api/fred-data": async (q) => fetchFredData(q as any),
  "/api/finnhub": async (q) => fetchFinnhub(q as any),
  "/api/macro-signals": async () => fetchMacroSignals(),
  "/api/stablecoin-markets": async (q) => fetchStablecoinMarkets(q as any),
  "/api/polymarket": async (q) => fetchPolymarket(q as any),
  "/api/acled": async () => fetchAcledProtests(),
  "/api/acled-conflict": async () => fetchAcledConflict(),
  "/api/gdelt-doc": async (q) => fetchGdeltDoc(q.query ?? "", q.maxrecords ? Number(q.maxrecords) : undefined, q.timespan),
  "/api/gdelt-geo": async (q) => fetchGdeltGeo(q as any),
  "/api/cyber-threats": async (q) => fetchCyberThreats(q as any),
  "/api/ucdp": async () => fetchUcdpConflicts(),
  "/api/ucdp-events": async () => fetchUcdpEvents(),
  "/api/hapi": async () => fetchHapiConflictEvents(),
  "/api/unhcr-population": async () => fetchUnhcrPopulation(),
  "/api/risk-scores": async () => fetchRiskScores(),
  "/api/theater-posture": async () => fetchTheaterPosture(),
  "/api/climate-anomalies": async () => getClimateAnomalies(),
  "/api/firms-fires": async (q) => getFirmsFires(q as any),
  "/api/rss-proxy": async (q) => fetchRssFeed({ url: q.url }),
  "/api/faa-status": async () => getFaaStatus(),
  "/api/opensky": async (q) => getOpenskyStates(q as any),
  "/api/arxiv": async (q) => getArxivPapers({ category: q.category, max_results: q.max_results }),
  "/api/hackernews": async (q) => getHackerNews({ type: q.type, limit: q.limit }),
  "/api/github-trending": async (q) => getGithubTrending(q as any),
  "/api/ais-snapshot": async (q) => getAisSnapshot({ candidates: q.candidates === "true" }),
  "/api/cloudflare-outages": async (q) => getCloudflareOutages({ dateRange: q.dateRange, limit: q.limit }),
  "/api/nga-warnings": async () => getNgaWarnings(),
  "/api/service-status": async () => getServiceStatus(),
  "/api/pizzint-dashboard": async () => fetchPizzintDashboard(),
  "/api/tech-events": async () => getTechEvents(),
  "/api/worldbank": async (q) => getWorldBankData(q as any),
  "/api/worldpop-exposure": async (q) => getWorldPopExposure(q as any),
  "/api/version": async () => getLatestVersion(),
  "/api/download": async (q) => getDownloadUrl(q as any),
  "/api/cache-telemetry": async () => getCacheTelemetrySnapshot(),
};

const POST_ROUTES: Record<string, Handler> = {
  "/api/classify-event": async (_q, body) => classifyEvent(body),
  "/api/classify-batch": async (_q, body) => classifyBatch(body),
  "/api/country-intel": async (_q, body) => getCountryIntel({ country: body.country, code: body.country, context: body.context }),
  "/api/groq-summarize": async (_q, body) => groqSummarize({ headlines: body.headlines ?? [], mode: body.mode, variant: body.variant, lang: body.language }),
  "/api/openrouter-summarize": async (_q, body) => openrouterSummarize({ headlines: body.headlines ?? [], mode: body.mode, variant: body.variant, lang: body.language }),
  "/api/translate": async (_q, body) => {
    const translated = await translateTexts(body.texts ?? [], body.lang ?? "en");
    return { texts: translated };
  },
  "/api/market-analysis": async (_q, body) => {
    return await analyzeMarket({
      type: body.type ?? "analyze",
      symbol: body.symbol,
      strategy: body.strategy,
      indicators: body.indicators,
      lang: body.lang,
    });
  },
};

// ─── Main handler ─────────────────────────────────────────────

export async function handleRestApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method?.toUpperCase() ?? "GET";

  // Handle CORS preflight
  if (method === "OPTIONS") {
    json(res, 204, null);
    return;
  }

  const parsed = new URL(req.url ?? "/", "http://localhost");
  const pathname = parsed.pathname;
  const query = qsToObj(parsed.searchParams);

  try {
    if (method === "GET" && GET_ROUTES[pathname]) {
      const data = await GET_ROUTES[pathname](query, null);
      json(res, 200, data);
      return;
    }

    if (method === "POST" && POST_ROUTES[pathname]) {
      const body = await readBody(req);
      const data = await POST_ROUTES[pathname](query, body);
      json(res, 200, data);
      return;
    }

    json(res, 404, { error: `No REST route for ${method} ${pathname}` });
  } catch (err: any) {
    console.error(`[rest-adapter] ${method} ${pathname} →`, err);
    json(res, 500, { error: err?.message ?? "Internal server error" });
  }
}
