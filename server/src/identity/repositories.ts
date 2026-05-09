import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import {
  fillxAvatarUploads,
  fillxSessionFamilies,
  fillxUsers,
  fillxWalletSessions,
  userAuthIdentities,
  userOrderlyAccounts,
  userWallets,
  walletSignInChallenges,
  type ChainType,
  type FillxAvatarUpload,
  type FillxSessionFamily,
  type FillxUser,
  type FillxWalletSession,
  type UserAuthIdentity,
  type UserOrderlyAccount,
  type UserWallet,
  type WalletSignInChallenge,
} from "../db/schema.js";
import { serializeAvatarUrl } from "./profile-serialization.js";

type DbLike = Pick<Db, "select" | "insert" | "update">;

async function first<T>(rows: T[]): Promise<T | undefined> {
  return rows[0];
}

async function firstOrThrow<T>(rows: T[]): Promise<T> {
  const row = rows[0];
  if (!row) throw new Error("DATABASE_RETURNING_EMPTY");
  return row;
}

export function createUsersRepo(db: DbLike) {
  return {
    async findById(id: string): Promise<FillxUser | undefined> {
      return first(
        await db.select().from(fillxUsers).where(eq(fillxUsers.id, id)).limit(1),
      );
    },

    async createUser(): Promise<FillxUser> {
      return firstOrThrow(await db.insert(fillxUsers).values({}).returning());
    },

    async updateProfile(input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
    }): Promise<FillxUser> {
      const values: {
        display_name?: string | null;
        nationality?: string | null;
        updated_at: Date;
      } = {
        updated_at: new Date(),
      };

      if (input.displayName !== undefined) {
        values.display_name = input.displayName;
      }
      if (input.nationality !== undefined) {
        values.nationality = input.nationality;
      }

      return firstOrThrow(
        await db
          .update(fillxUsers)
          .set(values)
          .where(eq(fillxUsers.id, input.userId))
          .returning(),
      );
    },

    async updateAvatar(input: {
      userId: string;
      avatarKey: string | null;
      avatarUpdatedAt: Date | null;
      now?: Date;
    }): Promise<FillxUser> {
      const now = input.now === undefined ? new Date() : input.now;
      return firstOrThrow(
        await db
          .update(fillxUsers)
          .set({
            avatar_key: input.avatarKey,
            avatar_updated_at: input.avatarUpdatedAt,
            updated_at: now,
          })
          .where(eq(fillxUsers.id, input.userId))
          .returning(),
      );
    },
  };
}

export function createWalletsRepo(db: DbLike) {
  return {
    async findByWallet(input: {
      chainType: ChainType;
      walletAddress: string;
    }): Promise<UserWallet | undefined> {
      return first(
        await db
          .select()
          .from(userWallets)
          .where(
            and(
              eq(userWallets.chain_type, input.chainType),
              eq(userWallets.wallet_address, input.walletAddress),
            ),
          )
          .limit(1),
      );
    },

    async findPrimaryByUserId(userId: string): Promise<UserWallet | undefined> {
      return first(
        await db
          .select()
          .from(userWallets)
          .where(
            and(eq(userWallets.user_id, userId), eq(userWallets.is_primary, true)),
          )
          .limit(1),
      );
    },

    async createPrimaryWallet(input: {
      userId: string;
      chainType: ChainType;
      walletAddress: string;
    }): Promise<UserWallet> {
      return firstOrThrow(
        await db
          .insert(userWallets)
          .values({
            user_id: input.userId,
            chain_type: input.chainType,
            wallet_address: input.walletAddress,
            is_primary: true,
            verified_at: new Date(),
          })
          .onConflictDoNothing({
            target: [userWallets.chain_type, userWallets.wallet_address],
          })
          .returning(),
      );
    },
  };
}

export function createAuthIdentitiesRepo(db: DbLike) {
  return {
    async findByProviderUserId(input: {
      provider: "privy";
      providerUserId: string;
    }): Promise<UserAuthIdentity | undefined> {
      return first(
        await db
          .select()
          .from(userAuthIdentities)
          .where(
            and(
              eq(userAuthIdentities.provider, input.provider),
              eq(userAuthIdentities.provider_user_id, input.providerUserId),
            ),
          )
          .limit(1),
      );
    },

    async linkPrivyIdentity(input: {
      userId: string;
      privyUserId: string;
    }): Promise<UserAuthIdentity> {
      return firstOrThrow(
        await db
          .insert(userAuthIdentities)
          .values({
            user_id: input.userId,
            provider: "privy",
            provider_user_id: input.privyUserId,
          })
          .onConflictDoUpdate({
            target: [
              userAuthIdentities.provider,
              userAuthIdentities.provider_user_id,
            ],
            set: { user_id: input.userId },
          })
          .returning(),
      );
    },
  };
}

export function createOrderlyAccountsRepo(db: DbLike) {
  return {
    async upsertOrderlyAccount(input: {
      userId: string;
      orderlyAccountId: string;
      orderlyAddress: string;
      brokerId: string | null;
    }): Promise<UserOrderlyAccount> {
      return firstOrThrow(
        await db
          .insert(userOrderlyAccounts)
          .values({
            user_id: input.userId,
            orderly_account_id: input.orderlyAccountId,
            orderly_address: input.orderlyAddress,
            broker_id: input.brokerId,
          })
          .onConflictDoUpdate({
            target: userOrderlyAccounts.orderly_account_id,
            set: {
              user_id: input.userId,
              orderly_address: input.orderlyAddress,
              broker_id: input.brokerId,
            },
          })
          .returning(),
      );
    },
  };
}

export function createSessionFamiliesRepo(db: DbLike) {
  return {
    async findActiveByTokenHash(input: {
      tokenHash: string;
      now: Date;
    }): Promise<FillxSessionFamily | undefined> {
      return first(
        await db
          .select()
          .from(fillxSessionFamilies)
          .where(
            and(
              eq(fillxSessionFamilies.token_hash, input.tokenHash),
              isNull(fillxSessionFamilies.revoked_at),
              gt(fillxSessionFamilies.absolute_expires_at, input.now),
            ),
          )
          .limit(1),
      );
    },

    async create(input: {
      tokenHash: string;
      expiresAt: Date;
      now: Date;
    }): Promise<FillxSessionFamily> {
      return firstOrThrow(
        await db
          .insert(fillxSessionFamilies)
          .values({
            token_hash: input.tokenHash,
            created_at: input.now,
            last_seen_at: input.now,
            absolute_expires_at: input.expiresAt,
          })
          .returning(),
      );
    },

    async rotateToken(input: {
      familyId: string;
      tokenHash: string;
      expiresAt: Date;
      now: Date;
    }): Promise<FillxSessionFamily> {
      return firstOrThrow(
        await db
          .update(fillxSessionFamilies)
          .set({
            token_hash: input.tokenHash,
            last_seen_at: input.now,
            absolute_expires_at: input.expiresAt,
          })
          .where(eq(fillxSessionFamilies.id, input.familyId))
          .returning(),
      );
    },

    async touch(input: {
      familyId: string;
      now: Date;
    }): Promise<FillxSessionFamily> {
      return firstOrThrow(
        await db
          .update(fillxSessionFamilies)
          .set({ last_seen_at: input.now })
          .where(eq(fillxSessionFamilies.id, input.familyId))
          .returning(),
      );
    },

    async revoke(input: {
      familyId: string;
      now: Date;
      reason: string;
    }): Promise<void> {
      await db
        .update(fillxSessionFamilies)
        .set({
          revoked_at: input.now,
          revoke_reason: input.reason,
        })
        .where(eq(fillxSessionFamilies.id, input.familyId));
    },
  };
}

export function createWalletSessionsRepo(db: DbLike) {
  async function findUnrevoked(input: {
    familyId: string;
    walletKey: string;
  }): Promise<FillxWalletSession | undefined> {
    return first(
      await db
        .select()
        .from(fillxWalletSessions)
        .where(
          and(
            eq(fillxWalletSessions.family_id, input.familyId),
            eq(fillxWalletSessions.wallet_key, input.walletKey),
            isNull(fillxWalletSessions.revoked_at),
          ),
        )
        .limit(1),
    );
  }

  async function findActive(input: {
    familyId: string;
    walletKey: string;
    now: Date;
  }): Promise<FillxWalletSession | undefined> {
    return first(
      await db
        .select()
        .from(fillxWalletSessions)
        .where(
          and(
            eq(fillxWalletSessions.family_id, input.familyId),
            eq(fillxWalletSessions.wallet_key, input.walletKey),
            isNull(fillxWalletSessions.revoked_at),
            gt(fillxWalletSessions.expires_at, input.now),
          ),
        )
        .limit(1),
    );
  }

  return {
    findActive,

    async upsert(input: {
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
    }): Promise<FillxWalletSession> {
      const existing = await findUnrevoked({
        familyId: input.familyId,
        walletKey: input.walletKey,
      });
      if (existing) {
        return firstOrThrow(
          await db
            .update(fillxWalletSessions)
            .set({
              wallet_address: input.walletAddress,
              wallet_namespace: input.walletNamespace,
              signature_scheme: input.signatureScheme,
              last_signed_chain: input.lastSignedChain,
              signed_at: input.signedAt,
              profile_user_id: input.profileUserId,
              last_used_at: input.now,
              expires_at: input.expiresAt,
            })
            .where(eq(fillxWalletSessions.id, existing.id))
            .returning(),
        );
      }

      return firstOrThrow(
        await db
          .insert(fillxWalletSessions)
          .values({
            family_id: input.familyId,
            wallet_key: input.walletKey,
            wallet_address: input.walletAddress,
            wallet_namespace: input.walletNamespace,
            signature_scheme: input.signatureScheme,
            last_signed_chain: input.lastSignedChain,
            signed_at: input.signedAt,
            profile_user_id: input.profileUserId,
            last_used_at: input.now,
            expires_at: input.expiresAt,
          })
          .returning(),
      );
    },

    async touch(input: {
      walletSessionId: string;
      now: Date;
    }): Promise<void> {
      await db
        .update(fillxWalletSessions)
        .set({ last_used_at: input.now })
        .where(eq(fillxWalletSessions.id, input.walletSessionId));
    },

    async revokeByFamily(input: {
      familyId: string;
      now: Date;
      reason: string;
    }): Promise<void> {
      await db
        .update(fillxWalletSessions)
        .set({
          revoked_at: input.now,
          revoke_reason: input.reason,
        })
        .where(
          and(
            eq(fillxWalletSessions.family_id, input.familyId),
            isNull(fillxWalletSessions.revoked_at),
          ),
        );
    },
  };
}

export function createWalletSignInChallengesRepo(db: DbLike) {
  return {
    async create(input: {
      walletKey: string;
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
      nonce: string;
      message: string;
      expiresAt: Date;
      now: Date;
    }): Promise<WalletSignInChallenge> {
      return firstOrThrow(
        await db
          .insert(walletSignInChallenges)
          .values({
            wallet_key: input.walletKey,
            wallet_address: input.walletAddress,
            chain_type: input.chainType,
            chain_id: input.chainId,
            nonce: input.nonce,
            message: input.message,
            expires_at: input.expiresAt,
            created_at: input.now,
          })
          .returning(),
      );
    },

    async findByIdForUpdate(
      id: string,
    ): Promise<WalletSignInChallenge | undefined> {
      return first(
        await db
          .select()
          .from(walletSignInChallenges)
          .where(eq(walletSignInChallenges.id, id))
          .limit(1)
          .for("update"),
      );
    },

    async consumeIfUnused(
      id: string,
    ): Promise<WalletSignInChallenge | undefined> {
      return first(
        await db
          .update(walletSignInChallenges)
          .set({ consumed_at: new Date() })
          .where(
            and(
              eq(walletSignInChallenges.id, id),
              isNull(walletSignInChallenges.consumed_at),
            ),
          )
          .returning(),
      );
    },
  };
}

export function createAvatarUploadsRepo(db: DbLike) {
  return {
    async createPending(input: {
      uploadId: string;
      userId: string;
      incomingBucket: string;
      incomingKey: string;
      sourceContentType: string;
      sourceContentLength: number;
      now: Date;
      expiresAt: Date;
    }): Promise<FillxAvatarUpload> {
      return firstOrThrow(
        await db
          .insert(fillxAvatarUploads)
          .values({
            id: input.uploadId,
            user_id: input.userId,
            incoming_bucket: input.incomingBucket,
            incoming_key: input.incomingKey,
            source_content_type: input.sourceContentType,
            source_content_length: input.sourceContentLength,
            status: "pending",
            created_at: input.now,
            expires_at: input.expiresAt,
          })
          .returning(),
      );
    },

    async findByIdForUpdate(
      uploadId: string,
    ): Promise<FillxAvatarUpload | undefined> {
      return first(
        await db
          .select()
          .from(fillxAvatarUploads)
          .where(eq(fillxAvatarUploads.id, uploadId))
          .limit(1)
          .for("update"),
      );
    },

    async markFinalized(input: {
      uploadId: string;
      publicBucket: string;
      publicKey: string;
      now: Date;
    }): Promise<FillxAvatarUpload | undefined> {
      return first(
        await db
          .update(fillxAvatarUploads)
          .set({
            status: "finalized",
            public_bucket: input.publicBucket,
            public_key: input.publicKey,
            finalized_at: input.now,
          })
          .where(
            and(
              eq(fillxAvatarUploads.id, input.uploadId),
              eq(fillxAvatarUploads.status, "pending"),
            ),
          )
          .returning(),
      );
    },

    async markFailed(input: {
      uploadId: string;
      errorCode: string;
    }): Promise<boolean> {
      const updated = await db
        .update(fillxAvatarUploads)
        .set({
          status: "failed",
          error_code: input.errorCode,
        })
        .where(
          and(
            eq(fillxAvatarUploads.id, input.uploadId),
            eq(fillxAvatarUploads.status, "pending"),
          ),
        )
        .returning({ id: fillxAvatarUploads.id });
      return updated.length > 0;
    },

    async markExpired(input: { uploadId: string }): Promise<boolean> {
      const updated = await db
        .update(fillxAvatarUploads)
        .set({ status: "expired" })
        .where(
          and(
            eq(fillxAvatarUploads.id, input.uploadId),
            eq(fillxAvatarUploads.status, "pending"),
          ),
        )
        .returning({ id: fillxAvatarUploads.id });
      return updated.length > 0;
    },
  };
}

export async function getProfilesByWallets(
  db: DbLike,
  walletAddresses: string[],
): Promise<
  Array<{
    walletAddress: string;
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
    nationality: string | null;
    primaryWallet: {
      chainType: ChainType;
      walletAddress: string;
      walletKey: string;
    };
  }>
> {
  if (walletAddresses.length === 0) return [];
  const primaryWallets = alias(userWallets, "primary_wallets");
  const rows = await db
    .select({
      walletAddress: userWallets.wallet_address,
      userId: fillxUsers.id,
      displayName: fillxUsers.display_name,
      avatarKey: fillxUsers.avatar_key,
      nationality: fillxUsers.nationality,
      primaryChainType: primaryWallets.chain_type,
      primaryWalletAddress: primaryWallets.wallet_address,
    })
    .from(userWallets)
    .innerJoin(fillxUsers, eq(fillxUsers.id, userWallets.user_id))
    .innerJoin(
      primaryWallets,
      and(
        eq(primaryWallets.user_id, fillxUsers.id),
        eq(primaryWallets.is_primary, true),
      ),
    )
    .where(
      inArray(userWallets.wallet_address, walletAddresses),
    );

  return rows.map((row) => ({
    walletAddress: row.walletAddress,
    userId: row.userId,
    displayName: row.displayName,
    avatarUrl: serializeAvatarUrl({ avatar_key: row.avatarKey }),
    nationality: row.nationality,
    primaryWallet: {
      chainType: row.primaryChainType,
      walletAddress: row.primaryWalletAddress,
      walletKey: `${row.primaryChainType}:${row.primaryWalletAddress}`,
    },
  }));
}

export function createIdentityRepos(db: DbLike) {
  return {
    users: createUsersRepo(db),
    wallets: createWalletsRepo(db),
    authIdentities: createAuthIdentitiesRepo(db),
    sessionFamilies: createSessionFamiliesRepo(db),
    walletSessions: createWalletSessionsRepo(db),
    walletSignInChallenges: createWalletSignInChallengesRepo(db),
    avatarUploads: createAvatarUploadsRepo(db),
    orderlyAccounts: createOrderlyAccountsRepo(db),
  };
}
