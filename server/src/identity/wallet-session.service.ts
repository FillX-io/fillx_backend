import type {
  ChainType,
  FillxSessionFamily,
  FillxUser,
  FillxWalletSession,
  UserWallet,
  WalletSignInChallenge,
} from "../db/schema.js";
import { apiError } from "./errors.js";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  createOpaqueSessionToken,
  hashOpaqueSessionToken,
} from "./session.js";
import { normalizeWalletAddress, verifyWalletSignature } from "./wallet.js";
import { buildWalletSessionMessage } from "./wallet-session-message.js";
import { serializeAvatarUrl } from "./profile-serialization.js";

const WALLET_SESSION_TTL_MS = DEFAULT_SESSION_MAX_AGE_SECONDS * 1000;

export type FillxPrimaryWalletProfile = {
  chainType: ChainType;
  walletAddress: string;
  walletKey: string;
};

export type FillxPublicProfile = {
  userId: string;
  username: string;
  usernameStatus: "generated" | "claimed";
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  primaryWallet: FillxPrimaryWalletProfile;
};

export type WalletSessionCurrentUser =
  | {
      state: "no_active_wallet";
      user: null;
      guest: { isGuest: true };
    }
  | {
      state: "authenticated";
      walletKey: string;
      user: FillxUser;
      guest: null;
      resumeExpiresAt: string;
    }
  | {
      state: "public_profile_requires_signature";
      walletKey: string;
      user: null;
      guest: null;
      profile: FillxPublicProfile;
    }
  | {
      state: "no_profile";
      walletKey: string;
      user: null;
      guest: null;
    };

export type VerifiedFillxWalletSession = {
  familyId: string;
  walletSessionId: string;
  walletKey: string;
  userId: string;
  expiresAt: Date;
};

export type WalletSessionServiceRepos = {
  users: {
    findById: (id: string) => Promise<FillxUser | undefined>;
  };
  wallets: {
    findByWallet: (input: {
      chainType: ChainType;
      walletAddress: string;
    }) => Promise<UserWallet | undefined>;
  };
  sessionFamilies: {
    findActiveByTokenHash: (input: {
      tokenHash: string;
      now: Date;
    }) => Promise<FillxSessionFamily | undefined>;
    create: (input: {
      tokenHash: string;
      expiresAt: Date;
      now: Date;
    }) => Promise<FillxSessionFamily>;
    rotateToken: (input: {
      familyId: string;
      tokenHash: string;
      expiresAt: Date;
      now: Date;
    }) => Promise<FillxSessionFamily>;
    touch: (input: {
      familyId: string;
      now: Date;
    }) => Promise<FillxSessionFamily>;
    revoke: (input: {
      familyId: string;
      now: Date;
      reason: string;
    }) => Promise<void>;
  };
  walletSessions: {
    findActive: (input: {
      familyId: string;
      walletKey: string;
      now: Date;
    }) => Promise<FillxWalletSession | undefined>;
    upsert: (input: {
      familyId: string;
      walletKey: string;
      walletAddress: string;
      walletNamespace: ChainType;
      signatureScheme: string;
      lastSignedChain: string | null;
      signedAt: Date;
      profileUserId: string;
      now: Date;
      expiresAt: Date;
    }) => Promise<FillxWalletSession>;
    touch: (input: { walletSessionId: string; now: Date }) => Promise<void>;
    revokeByFamily: (input: {
      familyId: string;
      now: Date;
      reason: string;
    }) => Promise<void>;
  };
  walletSignInChallenges: {
    create: (input: {
      walletKey: string;
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
      nonce: string;
      message: string;
      expiresAt: Date;
      now: Date;
    }) => Promise<WalletSignInChallenge>;
    findByIdForUpdate: (
      id: string,
    ) => Promise<WalletSignInChallenge | undefined>;
    consumeIfUnused: (
      id: string,
    ) => Promise<WalletSignInChallenge | undefined>;
  };
};

export function fillxWalletKeyFromParts(input: {
  chainType: ChainType;
  walletAddress: string;
}): string {
  const normalizedAddress = normalizeWalletAddress(
    input.chainType,
    input.walletAddress,
  );
  return `${input.chainType}:${normalizedAddress}`;
}

export function parseActiveWalletSelector(value: string | null): string | null {
  if (!value) return null;
  const [namespace, ...addressParts] = value.trim().split(":");
  const walletAddress = addressParts.join(":");
  if (
    (namespace !== "evm" && namespace !== "solana") ||
    !walletAddress ||
    addressParts.length !== 1
  ) {
    return null;
  }

  try {
    return fillxWalletKeyFromParts({
      chainType: namespace,
      walletAddress,
    });
  } catch {
    return null;
  }
}

export function partsFromFillxWalletKey(walletKey: string): {
  chainType: ChainType;
  walletAddress: string;
} | null {
  const [namespace, ...addressParts] = walletKey.split(":");
  const walletAddress = addressParts.join(":");
  if (
    (namespace !== "evm" && namespace !== "solana") ||
    !walletAddress ||
    addressParts.length !== 1
  ) {
    return null;
  }
  return { chainType: namespace, walletAddress };
}

export function createWalletSessionService(
  repos: WalletSessionServiceRepos,
  options: {
    now?: () => Date;
    nonce?: () => string;
    createToken?: () => string;
    hashToken?: (token: string) => string;
    verifySignature?: typeof verifyWalletSignature;
    avatarPublicBaseUrl?: string;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => crypto.randomUUID().replaceAll("-", ""));
  const createToken = options.createToken ?? createOpaqueSessionToken;
  const hashToken = options.hashToken ?? hashOpaqueSessionToken;
  const verifySignature = options.verifySignature ?? verifyWalletSignature;
  const avatarPublicBaseUrl =
    options.avatarPublicBaseUrl ?? process.env.AVATAR_PUBLIC_BASE_URL ?? "";

  function expiryFrom(proofTime: Date): Date {
    return new Date(proofTime.getTime() + WALLET_SESSION_TTL_MS);
  }

  async function getFamilyFromToken(
    sessionToken: string | null,
    currentTime: Date,
  ): Promise<FillxSessionFamily | undefined> {
    if (!sessionToken) return undefined;
    return repos.sessionFamilies.findActiveByTokenHash({
      tokenHash: hashToken(sessionToken),
      now: currentTime,
    });
  }

  async function findPublicProfileByWalletKey(
    walletKey: string,
  ): Promise<FillxPublicProfile | null> {
    const parts = partsFromFillxWalletKey(walletKey);
    if (!parts) return null;
    const wallet = await repos.wallets.findByWallet({
      chainType: parts.chainType,
      walletAddress: parts.walletAddress,
    });
    if (!wallet) return null;
    const user = await repos.users.findById(wallet.user_id);
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      usernameStatus: user.username_status,
      displayName: user.display_name,
      avatarUrl: serializeAvatarUrl(user, avatarPublicBaseUrl),
      nationality: user.nationality,
      primaryWallet: {
        chainType: wallet.chain_type,
        walletAddress: wallet.wallet_address,
        walletKey: fillxWalletKeyFromParts({
          chainType: wallet.chain_type,
          walletAddress: wallet.wallet_address,
        }),
      },
    };
  }

  async function unauthenticatedWalletResult(
    walletKey: string,
  ): Promise<WalletSessionCurrentUser> {
    const profile = await findPublicProfileByWalletKey(walletKey);
    if (profile) {
      return {
        state: "public_profile_requires_signature",
        walletKey,
        user: null,
        guest: null,
        profile,
      };
    }

    return {
      state: "no_profile",
      walletKey,
      user: null,
      guest: null,
    };
  }

  async function resolveVerifiedSession(input: {
    sessionToken: string | null;
    activeWalletKey: string | null;
    touch?: boolean;
  }): Promise<VerifiedFillxWalletSession | null> {
    if (!input.activeWalletKey) return null;
    const currentTime = now();
    const family = await getFamilyFromToken(input.sessionToken, currentTime);
    if (!family) return null;

    const walletSession = await repos.walletSessions.findActive({
      familyId: family.id,
      walletKey: input.activeWalletKey,
      now: currentTime,
    });
    if (!walletSession) return null;

    if (input.touch ?? true) {
      await repos.sessionFamilies.touch({
        familyId: family.id,
        now: currentTime,
      });
      await repos.walletSessions.touch({
        walletSessionId: walletSession.id,
        now: currentTime,
      });
    }

    return {
      familyId: family.id,
      walletSessionId: walletSession.id,
      walletKey: walletSession.wallet_key,
      userId: walletSession.profile_user_id,
      expiresAt: walletSession.expires_at,
    };
  }

  async function createOrRefreshRememberedWallet(input: {
    sessionToken: string | null;
    walletKey: string;
    walletAddress: string;
    walletNamespace: ChainType;
    lastSignedChain: string | null;
    profileUserId: string;
    signatureScheme: string;
  }): Promise<{ sessionToken: string; walletSession: FillxWalletSession }> {
    const currentTime = now();
    const sessionToken = createToken();
    const tokenHash = hashToken(sessionToken);
    const expiresAt = expiryFrom(currentTime);
    const existingFamily = await getFamilyFromToken(
      input.sessionToken,
      currentTime,
    );
    const family = existingFamily
      ? await repos.sessionFamilies.rotateToken({
          familyId: existingFamily.id,
          tokenHash,
          expiresAt,
          now: currentTime,
        })
      : await repos.sessionFamilies.create({
          tokenHash,
          expiresAt,
          now: currentTime,
        });

    const walletSession = await repos.walletSessions.upsert({
      familyId: family.id,
      walletKey: input.walletKey,
      walletAddress: input.walletAddress,
      walletNamespace: input.walletNamespace,
      signatureScheme: input.signatureScheme,
      lastSignedChain: input.lastSignedChain,
      signedAt: currentTime,
      profileUserId: input.profileUserId,
      now: currentTime,
      expiresAt,
    });

    return { sessionToken, walletSession };
  }

  return {
    async resolveVerifiedSession(input: {
      sessionToken: string | null;
      activeWalletKey: string | null;
      touch?: boolean;
    }): Promise<VerifiedFillxWalletSession | null> {
      return resolveVerifiedSession(input);
    },

    async resolveCurrentUser(input: {
      sessionToken: string | null;
      activeWalletKey: string | null;
    }): Promise<WalletSessionCurrentUser> {
      if (!input.activeWalletKey) {
        return {
          state: "no_active_wallet",
          user: null,
          guest: { isGuest: true },
        };
      }

      const verified = await resolveVerifiedSession({
        sessionToken: input.sessionToken,
        activeWalletKey: input.activeWalletKey,
      });
      if (!verified) return unauthenticatedWalletResult(input.activeWalletKey);

      const user = await repos.users.findById(verified.userId);
      if (!user) return unauthenticatedWalletResult(input.activeWalletKey);

      return {
        state: "authenticated",
        walletKey: verified.walletKey,
        user,
        guest: null,
        resumeExpiresAt: verified.expiresAt.toISOString(),
      };
    },

    async requestWalletSessionChallenge(input: {
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
    }): Promise<{ challengeId: string; expiresAt: string; message: string }> {
      const currentTime = now();
      const walletAddress = normalizeWalletAddress(
        input.chainType,
        input.walletAddress,
      );
      const walletKey = fillxWalletKeyFromParts({
        chainType: input.chainType,
        walletAddress,
      });
      const expiresAt = new Date(currentTime.getTime() + 10 * 60 * 1000);
      const challengeNonce = nonce();
      const message = buildWalletSessionMessage({
        domain: "fillx.io",
        walletAddress,
        action: "sign_in",
        uri: "https://fillx.io/session/sign-in",
        version: "1",
        chainType: input.chainType,
        chainId: input.chainId,
        nonce: challengeNonce,
        issuedAt: currentTime.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      const challenge = await repos.walletSignInChallenges.create({
        walletKey,
        walletAddress,
        chainType: input.chainType,
        chainId: input.chainId,
        nonce: challengeNonce,
        message,
        expiresAt,
        now: currentTime,
      });

      return {
        challengeId: challenge.id,
        expiresAt: expiresAt.toISOString(),
        message,
      };
    },

    async createWalletSession(input: {
      sessionToken: string | null;
      challengeId: string;
      signature: string;
    }): Promise<{ sessionToken: string; current: WalletSessionCurrentUser }> {
      const currentTime = now();
      const challenge = await repos.walletSignInChallenges.findByIdForUpdate(
        input.challengeId,
      );
      if (!challenge) throw apiError("CHALLENGE_NOT_FOUND");
      if (challenge.consumed_at) throw apiError("CHALLENGE_ALREADY_USED");
      if (challenge.expires_at.getTime() <= currentTime.getTime()) {
        throw apiError("CHALLENGE_EXPIRED");
      }

      const isValid = await verifySignature({
        chainType: challenge.chain_type,
        walletAddress: challenge.wallet_address,
        message: challenge.message,
        signature: input.signature,
      });
      if (!isValid) throw apiError("SIGNATURE_INVALID");

      const wallet = await repos.wallets.findByWallet({
        chainType: challenge.chain_type,
        walletAddress: challenge.wallet_address,
      });
      if (!wallet) throw apiError("WALLET_PROFILE_NOT_FOUND");

      const user = await repos.users.findById(wallet.user_id);
      if (!user) throw apiError("USER_NOT_FOUND");

      const consumed = await repos.walletSignInChallenges.consumeIfUnused(
        challenge.id,
      );
      if (!consumed) throw apiError("CHALLENGE_ALREADY_USED");

      const remembered = await createOrRefreshRememberedWallet({
        sessionToken: input.sessionToken,
        walletKey: challenge.wallet_key,
        walletAddress: challenge.wallet_address,
        walletNamespace: challenge.chain_type,
        signatureScheme: challenge.chain_type === "evm" ? "eip191" : "ed25519",
        lastSignedChain:
          challenge.chain_type === "evm" && challenge.chain_id
            ? `eip155:${challenge.chain_id}`
            : null,
        profileUserId: user.id,
      });

      return {
        sessionToken: remembered.sessionToken,
        current: {
          state: "authenticated",
          walletKey: remembered.walletSession.wallet_key,
          user,
          guest: null,
          resumeExpiresAt: remembered.walletSession.expires_at.toISOString(),
        },
      };
    },

    async rememberVerifiedWallet(input: {
      sessionToken: string | null;
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
      userId: string;
    }): Promise<{ sessionToken: string; walletKey: string; expiresAt: string }> {
      const walletAddress = normalizeWalletAddress(
        input.chainType,
        input.walletAddress,
      );
      const walletKey = fillxWalletKeyFromParts({
        chainType: input.chainType,
        walletAddress,
      });
      const remembered = await createOrRefreshRememberedWallet({
        sessionToken: input.sessionToken,
        walletKey,
        walletAddress,
        walletNamespace: input.chainType,
        signatureScheme: input.chainType === "evm" ? "eip191" : "ed25519",
        lastSignedChain:
          input.chainType === "evm" && input.chainId
            ? `eip155:${input.chainId}`
            : null,
        profileUserId: input.userId,
      });

      return {
        sessionToken: remembered.sessionToken,
        walletKey: remembered.walletSession.wallet_key,
        expiresAt: remembered.walletSession.expires_at.toISOString(),
      };
    },

    async clearSession(input: {
      sessionToken: string | null;
      reason?: string;
    }): Promise<void> {
      const currentTime = now();
      const family = await getFamilyFromToken(input.sessionToken, currentTime);
      if (!family) return;
      const reason = input.reason ?? "logout";
      await repos.sessionFamilies.revoke({
        familyId: family.id,
        now: currentTime,
        reason,
      });
      await repos.walletSessions.revokeByFamily({
        familyId: family.id,
        now: currentTime,
        reason,
      });
    },
  };
}
