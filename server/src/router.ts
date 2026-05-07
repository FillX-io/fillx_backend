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
import type { AppContext } from "./identity/context.js";
import { apiError } from "./identity/errors.js";
import { createIdentityService } from "./identity/identity.service.js";
import { identityRateLimiter } from "./identity/rate-limit.js";
import {
  createIdentityRepos,
  getProfilesByWallets,
} from "./identity/repositories.js";
import {
  createUsernameService,
  type UsernameServiceRepos,
} from "./identity/username.service.js";
import { normalizeProfileLookupWallets } from "./identity/profile-lookup.js";
import { setFillxSessionCookie, signFillxSession } from "./identity/session.js";
import { normalizeWalletAddress } from "./identity/wallet.js";

const pub = implement(contract).$context<AppContext>();

function serializeUser(user: {
  id: string;
  username: string;
  username_status: "generated" | "claimed";
  display_name: string | null;
  avatar_url: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    usernameStatus: user.username_status,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    hasClaimedUsername: user.username_status === "claimed",
  };
}

function requirePrivy(context: AppContext) {
  if (context.auth.type !== "privy") {
    throw apiError("AUTH_REQUIRED");
  }
  return context.auth.privy;
}

function isSecureCookieEnv(context: AppContext): boolean {
  return context.env.nodeEnv !== "development" && context.env.nodeEnv !== "test";
}

function requireFillxSessionSecret(context: AppContext): string {
  if (!context.env.fillxJwtSecret) throw apiError("SESSION_NOT_CONFIGURED");
  return context.env.fillxJwtSecret;
}

async function issueFillxSession(
  context: AppContext,
  userId: string,
): Promise<void> {
  const secret = requireFillxSessionSecret(context);
  const token = await signFillxSession({
    userId,
    secret,
  });
  setFillxSessionCookie(context.resHeaders, token, {
    secure: isSecureCookieEnv(context),
  });
}

function currentUserAuthFromContext(context: AppContext) {
  if (context.auth.type === "privy") {
    return {
      type: "privy" as const,
      privyUserId: context.auth.privy.privyUserId,
    };
  }
  if (context.auth.type === "fillx") {
    return { type: "fillx" as const, userId: context.auth.session.userId };
  }
  return { type: "anonymous" as const };
}

async function authenticatedUserIdFromContext(
  context: AppContext,
): Promise<string | null> {
  if (context.auth.type === "fillx") return context.auth.session.userId;

  if (context.auth.type === "privy") {
    requireFillxSessionSecret(context);
    const repos = createIdentityRepos(context.db);
    const service = createIdentityService({
      users: repos.users,
      authIdentities: repos.authIdentities,
    });
    const current = await service.getCurrentUser({
      auth: { type: "privy", privyUserId: context.auth.privy.privyUserId },
    });
    if (current.user) {
      await issueFillxSession(context, current.user.id);
      return current.user.id;
    }
  }

  return null;
}

function usernameClaimRateLimitWalletKey(input: {
  chainType: "evm" | "solana";
  walletAddress: string;
}): string {
  const rawKey = `${input.chainType}:${input.walletAddress}`;
  try {
    const walletAddress =
      input.chainType === "evm"
        ? input.walletAddress.trim().replace(/^0X/, "0x")
        : input.walletAddress.trim();
    return `${input.chainType}:${normalizeWalletAddress(
      input.chainType,
      walletAddress,
    )}`;
  } catch {
    return rawKey;
  }
}

function createUsernameServiceForContext(context: AppContext) {
  const makeRepos = (db: AppContext["db"]): UsernameServiceRepos => {
    const repos = createIdentityRepos(db);
    return {
      users: repos.users,
      wallets: repos.wallets,
      usernameClaims: repos.usernameClaims,
      runTransaction: <T>(fn: (repos: UsernameServiceRepos) => Promise<T>) =>
        context.db.transaction(async (tx) =>
          fn(makeRepos(tx as unknown as AppContext["db"])),
        ),
    };
  };

  return createUsernameService(makeRepos(context.db));
}

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
  groqSummarize: pub.groqSummarize.handler(async ({ input }) => await groqSummarize({
    headlines: input.headlines ?? [],
    mode: input.mode,
    geoContext: input.geoContext,
    variant: input.variant,
    lang: input.lang ?? input.language,
  })),
  openrouterSummarize: pub.openrouterSummarize.handler(async ({ input }) => await openrouterSummarize({
    headlines: input.headlines ?? [],
    mode: input.mode,
    geoContext: input.geoContext,
    variant: input.variant,
    lang: input.lang ?? input.language,
  })),

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

  // ─── Identity ──────────────────────────────────────
  identity: {
    getCurrentUser: pub.identity.getCurrentUser.handler(
      async ({ context }) => {
        if (context.auth.type === "privy") {
          requireFillxSessionSecret(context);
        }
        const repos = createIdentityRepos(context.db);
        const service = createIdentityService({
          users: repos.users,
          authIdentities: repos.authIdentities,
        });
        const current = await service.getCurrentUser({
          auth: currentUserAuthFromContext(context),
        });
        if (current.user && context.auth.type === "privy") {
          await issueFillxSession(context, current.user.id);
        }
        return {
          user: current.user ? serializeUser(current.user) : null,
          guest: current.guest,
        };
      },
    ),

    updateDisplayName: pub.identity.updateDisplayName.handler(
      async ({ input, context }) => {
        if (context.auth.type === "privy") {
          requireFillxSessionSecret(context);
        }
        const repos = createIdentityRepos(context.db);
        const service = createIdentityService({
          users: repos.users,
          authIdentities: repos.authIdentities,
        });
        const current = await service.getCurrentUser({
          auth: currentUserAuthFromContext(context),
        });
        if (!current.user) throw apiError("AUTH_REQUIRED");
        if (context.auth.type === "privy") {
          await issueFillxSession(context, current.user.id);
        }
        const updated = await service.updateDisplayName({
          userId: current.user.id,
          displayName: input.displayName,
        });
        return { user: serializeUser(updated) };
      },
    ),
  },

  username: {
    checkAvailable: pub.username.checkAvailable.handler(
      async ({ input, context }) => {
        const limit = identityRateLimiter.check({
          key: `${context.ipAddress}:checkUsernameAvailable`,
          limit: 60,
          windowMs: 60 * 60 * 1000,
        });
        if (!limit.allowed) throw apiError("RATE_LIMITED");
        return createUsernameServiceForContext(context).checkAvailable(
          input.username,
        );
      },
    ),

    requestClaimChallenge: pub.username.requestClaimChallenge.handler(
      async ({ input, context }) => {
        const walletKey = usernameClaimRateLimitWalletKey(input);
        const limit = identityRateLimiter.check({
          key: `${walletKey}:requestUsernameClaim`,
          limit: 10,
          windowMs: 60 * 60 * 1000,
        });
        if (!limit.allowed) throw apiError("RATE_LIMITED");
        return createUsernameServiceForContext(context).requestClaimChallenge({
          authenticatedUserId: await authenticatedUserIdFromContext(context),
          username: input.username,
          walletAddress: input.walletAddress,
          chainType: input.chainType,
          chainId: input.chainId ?? null,
        });
      },
    ),

    claim: pub.username.claim.handler(async ({ input, context }) => {
      const limit = identityRateLimiter.check({
        key: `${context.ipAddress}:claimUsername`,
        limit: 10,
        windowMs: 60 * 60 * 1000,
      });
      if (!limit.allowed) throw apiError("RATE_LIMITED");
      requireFillxSessionSecret(context);
      const updated = await createUsernameServiceForContext(
        context,
      ).claimUsername(input);
      await issueFillxSession(context, updated.id);
      return { user: serializeUser(updated) };
    }),
  },

  profile: {
    getByWallets: pub.profile.getByWallets.handler(
      async ({ input, context }) => {
        return {
          profiles: await getProfilesByWallets(
            context.db,
            normalizeProfileLookupWallets(input.walletAddresses),
          ),
        };
      },
    ),
  },

  orderly: {
    linkAccount: pub.orderly.linkAccount.handler(async ({ input, context }) => {
      const privy = requirePrivy(context);
      requireFillxSessionSecret(context);
      const repos = createIdentityRepos(context.db);
      const identity = createIdentityService({
        users: repos.users,
        authIdentities: repos.authIdentities,
      });
      const current = await identity.getCurrentUser({
        auth: { type: "privy", privyUserId: privy.privyUserId },
      });
      if (!current.user) throw apiError("AUTH_REQUIRED");
      await issueFillxSession(context, current.user.id);
      await repos.orderlyAccounts.upsertOrderlyAccount({
        userId: current.user.id,
        orderlyAccountId: input.orderlyAccountId,
        orderlyAddress: normalizeWalletAddress("evm", input.orderlyAddress),
        brokerId: input.brokerId ?? null,
      });
      return { ok: true as const };
    }),
  },

  // ─── Anti-Fraud ────────────────────────────────────
  trackIpConnection: pub.trackIpConnection.handler(
    async ({ input }) => await trackIpConnection(input),
  ),
});

export type Router = typeof router;
