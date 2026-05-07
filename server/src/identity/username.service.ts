import { createHash } from "node:crypto";
import type {
  ChainType,
  FillxUser,
  UserWallet,
  UsernameClaimChallenge,
} from "../db/schema.js";
import { apiError } from "./errors.js";
import { normalizeWalletAddress, verifyWalletSignature } from "./wallet.js";
import { buildUsernameClaimMessage } from "./username-message.js";
import { validateUsername } from "./username.rules.js";

export type {
  ChainType,
  FillxUser,
  UserWallet,
  UsernameClaimChallenge,
} from "../db/schema.js";

export type UsernameServiceRepos = {
  users: {
    findById: (id: string) => Promise<FillxUser | undefined>;
    findByUsername: (username: string) => Promise<FillxUser | undefined>;
    createClaimedUser: (username: string) => Promise<FillxUser>;
    markUsernameClaimed: (input: {
      userId: string;
      username: string;
    }) => Promise<FillxUser>;
  };
  wallets: {
    findByWallet: (input: {
      chainType: ChainType;
      walletAddress: string;
    }) => Promise<UserWallet | undefined>;
    findPrimaryByUserId: (userId: string) => Promise<UserWallet | undefined>;
    createPrimaryWallet: (input: {
      userId: string;
      chainType: ChainType;
      walletAddress: string;
    }) => Promise<UserWallet>;
  };
  usernameClaims: {
    createChallenge: (input: {
      userId: string | null;
      username: string;
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
      nonce: string;
      message: string;
      expiresAt: Date;
    }) => Promise<UsernameClaimChallenge>;
    findChallengeById: (
      id: string,
    ) => Promise<UsernameClaimChallenge | undefined>;
    findChallengeByIdForUpdate: (
      id: string,
    ) => Promise<UsernameClaimChallenge | undefined>;
    consumeChallengeIfUnused: (
      id: string,
    ) => Promise<UsernameClaimChallenge | undefined>;
    insertClaimAudit: (input: {
      userId: string;
      username: string;
      walletAddress: string;
      chainType: ChainType;
      signature: string;
      messageHash: string;
      status: "accepted" | "rejected" | "expired";
    }) => Promise<unknown>;
  };
  runTransaction: <T>(fn: (repos: UsernameServiceRepos) => Promise<T>) => Promise<T>;
};

export function createUsernameService(
  repos: UsernameServiceRepos,
  options: {
    now?: () => Date;
    nonce?: () => string;
    verifySignature?: typeof verifyWalletSignature;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => crypto.randomUUID().replaceAll("-", ""));
  const verifySignature = options.verifySignature ?? verifyWalletSignature;

  function hashMessage(message: string): string {
    return `0x${createHash("sha256").update(message).digest("hex")}`;
  }

  async function ensureAvailable(username: string): Promise<void> {
    const existing = await repos.users.findByUsername(username);
    if (existing) {
      throw apiError(
        "USERNAME_TAKEN",
        "That username was just claimed. Please choose another one.",
      );
    }
  }

  return {
    async checkAvailable(input: string): Promise<{
      available: boolean;
      normalizedUsername: string;
      error?: string;
    }> {
      const normalizedUsername = input.trim().toLowerCase();
      const validation = validateUsername(input);
      if (!validation.ok) {
        return {
          available: false,
          normalizedUsername,
          error: validation.code,
        };
      }
      const existing = await repos.users.findByUsername(validation.username);
      if (existing) {
        return {
          available: false,
          normalizedUsername: validation.username,
          error: "USERNAME_TAKEN",
        };
      }
      return {
        available: !existing,
        normalizedUsername: validation.username,
      };
    },

    async requestClaimChallenge(input: {
      authenticatedUserId: string | null;
      username: string;
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
    }): Promise<{ challengeId: string; expiresAt: string; message: string }> {
      const authenticatedUser = input.authenticatedUserId
        ? await repos.users.findById(input.authenticatedUserId)
        : undefined;
      if (input.authenticatedUserId && !authenticatedUser) {
        throw apiError("USER_NOT_FOUND");
      }
      if (authenticatedUser?.username_status === "claimed") {
        throw apiError("USERNAME_ALREADY_CLAIMED");
      }

      const validation = validateUsername(input.username);
      if (!validation.ok) throw apiError(validation.code, validation.reason);
      await ensureAvailable(validation.username);

      const walletAddress = normalizeWalletAddress(
        input.chainType,
        input.walletAddress,
      );
      if (authenticatedUser) {
        const primaryWallet = await repos.wallets.findPrimaryByUserId(
          authenticatedUser.id,
        );
        if (
          primaryWallet &&
          (primaryWallet.wallet_address !== walletAddress ||
            primaryWallet.chain_type !== input.chainType)
        ) {
          throw apiError(
            "PRIMARY_WALLET_ALREADY_SET",
            "This profile is already controlled by another wallet.",
          );
        }
      }

      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + 10 * 60 * 1000);
      const challengeNonce = nonce();
      const message = buildUsernameClaimMessage({
        domain: "fillx.io",
        walletAddress,
        action: "claim_username",
        username: validation.username,
        uri: "https://fillx.io",
        version: "1",
        chainType: input.chainType,
        chainId: input.chainId,
        nonce: challengeNonce,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });

      const challenge = await repos.usernameClaims.createChallenge({
        userId: authenticatedUser?.id ?? null,
        username: validation.username,
        walletAddress,
        chainType: input.chainType,
        chainId: input.chainId,
        nonce: challengeNonce,
        message,
        expiresAt,
      });

      return {
        challengeId: challenge.id,
        expiresAt: expiresAt.toISOString(),
        message,
      };
    },

    async claimUsername(input: {
      challengeId: string;
      signature: string;
    }): Promise<FillxUser> {
      return repos.runTransaction(async (txRepos) => {
        const challenge = await txRepos.usernameClaims.findChallengeByIdForUpdate(
          input.challengeId,
        );
        if (!challenge) throw apiError("CHALLENGE_NOT_FOUND");
        if (challenge.consumed_at) throw apiError("CHALLENGE_ALREADY_USED");
        if (new Date(challenge.expires_at).getTime() <= now().getTime()) {
          throw apiError("CHALLENGE_EXPIRED");
        }

        const isValid = await verifySignature({
          chainType: challenge.chain_type,
          walletAddress: challenge.wallet_address,
          message: challenge.message,
          signature: input.signature,
        });
        if (!isValid) throw apiError("SIGNATURE_INVALID");

        const existingWallet = await txRepos.wallets.findByWallet({
          chainType: challenge.chain_type,
          walletAddress: challenge.wallet_address,
        });
        let user = existingWallet
          ? await txRepos.users.findById(existingWallet.user_id)
          : undefined;
        if (!user && challenge.user_id) {
          user = await txRepos.users.findById(challenge.user_id);
        }

        if (user?.username_status === "claimed") {
          throw apiError("USERNAME_ALREADY_CLAIMED");
        }

        const existingUsername = await txRepos.users.findByUsername(
          challenge.username,
        );
        if (existingUsername) throw apiError("USERNAME_TAKEN");

        let updated: FillxUser;
        if (user) {
          const primaryWallet = await txRepos.wallets.findPrimaryByUserId(user.id);
          if (
            primaryWallet &&
            (primaryWallet.wallet_address !== challenge.wallet_address ||
              primaryWallet.chain_type !== challenge.chain_type)
          ) {
            throw apiError("PRIMARY_WALLET_ALREADY_SET");
          }
          if (!primaryWallet) {
            await txRepos.wallets.createPrimaryWallet({
              userId: user.id,
              chainType: challenge.chain_type,
              walletAddress: challenge.wallet_address,
            });
          }

          updated = await txRepos.users.markUsernameClaimed({
            userId: user.id,
            username: challenge.username,
          });
        } else {
          updated = await txRepos.users.createClaimedUser(challenge.username);
          await txRepos.wallets.createPrimaryWallet({
            userId: updated.id,
            chainType: challenge.chain_type,
            walletAddress: challenge.wallet_address,
          });
        }

        const consumed = await txRepos.usernameClaims.consumeChallengeIfUnused(
          challenge.id,
        );
        if (!consumed) throw apiError("CHALLENGE_ALREADY_USED");

        await txRepos.usernameClaims.insertClaimAudit({
          userId: updated.id,
          username: challenge.username,
          walletAddress: challenge.wallet_address,
          chainType: challenge.chain_type,
          signature: input.signature,
          messageHash: hashMessage(challenge.message),
          status: "accepted",
        });

        return updated;
      });
    },
  };
}
