import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  fillxUsers,
  userAuthIdentities,
  userOrderlyAccounts,
  userWallets,
  usernameClaimChallenges,
  usernameClaims,
  type ChainType,
  type ClaimStatus,
  type FillxUser,
  type UserAuthIdentity,
  type UserOrderlyAccount,
  type UserWallet,
  type UsernameClaim,
  type UsernameClaimChallenge,
  type UsernameStatus,
} from "../db/schema.js";

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

    async findByUsername(username: string): Promise<FillxUser | undefined> {
      return first(
        await db
          .select()
          .from(fillxUsers)
          .where(eq(fillxUsers.username, username))
          .limit(1),
      );
    },

    async createGeneratedUser(username: string): Promise<FillxUser> {
      return firstOrThrow(
        await db
          .insert(fillxUsers)
          .values({
            username,
            username_status: "generated" as UsernameStatus,
          })
          .returning(),
      );
    },

    async createClaimedUser(username: string): Promise<FillxUser> {
      return firstOrThrow(
        await db
          .insert(fillxUsers)
          .values({ username, username_status: "claimed" as UsernameStatus })
          .returning(),
      );
    },

    async markUsernameClaimed(input: {
      userId: string;
      username: string;
    }): Promise<FillxUser> {
      return firstOrThrow(
        await db
          .update(fillxUsers)
          .set({
            username: input.username,
            username_status: "claimed",
            updated_at: new Date(),
          })
          .where(
            and(
              eq(fillxUsers.id, input.userId),
              eq(fillxUsers.username_status, "generated"),
            ),
          )
          .returning(),
      );
    },

    async updateDisplayName(input: {
      userId: string;
      displayName: string;
    }): Promise<FillxUser> {
      return firstOrThrow(
        await db
          .update(fillxUsers)
          .set({
            display_name: input.displayName,
            updated_at: new Date(),
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

export function createUsernameClaimsRepo(db: DbLike) {
  return {
    async createChallenge(input: {
      userId: string | null;
      username: string;
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
      nonce: string;
      message: string;
      expiresAt: Date;
    }): Promise<UsernameClaimChallenge> {
      return firstOrThrow(
        await db
          .insert(usernameClaimChallenges)
          .values({
            user_id: input.userId,
            username: input.username,
            wallet_address: input.walletAddress,
            chain_type: input.chainType,
            chain_id: input.chainId,
            nonce: input.nonce,
            message: input.message,
            expires_at: input.expiresAt,
          })
          .returning(),
      );
    },

    async findChallengeByIdForUpdate(
      id: string,
    ): Promise<UsernameClaimChallenge | undefined> {
      return first(
        await db
          .select()
          .from(usernameClaimChallenges)
          .where(eq(usernameClaimChallenges.id, id))
          .limit(1)
          .for("update"),
      );
    },

    async findChallengeById(
      id: string,
    ): Promise<UsernameClaimChallenge | undefined> {
      return first(
        await db
          .select()
          .from(usernameClaimChallenges)
          .where(eq(usernameClaimChallenges.id, id))
          .limit(1),
      );
    },

    async consumeChallengeIfUnused(
      id: string,
    ): Promise<UsernameClaimChallenge | undefined> {
      return first(
        await db
          .update(usernameClaimChallenges)
          .set({ consumed_at: new Date() })
          .where(
            and(
              eq(usernameClaimChallenges.id, id),
              isNull(usernameClaimChallenges.consumed_at),
            ),
          )
          .returning(),
      );
    },

    async insertClaimAudit(input: {
      userId: string;
      username: string;
      walletAddress: string;
      chainType: ChainType;
      signature: string;
      messageHash: string;
      status: ClaimStatus;
    }): Promise<UsernameClaim> {
      return firstOrThrow(
        await db
          .insert(usernameClaims)
          .values({
            user_id: input.userId,
            username: input.username,
            wallet_address: input.walletAddress,
            chain_type: input.chainType,
            signature: input.signature,
            message_hash: input.messageHash,
            status: input.status,
          })
          .returning(),
      );
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
    username: string;
    usernameStatus: UsernameStatus;
    displayName: string | null;
    avatarUrl: string | null;
  }>
> {
  if (walletAddresses.length === 0) return [];
  const rows = await db
    .select({
      walletAddress: userWallets.wallet_address,
      userId: fillxUsers.id,
      username: fillxUsers.username,
      usernameStatus: fillxUsers.username_status,
      displayName: fillxUsers.display_name,
      avatarUrl: fillxUsers.avatar_url,
    })
    .from(userWallets)
    .innerJoin(fillxUsers, eq(fillxUsers.id, userWallets.user_id))
    .where(
      and(
        inArray(userWallets.wallet_address, walletAddresses),
        eq(userWallets.is_primary, true),
      ),
    );

  return rows;
}

export function createIdentityRepos(db: DbLike) {
  return {
    users: createUsersRepo(db),
    wallets: createWalletsRepo(db),
    authIdentities: createAuthIdentitiesRepo(db),
    usernameClaims: createUsernameClaimsRepo(db),
    orderlyAccounts: createOrderlyAccountsRepo(db),
  };
}
