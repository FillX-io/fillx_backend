import type { AppContext } from "../identity/context.js";
import { apiError } from "../identity/errors.js";
import { createIdentityService } from "../identity/identity.service.js";
import { normalizeProfileLookupWallets } from "../identity/profile-lookup.js";
import { identityRateLimiter } from "../identity/rate-limit.js";
import {
  createIdentityRepos,
  getProfilesByWallets,
} from "../identity/repositories.js";
import {
  createUsernameService,
  type UsernameServiceRepos,
} from "../identity/username.service.js";
import { normalizeWalletAddress } from "../identity/wallet.js";
import {
  createWalletSessionService,
  partsFromFillxWalletKey,
  type WalletSessionCurrentUser,
} from "../identity/wallet-session.service.js";
import {
  currentUserAuthFromContext,
  clearBrowserSessionCookies,
  protectedProcedure,
  pub,
  resolveProtectedUser,
  setBrowserSessionCookie,
} from "./procedures.js";

function serializeUser(user: {
  id: string;
  username: string;
  username_status: "generated" | "claimed";
  display_name: string | null;
  avatar_url: string | null;
  nationality: string | null;
  primaryWallet?: {
    chainType: "evm" | "solana";
    walletAddress: string;
    walletKey: string;
  } | null;
}) {
  return {
    id: user.id,
    username: user.username,
    usernameStatus: user.username_status,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    nationality: user.nationality,
    hasClaimedUsername: user.username_status === "claimed",
    primaryWallet: user.primaryWallet ?? null,
  };
}

function serializePublicProfile(profile: {
  userId: string;
  username: string;
  usernameStatus: "generated" | "claimed";
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  primaryWallet: {
    chainType: "evm" | "solana";
    walletAddress: string;
    walletKey: string;
  };
}) {
  return {
    userId: profile.userId,
    username: profile.username,
    usernameStatus: profile.usernameStatus,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    nationality: profile.nationality,
    primaryWallet: profile.primaryWallet,
  };
}

function serializeCurrentWalletUser(current: WalletSessionCurrentUser) {
  if (current.state === "authenticated") {
    return {
      state: current.state,
      walletKey: current.walletKey,
      user: serializeUser({
        ...current.user,
        primaryWallet: (() => {
          const parts = partsFromFillxWalletKey(current.walletKey);
          return parts
            ? {
                chainType: parts.chainType,
                walletAddress: parts.walletAddress,
                walletKey: current.walletKey,
              }
            : null;
        })(),
      }),
      guest: null,
      resumeExpiresAt: current.resumeExpiresAt,
    };
  }

  if (current.state === "public_profile_requires_signature") {
    return {
      state: current.state,
      walletKey: current.walletKey,
      user: null,
      guest: null,
      profile: serializePublicProfile(current.profile),
    };
  }

  if (current.state === "no_profile") {
    return {
      state: current.state,
      walletKey: current.walletKey,
      user: null,
      guest: null,
    };
  }

  return {
    state: current.state,
    user: null,
    guest: current.guest,
  };
}

function requirePrivy(context: AppContext) {
  if (context.auth.type !== "privy") {
    throw apiError("AUTH_REQUIRED");
  }
  return context.auth.privy;
}

async function authenticatedUserIdFromContext(
  context: AppContext,
): Promise<string | null> {
  if (context.userIdentity.type === "fillx") {
    return context.userIdentity.userId;
  }

  if (context.auth.type === "privy") {
    return (await resolveProtectedUser(context)).id;
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

function createWalletSessionServiceForContext(context: AppContext) {
  const makeRepos = (db: AppContext["db"]) => createIdentityRepos(db);
  return createWalletSessionService(makeRepos(context.db));
}

export const identityRoutes = {
  identity: {
    getCurrentUser: pub.identity.getCurrentUser.handler(
      async ({ context }) => {
        const repos = createIdentityRepos(context.db);
        if (context.auth.type === "privy") {
          const service = createIdentityService({
            users: repos.users,
            authIdentities: repos.authIdentities,
          });
          const current = await service.getCurrentUser({
            auth: currentUserAuthFromContext(context),
          });
          if (current.user) {
            context.userIdentity = { type: "fillx", userId: current.user.id };
          }
          return {
            state: current.user ? "authenticated" : "no_active_wallet",
            user: current.user ? serializeUser(current.user) : null,
            guest: current.guest,
          };
        }

        return serializeCurrentWalletUser(
          await createWalletSessionService(repos).resolveCurrentUser({
            sessionToken: context.fillxSessionToken,
            activeWalletKey: context.activeWalletKey,
          }),
        );
      },
    ),

    clearSession: pub.identity.clearSession.handler(async ({ context }) => {
      await createWalletSessionServiceForContext(context).clearSession({
        sessionToken: context.fillxSessionToken,
      });
      clearBrowserSessionCookies(context);
      context.userIdentity = { type: "anonymous" };
      return { ok: true as const };
    }),

    requestWalletSessionChallenge:
      pub.identity.requestWalletSessionChallenge.handler(
        async ({ input, context }) => {
          const walletKey = usernameClaimRateLimitWalletKey(input);
          const limit = identityRateLimiter.check({
            key: `${walletKey}:requestWalletSessionChallenge`,
            limit: 10,
            windowMs: 60 * 60 * 1000,
          });
          if (!limit.allowed) throw apiError("RATE_LIMITED");
          return createWalletSessionServiceForContext(
            context,
          ).requestWalletSessionChallenge({
            walletAddress: input.walletAddress,
            chainType: input.chainType,
            chainId: input.chainId ?? null,
          });
        },
      ),

    createWalletSession: pub.identity.createWalletSession.handler(
      async ({ input, context }) => {
        const result = await createWalletSessionServiceForContext(
          context,
        ).createWalletSession({
          sessionToken: context.fillxSessionToken,
          challengeId: input.challengeId,
          signature: input.signature,
        });
        setBrowserSessionCookie(context, result.sessionToken);
        return serializeCurrentWalletUser(result.current);
      },
    ),

    updateDisplayName: pub.identity.updateDisplayName.handler(
      async ({ input, context }) =>
        protectedProcedure(context, async ({ user }) => {
          const repos = createIdentityRepos(context.db);
          const service = createIdentityService({
            users: repos.users,
            authIdentities: repos.authIdentities,
          });
          const updated = await service.updateProfile({
            userId: user.id,
            displayName: input.displayName,
            avatarUrl: input.avatarUrl,
            nationality: input.nationality,
          });
          return { user: serializeUser(updated) };
        }),
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
      const updated = await createUsernameServiceForContext(
        context,
      ).claimUsername(input);
      const repos = createIdentityRepos(context.db);
      const challenge = await repos.usernameClaims.findChallengeById(
        input.challengeId,
      );
      if (challenge) {
        const remembered =
          await createWalletSessionServiceForContext(context).rememberVerifiedWallet({
            sessionToken: context.fillxSessionToken,
            walletAddress: challenge.wallet_address,
            chainType: challenge.chain_type,
            chainId: challenge.chain_id,
            userId: updated.id,
          });
        setBrowserSessionCookie(context, remembered.sessionToken);
      }
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
      requirePrivy(context);
      return protectedProcedure(context, async ({ user }) => {
        const repos = createIdentityRepos(context.db);
        await repos.orderlyAccounts.upsertOrderlyAccount({
          userId: user.id,
          orderlyAccountId: input.orderlyAccountId,
          orderlyAddress: normalizeWalletAddress("evm", input.orderlyAddress),
          brokerId: input.brokerId ?? null,
        });
        return { ok: true as const };
      });
    }),
  },
};
