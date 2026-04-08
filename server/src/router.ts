import { implement } from "@orpc/server";
import { contract } from "@fillx/shared";
import { fetchEarthquakes } from "./services/earthquakes.js";
import { fetchCoingecko } from "./services/coingecko.js";

const pub = implement(contract);

export const router = pub.router({
  health: pub.health.handler(async () => {
    return { status: "ok" as const };
  }),

  earthquakes: pub.earthquakes.handler(async () => {
    return await fetchEarthquakes();
  }),

  coingecko: pub.coingecko.handler(async ({ input }) => {
    return await fetchCoingecko(input);
  }),
});

export type Router = typeof router;
