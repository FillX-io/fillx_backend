import { implement } from "@orpc/server";
import { contract } from "@fillx/shared";

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
import { checkAnomaly, updateBaselines } from "./services/temporal-baseline.js";
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
import { fetchPizzintData } from "./services/pizzint-data.js";
import { fetchGdeltBatch } from "./services/pizzint-gdelt-batch.js";
import { getTechEvents } from "./services/tech-events.js";
import { getWorldBankData } from "./services/worldbank.js";
import { getWorldPopExposure } from "./services/worldpop-exposure.js";
import { isMilitaryHex, MILITARY_HEX_LIST } from "./services/military-hex-db.js";
import { getLatestVersion } from "./services/version.js";
import { getDownloadUrl } from "./services/download.js";
import { getCacheTelemetrySnapshot } from "./services/cache-telemetry-endpoint.js";
import { generateYouTubeEmbed } from "./services/youtube-embed.js";
import { checkYouTubeLive } from "./services/youtube-live.js";
import { fetchFlights } from "./services/wingbits.js";
import { fetchWingbitsDetails } from "./services/wingbits-details.js";
import { fetchWingbitsBatch } from "./services/wingbits-batch.js";
import { fetchEiaPetroleum } from "./services/eia.js";
import { fetchFwdStartRss } from "./services/fwdstart.js";
import { trackIpConnection } from "./services/track-ip-connection.js";

const pub = implement(contract);

export const router = pub.router({
  health: pub.health.handler(async () => ({ status: "ok" as const })),

  // ─── Financial ─────────────────────────────────────
  earthquakes: pub.earthquakes.handler(async () => await fetchEarthquakes()),
  coingecko: pub.coingecko.handler(async ({ input }) => await fetchCoingecko(input as any)),
  yahooFinance: pub.yahooFinance.handler(async ({ input }) => await fetchYahooFinance(input as any)),
  stockIndex: pub.stockIndex.handler(async ({ input }) => await fetchStockIndex(input as any)),
  etfFlows: pub.etfFlows.handler(async () => await fetchEtfFlows()),
  fredData: pub.fredData.handler(async ({ input }) => await fetchFredData(input as any)),
  finnhub: pub.finnhub.handler(async ({ input }) => await fetchFinnhub(input as any)),
  macroSignals: pub.macroSignals.handler(async () => await fetchMacroSignals()),
  stablecoinMarkets: pub.stablecoinMarkets.handler(async ({ input }) => await fetchStablecoinMarkets(input as any)),
  polymarket: pub.polymarket.handler(async ({ input }) => await fetchPolymarket(input as any)),

  // ─── Intelligence ──────────────────────────────────
  acled: pub.acled.handler(async () => await fetchAcledProtests()),
  acledConflict: pub.acledConflict.handler(async () => await fetchAcledConflict()),
  gdeltDoc: pub.gdeltDoc.handler(async ({ input }) => await fetchGdeltDoc(input.query, input.maxrecords, input.timespan)),
  gdeltGeo: pub.gdeltGeo.handler(async ({ input }) => await fetchGdeltGeo(input as any)),
  cyberThreats: pub.cyberThreats.handler(async ({ input }) => await fetchCyberThreats(input as any)),
  ucdp: pub.ucdp.handler(async () => await fetchUcdpConflicts()),
  ucdpEvents: pub.ucdpEvents.handler(async () => await fetchUcdpEvents()),
  hapi: pub.hapi.handler(async () => await fetchHapiConflictEvents()),
  unhcrPopulation: pub.unhcrPopulation.handler(async () => await fetchUnhcrPopulation()),
  riskScores: pub.riskScores.handler(async () => await fetchRiskScores()),
  theaterPosture: pub.theaterPosture.handler(async () => await fetchTheaterPosture()),
  temporalBaseline: pub.temporalBaseline.handler(async ({ input }) => {
    if (input.action === "check" && input.metric && input.value !== undefined) {
      return checkAnomaly(input.metric, input.value, "global");
    }
    if (input.action === "update" && input.metric && input.value !== undefined) {
      return await updateBaselines([{ type: input.metric, count: input.value }]);
    }
    return { error: "Invalid action" };
  }),

  // ─── LLM ───────────────────────────────────────────
  classifyEvent: pub.classifyEvent.handler(async ({ input }) => await classifyEvent(input as any)),
  classifyBatch: pub.classifyBatch.handler(async ({ input }) => await classifyBatch(input as any)),
  countryIntel: pub.countryIntel.handler(async ({ input }) => await getCountryIntel({ country: input.country, code: input.country, context: input.context })),
  groqSummarize: pub.groqSummarize.handler(async ({ input }) => await groqSummarize({ headlines: input.headlines ?? [], mode: input.mode, variant: input.variant, lang: input.language })),
  openrouterSummarize: pub.openrouterSummarize.handler(async ({ input }) => await openrouterSummarize({ headlines: input.headlines ?? [], mode: input.mode, variant: input.variant, lang: input.language })),

  // ─── Climate & Environment ─────────────────────────
  climateAnomalies: pub.climateAnomalies.handler(async () => await getClimateAnomalies()),
  firmsFires: pub.firmsFires.handler(async ({ input }) => await getFirmsFires(input as any)),

  // ─── Content & Proxy ───────────────────────────────
  rssProxy: pub.rssProxy.handler(async ({ input }) => await fetchRssFeed({ url: input.url })),
  faaStatus: pub.faaStatus.handler(async () => await getFaaStatus()),
  opensky: pub.opensky.handler(async ({ input }) => await getOpenskyStates(input as any)),
  arxiv: pub.arxiv.handler(async ({ input }) => await getArxivPapers({ category: input.category, max_results: input.max_results != null ? String(input.max_results) : undefined })),
  hackernews: pub.hackernews.handler(async ({ input }) => await getHackerNews({ type: input.type, limit: input.limit != null ? String(input.limit) : undefined })),
  githubTrending: pub.githubTrending.handler(async ({ input }) => await getGithubTrending(input as any)),

  // ─── Monitoring ────────────────────────────────────
  aisSnapshot: pub.aisSnapshot.handler(async ({ input }) => await getAisSnapshot({ candidates: input.candidates === "true" })),
  cloudflareOutages: pub.cloudflareOutages.handler(async ({ input }) => await getCloudflareOutages({ dateRange: input.dateRange, limit: input.limit != null ? String(input.limit) : undefined })),
  ngaWarnings: pub.ngaWarnings.handler(async () => await getNgaWarnings()),
  serviceStatus: pub.serviceStatus.handler(async () => await getServiceStatus()),

  // ─── Specialized ───────────────────────────────────
  pizzintDashboard: pub.pizzintDashboard.handler(async () => await fetchPizzintDashboard()),
  pizzintData: pub.pizzintData.handler(async () => await fetchPizzintData()),
  pizzintGdeltBatch: pub.pizzintGdeltBatch.handler(async ({ input }) => await fetchGdeltBatch(input as any)),
  techEvents: pub.techEvents.handler(async () => await getTechEvents()),
  worldbank: pub.worldbank.handler(async ({ input }) => await getWorldBankData(input as any)),
  worldpopExposure: pub.worldpopExposure.handler(async ({ input }) => await getWorldPopExposure(input as any)),
  militaryHexDb: pub.militaryHexDb.handler(async ({ input }) => {
    if (input.hex) return { military: isMilitaryHex(input.hex) };
    return { hexList: MILITARY_HEX_LIST };
  }),

  // ─── Utility ───────────────────────────────────────
  version: pub.version.handler(async () => await getLatestVersion()),
  download: pub.download.handler(async ({ input }) => await getDownloadUrl(input as any)),
  cacheTelemetry: pub.cacheTelemetry.handler(async () => getCacheTelemetrySnapshot()),

  // ─── YouTube ───────────────────────────────────────
  youtubeEmbed: pub.youtubeEmbed.handler(async ({ input }) => generateYouTubeEmbed(input as any)),
  youtubeLive: pub.youtubeLive.handler(async ({ input }) => await checkYouTubeLive(input.channel)),

  // ─── Wingbits ──────────────────────────────────────
  wingbitsFlights: pub.wingbitsFlights.handler(async ({ input }) => await fetchFlights(input as any)),
  wingbitsDetails: pub.wingbitsDetails.handler(async ({ input }) => await fetchWingbitsDetails(input.icao24)),
  wingbitsBatch: pub.wingbitsBatch.handler(async ({ input }) => await fetchWingbitsBatch(input.ids.split(","))),

  // ─── EIA ───────────────────────────────────────────
  eiaPetroleum: pub.eiaPetroleum.handler(async () => await fetchEiaPetroleum()),

  // ─── FwdStart ──────────────────────────────────────
  fwdstart: pub.fwdstart.handler(async () => await fetchFwdStartRss()),

  // ─── Anti-Fraud ────────────────────────────────────
  trackIpConnection: pub.trackIpConnection.handler(
    async ({ input }) => await trackIpConnection(input),
  ),
});

export type Router = typeof router;
