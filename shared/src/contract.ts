import { oc } from "@orpc/contract";
import {
  HealthResponse,
  EarthquakeResponse,
  CoingeckoQuery,
  CoinMarket,
} from "./schemas.js";
import { z } from "zod";

export const contract = oc.router({
  health: oc.output(HealthResponse),

  earthquakes: oc.output(EarthquakeResponse),

  coingecko: oc.input(CoingeckoQuery).output(z.array(CoinMarket)),
});

export type Contract = typeof contract;
