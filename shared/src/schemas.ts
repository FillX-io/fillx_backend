import { z } from "zod";

// ─── Earthquake ────────────────────────────────────────

export const EarthquakeFeature = z.object({
  id: z.string(),
  properties: z.object({
    mag: z.number().nullable(),
    place: z.string().nullable(),
    time: z.number(),
    url: z.string(),
    title: z.string(),
  }),
  geometry: z.object({
    coordinates: z.tuple([z.number(), z.number(), z.number()]),
  }),
});

export const EarthquakeResponse = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(EarthquakeFeature),
});

// ─── CoinGecko ─────────────────────────────────────────

export const CoinMarket = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  current_price: z.number(),
  price_change_percentage_24h: z.number().nullable(),
  market_cap: z.number(),
});

export const CoingeckoQuery = z.object({
  ids: z.string().optional(),
  vs_currencies: z.string().default("usd"),
  per_page: z.coerce.number().default(50),
});

// ─── Health ────────────────────────────────────────────

export const HealthResponse = z.object({
  status: z.literal("ok"),
});
