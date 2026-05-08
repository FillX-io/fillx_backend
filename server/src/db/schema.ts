import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type UsernameStatus = "generated" | "claimed";
export type ChainType = "evm" | "solana";
export type ClaimStatus = "accepted" | "rejected" | "expired";
export type AuthProvider = "privy";
export type AvatarUploadStatus =
  | "pending"
  | "finalized"
  | "failed"
  | "expired";

export const ipConnectionLog = pgTable(
  "ip_connection_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: text("ip").notNull(),
    wallet: text("wallet").notNull(),
    city: text("city"),
    country: text("country"),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ipIdx: index("ip_connection_log_ip_idx").on(table.ip),
    walletIdx: index("ip_connection_log_wallet_idx").on(table.wallet),
    connectedAtIdx: index("ip_connection_log_connected_at_idx").on(
      table.connectedAt,
    ),
  }),
);

export type IpConnectionLog = typeof ipConnectionLog.$inferSelect;
export type NewIpConnectionLog = typeof ipConnectionLog.$inferInsert;

export const fillxUsers = pgTable(
  "fillx_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    username_status: text("username_status")
      .$type<UsernameStatus>()
      .notNull(),
    display_name: text("display_name"),
    avatar_key: text("avatar_key"),
    avatar_updated_at: timestamp("avatar_updated_at", { withTimezone: true }),
    nationality: text("nationality"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    usernameUnique: unique("fillx_users_username_unique").on(table.username),
    usernameStatusIdx: index("fillx_users_username_status_idx").on(
      table.username_status,
    ),
    usernameLowercaseCheck: check(
      "fillx_users_username_lowercase",
      sql`${table.username} = lower(${table.username})`,
    ),
    usernameStatusCheck: check(
      "fillx_users_username_status_check",
      sql`${table.username_status} in ('generated', 'claimed')`,
    ),
    displayNameCheck: check(
      "fillx_users_display_name_check",
      sql`${table.display_name} is null or char_length(${table.display_name}) <= 50`,
    ),
    nationalityCheck: check(
      "fillx_users_nationality_check",
      sql`${table.nationality} is null or ${table.nationality} ~ '^[A-Z]{2}$'`,
    ),
  }),
);

export const fillxAvatarUploads = pgTable(
  "fillx_avatar_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => fillxUsers.id, { onDelete: "cascade" }),
    incoming_bucket: text("incoming_bucket").notNull(),
    incoming_key: text("incoming_key").notNull(),
    source_content_type: text("source_content_type").notNull(),
    source_content_length: integer("source_content_length").notNull(),
    status: text("status").$type<AvatarUploadStatus>().notNull(),
    public_bucket: text("public_bucket"),
    public_key: text("public_key"),
    error_code: text("error_code"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    finalized_at: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => ({
    userStatusIdx: index("fillx_avatar_uploads_user_status_idx").on(
      table.user_id,
      table.status,
    ),
    expiryIdx: index("fillx_avatar_uploads_expiry_idx").on(table.expires_at),
    statusCheck: check(
      "fillx_avatar_uploads_status_check",
      sql`${table.status} in ('pending', 'finalized', 'failed', 'expired')`,
    ),
    sourceContentLengthCheck: check(
      "fillx_avatar_uploads_source_length_check",
      sql`${table.source_content_length} > 0`,
    ),
  }),
);

export type FillxAvatarUpload = typeof fillxAvatarUploads.$inferSelect;
export type NewFillxAvatarUpload = typeof fillxAvatarUploads.$inferInsert;

export const userWallets = pgTable(
  "user_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => fillxUsers.id, { onDelete: "cascade" }),
    chain_type: text("chain_type").$type<ChainType>().notNull(),
    wallet_address: text("wallet_address").notNull(),
    is_primary: boolean("is_primary").notNull().default(false),
    verified_at: timestamp("verified_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chainWalletUnique: unique("user_wallets_chain_wallet_unique").on(
      table.chain_type,
      table.wallet_address,
    ),
    onePrimaryPerUser: uniqueIndex("user_wallets_one_primary_per_user")
      .on(table.user_id)
      .where(sql`${table.is_primary} = true`),
    chainTypeCheck: check(
      "user_wallets_chain_type_check",
      sql`${table.chain_type} in ('evm', 'solana')`,
    ),
  }),
);

export const userAuthIdentities = pgTable(
  "user_auth_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => fillxUsers.id, { onDelete: "cascade" }),
    provider: text("provider").$type<AuthProvider>().notNull(),
    provider_user_id: text("provider_user_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    providerUserUnique: unique(
      "user_auth_identities_provider_user_unique",
    ).on(table.provider, table.provider_user_id),
    providerCheck: check(
      "user_auth_identities_provider_check",
      sql`${table.provider} in ('privy')`,
    ),
  }),
);

export const userOrderlyAccounts = pgTable(
  "user_orderly_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => fillxUsers.id, { onDelete: "cascade" }),
    orderly_account_id: text("orderly_account_id").notNull(),
    orderly_address: text("orderly_address").notNull(),
    broker_id: text("broker_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    accountUnique: unique("user_orderly_accounts_account_unique").on(
      table.orderly_account_id,
    ),
    orderlyAddressIdx: index("user_orderly_accounts_orderly_address_idx").on(
      table.orderly_address,
    ),
    userIdIdx: index("user_orderly_accounts_user_id_idx").on(table.user_id),
  }),
);

export const usernameClaimChallenges = pgTable(
  "username_claim_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").references(() => fillxUsers.id, {
      onDelete: "cascade",
    }),
    username: text("username").notNull(),
    wallet_address: text("wallet_address").notNull(),
    chain_type: text("chain_type").$type<ChainType>().notNull(),
    chain_id: integer("chain_id"),
    nonce: text("nonce").notNull(),
    message: text("message").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed_at: timestamp("consumed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nonceUnique: unique("username_claim_challenges_nonce_unique").on(
      table.nonce,
    ),
    userCreatedIdx: index("username_claim_challenges_user_created_idx").on(
      table.user_id,
      table.created_at.desc(),
    ),
    chainTypeCheck: check(
      "username_claim_challenges_chain_type_check",
      sql`${table.chain_type} in ('evm', 'solana')`,
    ),
  }),
);

export const fillxSessionFamilies = pgTable(
  "fillx_session_families",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token_hash: text("token_hash").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    absolute_expires_at: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    revoke_reason: text("revoke_reason"),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("fillx_session_families_token_hash_idx").on(
      table.token_hash,
    ),
    expiryIdx: index("fillx_session_families_expiry_idx").on(
      table.absolute_expires_at,
    ),
  }),
);

export const fillxWalletSessions = pgTable(
  "fillx_wallet_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    family_id: uuid("family_id")
      .notNull()
      .references(() => fillxSessionFamilies.id, { onDelete: "cascade" }),
    wallet_key: text("wallet_key").notNull(),
    wallet_address: text("wallet_address").notNull(),
    wallet_namespace: text("wallet_namespace").$type<ChainType>().notNull(),
    signature_scheme: text("signature_scheme").notNull(),
    last_signed_chain: text("last_signed_chain"),
    signed_at: timestamp("signed_at", { withTimezone: true }).notNull(),
    profile_user_id: uuid("profile_user_id")
      .notNull()
      .references(() => fillxUsers.id, { onDelete: "cascade" }),
    last_used_at: timestamp("last_used_at", { withTimezone: true }).notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    revoke_reason: text("revoke_reason"),
  },
  (table) => ({
    activeUnique: uniqueIndex("fillx_wallet_sessions_active_unique_idx")
      .on(table.family_id, table.wallet_key)
      .where(sql`${table.revoked_at} is null`),
    lookupIdx: index("fillx_wallet_sessions_lookup_idx").on(
      table.family_id,
      table.wallet_key,
      table.expires_at,
    ),
    expiryIdx: index("fillx_wallet_sessions_expiry_idx").on(table.expires_at),
    walletNamespaceCheck: check(
      "fillx_wallet_sessions_wallet_namespace_check",
      sql`${table.wallet_namespace} in ('evm', 'solana')`,
    ),
  }),
);

export const walletSignInChallenges = pgTable(
  "wallet_sign_in_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wallet_key: text("wallet_key").notNull(),
    wallet_address: text("wallet_address").notNull(),
    chain_type: text("chain_type").$type<ChainType>().notNull(),
    chain_id: integer("chain_id"),
    nonce: text("nonce").notNull(),
    message: text("message").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed_at: timestamp("consumed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nonceUnique: unique("wallet_sign_in_challenges_nonce_unique").on(
      table.nonce,
    ),
    walletCreatedIdx: index("wallet_sign_in_challenges_wallet_created_idx").on(
      table.wallet_key,
      table.created_at.desc(),
    ),
    chainTypeCheck: check(
      "wallet_sign_in_challenges_chain_type_check",
      sql`${table.chain_type} in ('evm', 'solana')`,
    ),
  }),
);

export const usernameClaims = pgTable(
  "username_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => fillxUsers.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    wallet_address: text("wallet_address").notNull(),
    chain_type: text("chain_type").$type<ChainType>().notNull(),
    signature: text("signature").notNull(),
    message_hash: text("message_hash").notNull(),
    status: text("status").$type<ClaimStatus>().notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("username_claims_user_created_idx").on(
      table.user_id,
      table.created_at.desc(),
    ),
    usernameIdx: index("username_claims_username_idx").on(table.username),
    chainTypeCheck: check(
      "username_claims_chain_type_check",
      sql`${table.chain_type} in ('evm', 'solana')`,
    ),
    statusCheck: check(
      "username_claims_status_check",
      sql`${table.status} in ('accepted', 'rejected', 'expired')`,
    ),
  }),
);

export type FillxUser = typeof fillxUsers.$inferSelect;
export type NewFillxUser = typeof fillxUsers.$inferInsert;
export type UserWallet = typeof userWallets.$inferSelect;
export type UserAuthIdentity = typeof userAuthIdentities.$inferSelect;
export type UserOrderlyAccount = typeof userOrderlyAccounts.$inferSelect;
export type FillxSessionFamily = typeof fillxSessionFamilies.$inferSelect;
export type FillxWalletSession = typeof fillxWalletSessions.$inferSelect;
export type WalletSignInChallenge =
  typeof walletSignInChallenges.$inferSelect;
export type UsernameClaimChallenge =
  typeof usernameClaimChallenges.$inferSelect;
export type UsernameClaim = typeof usernameClaims.$inferSelect;
