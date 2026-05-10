import type { AppContext } from "../identity/context.js";
import { processAvatarImage } from "../identity/avatar.processor.js";
import {
  createAvatarService,
  type AvatarServiceRepos,
} from "../identity/avatar.service.js";
import { createAvatarStorage } from "../identity/avatar.storage.js";
import { apiError, type ApiErrorCode } from "../identity/errors.js";
import { createIdentityService } from "../identity/identity.service.js";
import { serializeAvatarUrl } from "../identity/profile-serialization.js";
import { normalizeProfileLookupWallets } from "../identity/profile-lookup.js";
import { identityRateLimiter } from "../identity/rate-limit.js";
import {
  createIdentityRepos,
  getProfilesByWallets,
} from "../identity/repositories.js";
import {
  normalizeWalletAddress,
  verifyWalletSignature,
} from "../identity/wallet.js";
import {
  createWalletSessionService,
  fillxWalletKeyFromParts,
  type WalletSessionCurrentUser,
} from "../identity/wallet-session.service.js";
import {
  currentUserAuthFromContext,
  clearBrowserSessionCookies,
  protectedProcedure,
  pub,
  setBrowserSessionCookie,
  walletSessionProcedure,
} from "./procedures.js";

function serializeUser(user: {
  id: string;
  display_name: string | null;
  avatar_key: string | null;
  nationality: string | null;
  primaryWallet?: {
    chainType: "evm" | "solana";
    walletAddress: string;
    walletKey: string;
  } | null;
}) {
  return {
    id: user.id,
    displayName: user.display_name,
    avatarUrl: serializeAvatarUrl(user),
    nationality: user.nationality,
    primaryWallet: user.primaryWallet ?? null,
  };
}

function serializePublicProfile(profile: {
  userId: string;
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
      user: serializeUser(current.user),
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

function apiErrorForIdentityServiceError(error: unknown): never {
  if (error instanceof Error) {
    const codeByMessage: Partial<Record<string, ApiErrorCode>> = {
      USERNAME_REQUIRED: "USERNAME_REQUIRED",
      INVALID_DISPLAY_NAME: "INVALID_DISPLAY_NAME",
      DISPLAY_NAME_TAKEN: "DISPLAY_NAME_TAKEN",
      USER_NOT_FOUND: "USER_NOT_FOUND",
    };
    const code = codeByMessage[error.message];
    if (code) throw apiError(code);
  }
  throw error;
}

async function verifiedWalletSessionUser(input: {
  context: AppContext;
  repos: ReturnType<typeof createIdentityRepos>;
  chainType: "evm" | "solana";
  walletAddress: string;
}) {
  const existingWallet = await input.repos.wallets.findByWallet({
    chainType: input.chainType,
    walletAddress: input.walletAddress,
  });
  if (existingWallet) {
    const existingUser = await input.repos.users.findById(
      existingWallet.user_id,
    );
    if (!existingUser) throw apiError("USER_NOT_FOUND");
    return existingUser;
  }

  const identityService = createIdentityService({
    users: input.repos.users,
    authIdentities: input.repos.authIdentities,
  });
  const current = await identityService.getCurrentUser({
    auth: currentUserAuthFromContext(input.context),
  });
  const user =
    current.user ?? (await identityService.createUserFromWalletProof());

  const primaryWallet = await input.repos.wallets.findPrimaryByUserId(user.id);
  if (
    primaryWallet &&
    (primaryWallet.chain_type !== input.chainType ||
      primaryWallet.wallet_address !== input.walletAddress)
  ) {
    throw apiError("PRIMARY_WALLET_ALREADY_SET");
  }

  if (!primaryWallet) {
    await input.repos.wallets.createPrimaryWallet({
      userId: user.id,
      chainType: input.chainType,
      walletAddress: input.walletAddress,
    });
  }

  return user;
}

async function primaryWalletProfileForUser(
  repos: ReturnType<typeof createIdentityRepos>,
  userId: string,
) {
  const primaryWallet = await repos.wallets.findPrimaryByUserId(userId);
  return primaryWallet
    ? {
        chainType: primaryWallet.chain_type,
        walletAddress: primaryWallet.wallet_address,
        walletKey: fillxWalletKeyFromParts({
          chainType: primaryWallet.chain_type,
          walletAddress: primaryWallet.wallet_address,
        }),
      }
    : null;
}

function walletRateLimitKey(input: {
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

function createWalletSessionServiceForContext(context: AppContext) {
  const makeRepos = (db: AppContext["db"]) => createIdentityRepos(db);
  return createWalletSessionService(makeRepos(context.db));
}

function createAvatarServiceForContext(context: AppContext) {
  const makeRepos = (db: AppContext["db"]): AvatarServiceRepos => {
    const repos = createIdentityRepos(db);
    return {
      users: repos.users,
      avatarUploads: repos.avatarUploads,
      runTransaction: <T>(fn: (repos: AvatarServiceRepos) => Promise<T>) =>
        context.db.transaction(async (tx) =>
          fn(makeRepos(tx as unknown as AppContext["db"])),
        ),
    };
  };

  const storage = createAvatarStorage();
  return createAvatarService(makeRepos(context.db), storage, processAvatarImage);
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
          const walletKey = walletRateLimitKey(input);
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

    verifyWalletSession: pub.identity.verifyWalletSession.handler(
      async ({ input, context }) => {
        const result = await context.db.transaction(async (tx) => {
          const repos = createIdentityRepos(
            tx as unknown as AppContext["db"],
          );
          const challenge =
            await repos.walletSignInChallenges.findByIdForUpdate(
              input.challengeId,
            );
          if (!challenge) throw apiError("CHALLENGE_NOT_FOUND");
          if (challenge.consumed_at) throw apiError("CHALLENGE_ALREADY_USED");
          if (challenge.expires_at.getTime() <= Date.now()) {
            throw apiError("CHALLENGE_EXPIRED");
          }

          const isValid = await verifyWalletSignature({
            chainType: challenge.chain_type,
            walletAddress: challenge.wallet_address,
            message: challenge.message,
            signature: input.signature,
          });
          if (!isValid) throw apiError("SIGNATURE_INVALID");

          const user = await verifiedWalletSessionUser({
            context,
            repos,
            chainType: challenge.chain_type,
            walletAddress: challenge.wallet_address,
          });

          const consumed =
            await repos.walletSignInChallenges.consumeIfUnused(challenge.id);
          if (!consumed) throw apiError("CHALLENGE_ALREADY_USED");

          const remembered = await createWalletSessionService(
            repos,
          ).rememberVerifiedWallet({
            sessionToken: context.fillxSessionToken,
            walletAddress: challenge.wallet_address,
            chainType: challenge.chain_type,
            chainId: challenge.chain_id,
            userId: user.id,
          });

          return {
            sessionToken: remembered.sessionToken,
            current: {
              state: "authenticated" as const,
              walletKey: remembered.walletKey,
              user: {
                ...user,
                primaryWallet: await primaryWalletProfileForUser(
                  repos,
                  user.id,
                ),
              },
              guest: null,
              resumeExpiresAt: remembered.expiresAt,
            },
          };
        });

        setBrowserSessionCookie(context, result.sessionToken);
        context.userIdentity = {
          type: "fillx",
          userId: result.current.user.id,
        };
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
          const updated = await service
            .updateProfile({
              userId: user.id,
              displayName: input.displayName,
              nationality: input.nationality,
            })
            .catch(apiErrorForIdentityServiceError);
          return { user: serializeUser(updated) };
        }),
    ),

    requestAvatarUpload: pub.identity.requestAvatarUpload.handler(
      async ({ input, context }) =>
        walletSessionProcedure(context, async ({ user }) =>
          createAvatarServiceForContext(context).requestAvatarUpload({
            userId: user.id,
            contentType: input.contentType,
            contentLength: input.contentLength,
          }),
        ),
    ),

    finalizeAvatarUpload: pub.identity.finalizeAvatarUpload.handler(
      async ({ input, context }) =>
        walletSessionProcedure(context, async ({ user }) => {
          const updated = await createAvatarServiceForContext(
            context,
          ).finalizeAvatarUpload({
            userId: user.id,
            uploadId: input.uploadId,
          });
          return { user: serializeUser(updated) };
        }),
    ),

    removeAvatar: pub.identity.removeAvatar.handler(async ({ context }) =>
      walletSessionProcedure(context, async ({ user }) => {
        const updated = await createAvatarServiceForContext(context).removeAvatar({
          userId: user.id,
        });
        return { user: serializeUser(updated) };
      }),
    ),
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
