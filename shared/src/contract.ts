import { oc } from "@orpc/contract";
import { z } from "zod";

// Generic passthrough schema for endpoints that return dynamic data
const JsonData = z.any();
const ChainType = z.enum(["evm", "solana"]);
const AvatarUploadContentType = z.enum(["image/jpeg", "image/png", "image/webp"]);
const FillxPrimaryWallet = z.object({
  chainType: ChainType,
  walletAddress: z.string(),
  walletKey: z.string(),
});
const FillxUserProfile = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
  primaryWallet: FillxPrimaryWallet.nullable(),
});
const GuestResponse = z.object({ isGuest: z.literal(true) });
const PublicFillxProfile = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
  primaryWallet: FillxPrimaryWallet,
});
const CurrentUserResponse = z.object({
  state: z.enum([
    "no_active_wallet",
    "authenticated",
    "public_profile_requires_signature",
    "no_profile",
  ]),
  walletKey: z.string().optional(),
  user: FillxUserProfile.nullable(),
  guest: GuestResponse.nullable(),
  profile: PublicFillxProfile.optional(),
  resumeExpiresAt: z.string().optional(),
});
const PublicWalletProfile = z.object({
  walletAddress: z.string(),
  userId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
});

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
  classifyBatch: oc.input(z.object({
    titles: z.array(z.string()),
    variant: z.string().optional(),
  })).output(JsonData),
  countryIntel: oc.input(z.object({
    country: z.string(),
    context: z.any().optional(),
  })).output(JsonData),
  groqSummarize: oc.input(z.object({
    headlines: z.array(z.string()).optional(),
    mode: z.string().optional(),
    geoContext: z.string().optional(),
    variant: z.string().optional(),
    lang: z.string().optional(),
    language: z.string().optional(),
  })).output(JsonData),
  openrouterSummarize: oc.input(z.object({
    headlines: z.array(z.string()).optional(),
    mode: z.string().optional(),
    geoContext: z.string().optional(),
    variant: z.string().optional(),
    lang: z.string().optional(),
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
    pairs: z.string().optional(),
    method: z.string().optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
  })).output(JsonData),
  techEvents: oc.output(JsonData),
  worldbank: oc.input(z.object({
    indicator: z.string().optional(),
    countries: z.string().optional(),
  })).output(JsonData),
  worldpopExposure: oc.input(z.object({
    mode: z.string().optional(),
    lat: z.coerce.number().optional(),
    lon: z.coerce.number().optional(),
    radius: z.coerce.number().optional(),
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

  // ─── Identity ──────────────────────────────────────
  identity: oc.router({
    getCurrentUser: oc.output(CurrentUserResponse),
    clearSession: oc.output(z.object({ ok: z.literal(true) })),
    requestWalletSessionChallenge: oc
      .input(
        z.object({
          walletAddress: z.string(),
          chainType: ChainType,
          chainId: z.number().int().positive().nullable().optional(),
        }),
      )
      .output(
        z.object({
          challengeId: z.string(),
          expiresAt: z.string(),
          message: z.string(),
        }),
      ),
    createWalletSession: oc
      .input(
        z.object({
          challengeId: z.string(),
          signature: z.string(),
        }),
      )
      .output(CurrentUserResponse),
    verifyWalletSession: oc
      .input(
        z.object({
          challengeId: z.string(),
          signature: z.string(),
        }),
      )
      .output(CurrentUserResponse),
    updateDisplayName: oc
      .input(
        z.object({
          displayName: z.string().max(50).nullable().optional(),
          nationality: z.string().nullable().optional(),
        }),
      )
      .output(z.object({ user: FillxUserProfile })),
    requestAvatarUpload: oc
      .input(
        z.object({
          contentType: AvatarUploadContentType,
          contentLength: z.number().int().positive().max(5 * 1024 * 1024),
        }),
      )
      .output(
        z.object({
          uploadId: z.string(),
          uploadUrl: z.string(),
          fields: z.record(z.string()),
          expiresAt: z.string(),
        }),
      ),
    finalizeAvatarUpload: oc
      .input(z.object({ uploadId: z.string() }))
      .output(z.object({ user: FillxUserProfile })),
    removeAvatar: oc.output(z.object({ user: FillxUserProfile })),
  }),
  profile: oc.router({
    getByWallets: oc
      .input(z.object({ walletAddresses: z.array(z.string()).max(500) }))
      .output(z.object({ profiles: z.array(PublicWalletProfile) })),
  }),
  orderly: oc.router({
    linkAccount: oc
      .input(
        z.object({
          orderlyAccountId: z.string(),
          orderlyAddress: z.string(),
          brokerId: z.string().nullable().optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
  }),

  // ─── Anti-Fraud ────────────────────────────────────
  trackIpConnection: oc
    .input(
      z.object({
        wallet: z.string().min(1),
        ip: z.string().min(1),
        city: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
      }),
    )
    .output(z.object({ success: z.literal(true) })),
});

export type Contract = typeof contract;
