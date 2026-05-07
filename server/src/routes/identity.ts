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
  currentUserAuthFromContext,
  issueFillxSession,
  protectedProcedure,
  pub,
  requireFillxSessionSecret,
  resolveProtectedUser,
} from "./procedures.js";

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

export const identityRoutes = {
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
          context.userIdentity = { type: "fillx", userId: current.user.id };
          await issueFillxSession(context, current.user.id);
        }
        return {
          user: current.user ? serializeUser(current.user) : null,
          guest: current.guest,
        };
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
          const updated = await service.updateDisplayName({
            userId: user.id,
            displayName: input.displayName,
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
