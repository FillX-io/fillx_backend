import { oc } from "@orpc/contract";
import { z } from "zod";

// Generic passthrough schema for endpoints that return dynamic data
const JsonData = z.any();

export const contract = oc.router({
  // ─── Health ────────────────────────────────────────
  health: oc.output(z.object({ status: z.literal("ok") })),

  // ─── Financial ─────────────────────────────────────
  earthquakes: oc.output(JsonData),
  coingecko: oc.input(z.object({
    ids: z.string().optional(),
    vs_currencies: z.string().default("usd"),
    per_page: z.coerce.number().default(50),
    endpoint: z.string().optional(),
  })).output(JsonData),
  yahooFinance: oc.input(z.object({ symbol: z.string() })).output(JsonData),
  stockIndex: oc.input(z.object({ code: z.string() })).output(JsonData),
  etfFlows: oc.output(JsonData),
  fredData: oc.input(z.object({
    series_id: z.string(),
    observation_start: z.string().optional(),
    observation_end: z.string().optional(),
  })).output(JsonData),
  finnhub: oc.input(z.object({ symbols: z.string() })).output(JsonData),
  macroSignals: oc.output(JsonData),
  stablecoinMarkets: oc.input(z.object({ coins: z.string().optional() })).output(JsonData),
  polymarket: oc.input(z.object({
    endpoint: z.string().optional(),
    closed: z.string().optional(),
    order: z.string().optional(),
    ascending: z.string().optional(),
    limit: z.string().optional(),
    tag: z.string().optional(),
  })).output(JsonData),

  // ─── Intelligence ──────────────────────────────────
  acled: oc.output(JsonData),
  acledConflict: oc.output(JsonData),
  gdeltDoc: oc.input(z.object({
    query: z.string(),
    maxrecords: z.coerce.number().optional(),
    timespan: z.string().optional(),
  })).output(JsonData),
  gdeltGeo: oc.input(z.object({
    query: z.string().optional(),
    format: z.string().optional(),
    maxrecords: z.string().optional(),
    timespan: z.string().optional(),
  })).output(JsonData),
  cyberThreats: oc.input(z.object({
    type: z.string().optional(),
    source: z.string().optional(),
    severity: z.string().optional(),
    limit: z.coerce.number().optional(),
    days: z.coerce.number().optional(),
  })).output(JsonData),
  ucdp: oc.output(JsonData),
  ucdpEvents: oc.output(JsonData),
  hapi: oc.output(JsonData),
  unhcrPopulation: oc.output(JsonData),
  riskScores: oc.output(JsonData),
  theaterPosture: oc.output(JsonData),
  temporalBaseline: oc.input(z.object({
    action: z.string().optional(),
    metric: z.string().optional(),
    value: z.coerce.number().optional(),
  })).output(JsonData),

  // ─── LLM ───────────────────────────────────────────
  classifyEvent: oc.input(z.object({ title: z.string() })).output(JsonData),
  classifyBatch: oc.input(z.object({ titles: z.array(z.string()) })).output(JsonData),
  countryIntel: oc.input(z.object({
    country: z.string(),
    context: z.any().optional(),
  })).output(JsonData),
  groqSummarize: oc.input(z.object({
    headlines: z.array(z.string()).optional(),
    mode: z.string().optional(),
    variant: z.string().optional(),
    language: z.string().optional(),
  })).output(JsonData),
  openrouterSummarize: oc.input(z.object({
    headlines: z.array(z.string()).optional(),
    mode: z.string().optional(),
    variant: z.string().optional(),
    language: z.string().optional(),
  })).output(JsonData),

  // ─── Climate & Environment ─────────────────────────
  climateAnomalies: oc.output(JsonData),
  firmsFires: oc.input(z.object({
    region: z.string().optional(),
    days: z.coerce.number().optional(),
  })).output(JsonData),

  // ─── Content & Proxy ───────────────────────────────
  rssProxy: oc.input(z.object({ url: z.string() })).output(JsonData),
  faaStatus: oc.output(JsonData),
  opensky: oc.input(z.object({
    lamin: z.string().optional(),
    lomin: z.string().optional(),
    lamax: z.string().optional(),
    lomax: z.string().optional(),
  })).output(JsonData),
  arxiv: oc.input(z.object({
    category: z.string().optional(),
    max_results: z.coerce.number().optional(),
  })).output(JsonData),
  hackernews: oc.input(z.object({
    type: z.string().optional(),
    limit: z.coerce.number().optional(),
  })).output(JsonData),
  githubTrending: oc.input(z.object({
    language: z.string().optional(),
    since: z.string().optional(),
  })).output(JsonData),

  // ─── Monitoring ────────────────────────────────────
  aisSnapshot: oc.input(z.object({ candidates: z.string().optional() })).output(JsonData),
  cloudflareOutages: oc.input(z.object({
    dateRange: z.string().optional(),
    limit: z.coerce.number().optional(),
  })).output(JsonData),
  ngaWarnings: oc.output(JsonData),
  serviceStatus: oc.output(JsonData),

  // ─── Specialized ───────────────────────────────────
  pizzintDashboard: oc.output(JsonData),
  pizzintData: oc.output(JsonData),
  pizzintGdeltBatch: oc.input(z.object({
    query: z.string().optional(),
    timespan: z.string().optional(),
  })).output(JsonData),
  techEvents: oc.output(JsonData),
  worldbank: oc.input(z.object({
    indicator: z.string().optional(),
    countries: z.string().optional(),
  })).output(JsonData),
  worldpopExposure: oc.input(z.object({
    lat: z.coerce.number().optional(),
    lon: z.coerce.number().optional(),
    country: z.string().optional(),
  })).output(JsonData),
  militaryHexDb: oc.input(z.object({ hex: z.string().optional() })).output(JsonData),

  // ─── Utility ───────────────────────────────────────
  version: oc.output(JsonData),
  download: oc.input(z.object({ platform: z.string().optional() })).output(JsonData),
  cacheTelemetry: oc.output(JsonData),

  // ─── YouTube ───────────────────────────────────────
  youtubeEmbed: oc.input(z.object({ v: z.string() })).output(JsonData),
  youtubeLive: oc.input(z.object({ channel: z.string() })).output(JsonData),

  // ─── Wingbits ──────────────────────────────────────
  wingbitsFlights: oc.input(z.object({
    lamin: z.string().optional(),
    lomin: z.string().optional(),
    lamax: z.string().optional(),
    lomax: z.string().optional(),
  })).output(JsonData),
  wingbitsDetails: oc.input(z.object({ icao24: z.string() })).output(JsonData),
  wingbitsBatch: oc.input(z.object({ ids: z.string() })).output(JsonData),

  // ─── EIA ───────────────────────────────────────────
  eiaPetroleum: oc.input(z.object({
    series: z.string().optional(),
    frequency: z.string().optional(),
  })).output(JsonData),

  // ─── FwdStart ──────────────────────────────────────
  fwdstart: oc.output(JsonData),
});

export type Contract = typeof contract;
