import { classifyBatch } from "../services/classify-batch.js";
import { classifyEvent } from "../services/classify-event.js";
import { getCountryIntel } from "../services/country-intel.js";
import { groqSummarize } from "../services/groq-summarize.js";
import { openrouterSummarize } from "../services/openrouter-summarize.js";
import { pub } from "./procedures.js";

export const aiRoutes = {
  classifyEvent: pub.classifyEvent.handler(
    async ({ input }) => await classifyEvent(input as any),
  ),
  classifyBatch: pub.classifyBatch.handler(
    async ({ input }) => await classifyBatch(input as any),
  ),
  countryIntel: pub.countryIntel.handler(
    async ({ input }) =>
      await getCountryIntel({
        country: input.country,
        code: input.country,
        context: input.context,
      }),
  ),
  groqSummarize: pub.groqSummarize.handler(
    async ({ input }) =>
      await groqSummarize({
        headlines: input.headlines ?? [],
        mode: input.mode,
        geoContext: input.geoContext,
        variant: input.variant,
        lang: input.lang ?? input.language,
      }),
  ),
  openrouterSummarize: pub.openrouterSummarize.handler(
    async ({ input }) =>
      await openrouterSummarize({
        headlines: input.headlines ?? [],
        mode: input.mode,
        geoContext: input.geoContext,
        variant: input.variant,
        lang: input.lang ?? input.language,
      }),
  ),
};
