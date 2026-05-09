# Remove Username Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove username as a product, API, and database concept so FillX identity uses display name plus primary wallet fallback only.

**Architecture:** The backend owns the destructive schema/API change: drop username tables/columns, remove the username router, and create users without generated handles. The frontend consumes the new contract and changes profile/leaderboard/account displays to `displayName || shortened wallet`, with wallet verification creating the profile when none exists.

**Tech Stack:** TypeScript, Node `node:test` through `tsx --test`, oRPC, Zod, Drizzle ORM/PostgreSQL, Remix/React, Orderly UI, lucide-react.

---

## Scope Check

This spans backend persistence, shared contract, backend routes, generated frontend contract, and frontend consumers. It stays as one coordinated plan because the shared API removal is a breaking change: backend and frontend must move together to keep typecheck and runtime behavior consistent.

The implementation can still use parallel agents after Task 3 because the main shared contract and schema shape will be known. Safe parallel slices are:

- Backend API/tests/docs after Task 1 pins the schema.
- Frontend profile/editor after Task 3 pins generated types.
- Frontend leaderboard/account sheet after Task 3 pins generated types.

## File Structure

Backend files:

- Modify `fillx_backend/server/src/db/schema.ts`: remove `UsernameStatus`, username columns/checks/indexes, `username_claim_challenges`, `username_claims`, and their exported types.
- Create `fillx_backend/server/src/db/migrations/0005_remove_fillx_user_username.sql`: destructive migration dropping username audit/challenge tables and user columns.
- Modify generated Drizzle metadata under `fillx_backend/server/src/db/migrations/meta/`: regenerate after schema change.
- Modify `fillx_backend/server/src/identity/repositories.ts`: remove username repo methods and username claim repo; `getProfilesByWallets()` returns no username fields.
- Modify `fillx_backend/server/src/identity/identity.service.ts`: remove generated username creation; add `createUser()` repo call.
- Modify `fillx_backend/server/src/identity/identity.service.test.ts`: fixtures and tests assert wallet/Privy user creation has no username behavior.
- Modify `fillx_backend/server/src/identity/wallet-session.service.ts`: public wallet profile state contains display metadata and primary wallet only.
- Modify `fillx_backend/server/src/identity/avatar.service.test.ts` and `fillx_backend/server/src/identity/wallet-session.service.test.ts`: remove username fields from `FillxUser` fixtures and expected public profile objects.
- Delete `fillx_backend/server/src/identity/username.service.ts`, `fillx_backend/server/src/identity/username.service.test.ts`, `fillx_backend/server/src/identity/username.rules.ts`, `fillx_backend/server/src/identity/username.rules.test.ts`, and `fillx_backend/server/src/identity/username-message.ts`.
- Modify `fillx_backend/shared/src/contract.ts`: remove `UsernameStatus`, username fields, and the root `username` router.
- Modify `fillx_backend/server/src/routes/identity.ts`: remove username service imports/helpers/routes and serializers return no username fields.
- Modify `fillx_backend/server/src/identity/errors.ts`: remove username-specific API error codes.
- Replace `fillx_backend/e2e/username.e2e.test.ts` with `fillx_backend/e2e/identity-profile.e2e.test.ts`: keep wallet-session/profile-read coverage without claim endpoints.
- Modify `fillx_backend/e2e/helpers/avatar.ts`: create a profile through wallet session/profile update rather than username claim.
- Modify `fillx_backend/CONTEXT.md` and `fillx_backend/docs/adr/0001-identity-proof-and-session-boundaries.md`: remove username ownership language and document wallet identity fallback.
- Modify `fillx_backend/docs/superpowers/specs/2026-05-09-remove-username-design.md` only if execution discovers the approved design needs a factual correction.

Frontend files:

- Regenerate `eolive/app/generated/fillx-backend-contract.ts` from `fillx_backend/shared/src/contract.ts`.
- Modify `eolive/app/api/identity.ts`: remove username fields from exported frontend profile types.
- Modify `eolive/app/components/profile/fillxPortfolioProfileModel.ts` and `.test.ts`: use `displayName || shortened wallet` and no `handle`.
- Modify `eolive/app/hooks/useFillxProfileEditor.ts`: stop passing username into the dialog; pass a display placeholder derived from primary wallet.
- Modify `eolive/app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx`: remove read-only Username field and use wallet fallback as display-name placeholder.
- Delete `eolive/app/components/profile/UsernameClaimModal.tsx`.
- Modify `eolive/app/components/profile/PublicProfileCard.tsx`: remove claim modal, title `displayName || shortened wallet`, and make the no-profile action verify/create profile through `openFillxProfileEditor()`.
- Modify `eolive/app/components/leaderboard/leaderboardIdentity.ts`, `.test.ts`, and `LeaderboardIdentityCell.tsx`: remove `usernameLabel`; secondary text becomes the wallet label only when the primary label is a display name.
- Modify `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheet.script.tsx` and `.ui.tsx`: remove `fillxUsername`; no-profile label becomes FillX profile creation/editing language, not claim language.

## Task 1: Backend Schema and Repositories

**Files:**
- Modify: `fillx_backend/server/src/db/schema.ts`
- Create: `fillx_backend/server/src/db/migrations/0005_remove_fillx_user_username.sql`
- Modify: `fillx_backend/server/src/db/migrations/meta/_journal.json`
- Create: `fillx_backend/server/src/db/migrations/meta/0005_snapshot.json`
- Modify: `fillx_backend/server/src/identity/repositories.ts`

- [ ] **Step 1: Write the failing schema/repository contract by editing TypeScript first**

In `fillx_backend/server/src/db/schema.ts`, replace the username-bearing `fillxUsers` definition with:

```ts
export type ChainType = "evm" | "solana";
export type AuthProvider = "privy";
export type AvatarUploadStatus =
  | "pending"
  | "finalized"
  | "failed"
  | "expired";

export const fillxUsers = pgTable(
  "fillx_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
```

Delete the entire `usernameClaimChallenges` and `usernameClaims` table definitions and delete these type exports:

```ts
export type ClaimStatus = "accepted" | "rejected" | "expired";
export type UsernameClaimChallenge =
  typeof usernameClaimChallenges.$inferSelect;
export type UsernameClaim = typeof usernameClaims.$inferSelect;
```

In `fillx_backend/server/src/identity/repositories.ts`, change imports so username tables and types are gone:

```ts
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
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
```

Replace the creation methods in `createUsersRepo()` with:

```ts
    async createUser(): Promise<FillxUser> {
      return firstOrThrow(await db.insert(fillxUsers).values({}).returning());
    },
```

Remove `findByUsername()`, `createGeneratedUser()`, `createClaimedUser()`, and `markUsernameClaimed()` from `createUsersRepo()`.

Delete the full `createUsernameClaimsRepo()` function.

Replace the `getProfilesByWallets()` return type and row mapping with:

```ts
): Promise<
  Array<{
    walletAddress: string;
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
    nationality: string | null;
  }>
> {
  if (walletAddresses.length === 0) return [];
  const rows = await db
    .select({
      walletAddress: userWallets.wallet_address,
      userId: fillxUsers.id,
      displayName: fillxUsers.display_name,
      avatarKey: fillxUsers.avatar_key,
      nationality: fillxUsers.nationality,
    })
    .from(userWallets)
    .innerJoin(fillxUsers, eq(fillxUsers.id, userWallets.user_id))
    .where(
      and(
        inArray(userWallets.wallet_address, walletAddresses),
        eq(userWallets.is_primary, true),
      ),
    );

  return rows.map((row) => ({
    walletAddress: row.walletAddress,
    userId: row.userId,
    displayName: row.displayName,
    avatarUrl: serializeAvatarUrl({ avatar_key: row.avatarKey }),
    nationality: row.nationality,
  }));
}
```

Replace `createIdentityRepos()` with:

```ts
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
```

- [ ] **Step 2: Run the backend check to verify the expected breakage**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server check
```

Expected: FAIL. Errors should reference the deleted username repo methods, deleted username tables/types, `UsernameStatus`, username route code, and fixtures still returning `username`/`username_status`.

- [ ] **Step 3: Generate the migration shell**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server db:generate -- --name remove_fillx_user_username
```

Expected: PASS and Drizzle creates `server/src/db/migrations/0005_remove_fillx_user_username.sql`, `server/src/db/migrations/meta/0005_snapshot.json`, and updates `server/src/db/migrations/meta/_journal.json`.

- [ ] **Step 4: Make the destructive migration explicit and idempotent**

Replace the contents of `fillx_backend/server/src/db/migrations/0005_remove_fillx_user_username.sql` with:

```sql
DROP TABLE IF EXISTS "username_claims";
--> statement-breakpoint
DROP TABLE IF EXISTS "username_claim_challenges";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_username_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "fillx_users_username_status_idx";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_username_lowercase";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_username_status_check";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP COLUMN IF EXISTS "username";
--> statement-breakpoint
ALTER TABLE "fillx_users" DROP COLUMN IF EXISTS "username_status";
```

- [ ] **Step 5: Verify Drizzle migration metadata**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
rg -n '"username"|"username_status"|"username_claim_challenges"|"username_claims"' server/src/db/migrations/meta/0005_snapshot.json
```

Expected: no matches.

- [ ] **Step 6: Verify username no longer appears in schema/repository code**

Run:

```bash
cd /home/fillx/eolive/dev
rg -n "username|Username|username_status|UsernameStatus|usernameClaims|username_claim" fillx_backend/server/src/db/schema.ts fillx_backend/server/src/identity/repositories.ts
```

Expected: no matches.

- [ ] **Step 7: Commit the schema/repository removal**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add server/src/db/schema.ts server/src/db/migrations/0005_remove_fillx_user_username.sql server/src/db/migrations/meta/_journal.json server/src/db/migrations/meta/0005_snapshot.json server/src/identity/repositories.ts
git commit -m "refactor: remove username persistence"
```

Expected: commit succeeds. Do not stage pre-existing unrelated docs changes.

## Task 2: Backend Identity Service and Unit Fixtures

**Files:**
- Modify: `fillx_backend/server/src/identity/identity.service.ts`
- Modify: `fillx_backend/server/src/identity/identity.service.test.ts`
- Modify: `fillx_backend/server/src/identity/wallet-session.service.ts`
- Modify: `fillx_backend/server/src/identity/avatar.service.test.ts`
- Modify: `fillx_backend/server/src/identity/wallet-session.service.test.ts`

- [ ] **Step 1: Update service tests to require username-free user creation**

In `fillx_backend/server/src/identity/identity.service.test.ts`, replace `makeUser()` with:

```ts
function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  const now = new Date("2026-05-07T00:00:00.000Z");
  return {
    id: input.id === undefined ? "user-1" : input.id,
    display_name: input.display_name === undefined ? null : input.display_name,
    avatar_key: input.avatar_key === undefined ? null : input.avatar_key,
    avatar_updated_at:
      input.avatar_updated_at === undefined ? null : input.avatar_updated_at,
    nationality: input.nationality === undefined ? null : input.nationality,
    created_at: input.created_at === undefined ? now : input.created_at,
    updated_at: input.updated_at === undefined ? now : input.updated_at,
  };
}
```

Replace user repo fakes in this file so each one has `createUser` instead of `findByUsername` and `createGeneratedUser`:

```ts
createUser: async () => {
  createCount += 1;
  return makeUser();
},
```

For tests that must not create users, use:

```ts
createUser: async () => {
  throw new Error("should not create user");
},
```

Replace the Privy creation assertion with:

```ts
test("getCurrentUser creates a user only for verified Privy auth", async () => {
  const linked: Array<{ userId: string; privyUserId: string }> = [];
  const created = makeUser({ id: "user-created" });
  const service = createIdentityService({
    users: {
      findById: async () => undefined,
      createUser: async () => created,
      updateProfile: async () => {
        throw new Error("should not update user");
      },
    },
    authIdentities: {
      findByProviderUserId: async () => undefined,
      linkPrivyIdentity: async (input) => {
        linked.push(input);
        return {};
      },
    },
  });

  const result = await service.getCurrentUser({
    auth: { type: "privy", privyUserId: "privy-user-2" },
  });

  assert.equal(result.user?.id, "user-created");
  assert.equal(result.guest, null);
  assert.deepEqual(linked, [
    { userId: "user-created", privyUserId: "privy-user-2" },
  ]);
});
```

Add this service test:

```ts
test("createUserFromWalletProof creates a profile without username generation", async () => {
  const created = makeUser({ id: "wallet-user" });
  const calls: string[] = [];
  const service = createIdentityService({
    users: {
      findById: async () => undefined,
      createUser: async () => {
        calls.push("createUser");
        return created;
      },
      updateProfile: async () => {
        throw new Error("should not update user");
      },
    },
  });

  const result = await service.createUserFromWalletProof();

  assert.equal(result.id, "wallet-user");
  assert.deepEqual(calls, ["createUser"]);
});
```

- [ ] **Step 2: Run the focused identity service test**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test -- src/identity/identity.service.test.ts
```

Expected: FAIL with `createGeneratedUser`, `findByUsername`, or `generateUsernameCandidate` references in `identity.service.ts`.

- [ ] **Step 3: Update the identity service implementation**

Replace the top of `fillx_backend/server/src/identity/identity.service.ts` with:

```ts
import type { FillxUser } from "../db/schema.js";

export type { FillxUser } from "../db/schema.js";
```

Replace the `users` repo type with:

```ts
  users: {
    findById?: (id: string) => Promise<FillxUser | undefined>;
    createUser?: () => Promise<FillxUser>;
    updateProfile: (input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
    }) => Promise<FillxUser>;
  };
```

Replace `createGeneratedUser()` with:

```ts
  async function createUser(): Promise<FillxUser> {
    if (!repos.users.createUser) {
      throw new Error("IDENTITY_REPO_INCOMPLETE");
    }

    return repos.users.createUser();
  }
```

Replace both calls to `createGeneratedUser()` with `createUser()`.

- [ ] **Step 4: Update remaining `FillxUser` fixtures**

In `fillx_backend/server/src/identity/wallet-session.service.ts`, replace `FillxPublicProfile` with:

```ts
export type FillxPublicProfile = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  primaryWallet: FillxPrimaryWalletProfile;
};
```

In `findPublicProfileByWalletKey()`, replace the returned object with:

```ts
    return {
      userId: user.id,
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
```

In `fillx_backend/server/src/identity/avatar.service.test.ts` and `fillx_backend/server/src/identity/wallet-session.service.test.ts`, remove `username` and `username_status` from every `makeUser()` return object and remove username overrides from calls such as:

```ts
makeUser({ username: "alice" })
```

Use ID-only overrides instead:

```ts
makeUser({ id: "user-1" })
```

In `wallet-session.service.test.ts`, replace expected public profile objects that contain username fields with:

```ts
{
  userId: "user-1",
  displayName: null,
  avatarUrl: null,
  nationality: null,
  primaryWallet: {
    chainType: "evm",
    walletAddress: "0xabc",
    walletKey: "evm:0xabc",
  },
}
```

- [ ] **Step 5: Run focused backend unit tests**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test -- src/identity/identity.service.test.ts src/identity/avatar.service.test.ts src/identity/wallet-session.service.test.ts
```

Expected: PASS for identity/avatar/wallet session unit tests or FAIL only in route/contract files not handled yet.

- [ ] **Step 6: Commit identity service changes**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add server/src/identity/identity.service.ts server/src/identity/identity.service.test.ts server/src/identity/wallet-session.service.ts server/src/identity/avatar.service.test.ts server/src/identity/wallet-session.service.test.ts
git commit -m "refactor: create identity users without usernames"
```

Expected: commit succeeds.

## Task 3: Shared Contract and Backend Routes

**Files:**
- Modify: `fillx_backend/shared/src/contract.ts`
- Modify: `fillx_backend/server/src/routes/identity.ts`
- Modify: `fillx_backend/server/src/identity/errors.ts`
- Delete: `fillx_backend/server/src/identity/username.service.ts`
- Delete: `fillx_backend/server/src/identity/username.service.test.ts`
- Delete: `fillx_backend/server/src/identity/username.rules.ts`
- Delete: `fillx_backend/server/src/identity/username.rules.test.ts`
- Delete: `fillx_backend/server/src/identity/username-message.ts`

- [ ] **Step 1: Remove username from the shared contract**

In `fillx_backend/shared/src/contract.ts`, delete:

```ts
const UsernameStatus = z.enum(["generated", "claimed"]);
```

Replace profile schemas with:

```ts
const FillxUserProfile = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
  primaryWallet: FillxPrimaryWallet.nullable(),
});

const PublicFillxProfile = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
  primaryWallet: FillxPrimaryWallet,
});

const PublicWalletProfile = z.object({
  walletAddress: z.string(),
  userId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
});
```

Delete the entire root `username: oc.router({ ... })` block.

- [ ] **Step 2: Remove username routes and serializers**

In `fillx_backend/server/src/routes/identity.ts`, remove this import:

```ts
import {
  createUsernameService,
  type UsernameServiceRepos,
} from "../identity/username.service.js";
```

Replace `serializeUser()` with:

```ts
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
```

Replace `serializePublicProfile()` with:

```ts
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
```

Rename `usernameClaimRateLimitWalletKey()` to `walletRateLimitKey()` and update both callers in `requestWalletSessionChallenge` and deleted username code removal:

```ts
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
```

Delete `createUsernameServiceForContext()` and delete the entire root `username: { ... }` block from `identityRoutes`.

In `fillx_backend/server/src/identity/errors.ts`, remove username-specific error codes from `ApiErrorCode`:

```ts
  | "INVALID_USERNAME"
  | "USERNAME_RESERVED"
  | "USERNAME_TAKEN"
  | "USERNAME_ALREADY_CLAIMED"
```

Remove these switch cases from `statusForApiError()`:

```ts
    case "USERNAME_TAKEN":
    case "USERNAME_ALREADY_CLAIMED":
```

and:

```ts
    case "INVALID_USERNAME":
    case "USERNAME_RESERVED":
```

- [ ] **Step 3: Delete username-only service files**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git rm server/src/identity/username.service.ts server/src/identity/username.service.test.ts server/src/identity/username.rules.ts server/src/identity/username.rules.test.ts server/src/identity/username-message.ts
```

Expected: files are staged for deletion.

- [ ] **Step 4: Run backend contract and route checks**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/shared check
yarn workspace @fillx/server check
yarn workspace @fillx/server test
```

Expected: shared check PASS, server check PASS, server unit tests PASS. Any remaining failures should be in E2E files that still call the removed username router and are handled in Task 4.

- [ ] **Step 5: Verify username router is gone**

Run:

```bash
cd /home/fillx/eolive/dev
rg -n "username|Username|hasClaimedUsername|usernameStatus|username_claim|claimUsername|requestClaimChallenge|checkAvailable" fillx_backend/shared/src fillx_backend/server/src -g '!fillx_backend/server/src/db/migrations/**'
```

Expected: no matches.

- [ ] **Step 6: Commit contract/routes removal**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add shared/src/contract.ts server/src/routes/identity.ts server/src/identity/errors.ts
git commit -m "refactor: remove username API"
```

Expected: commit succeeds and includes staged deletions from `git rm`.

## Task 4: Backend E2E and Helper Cleanup

**Files:**
- Delete: `fillx_backend/e2e/username.e2e.test.ts`
- Create: `fillx_backend/e2e/identity-profile.e2e.test.ts`
- Modify: `fillx_backend/e2e/helpers/avatar.ts`
- Modify: `fillx_backend/e2e/helpers/database.ts`

- [ ] **Step 1: Replace username E2E coverage with wallet-session/profile coverage**

Delete `fillx_backend/e2e/username.e2e.test.ts`:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git rm e2e/username.e2e.test.ts
```

Create `fillx_backend/e2e/identity-profile.e2e.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../server/src/db/client.js";
import {
  activeWalletHeaders,
  evmWalletKey,
} from "./helpers/avatar.js";
import { setupE2E } from "./helpers/harness.js";
import { evmWallet, signEvmMessage } from "./helpers/wallets.js";

if (!process.env.E2E_DATABASE_ADMIN_URL) {
  throw new Error("E2E_DATABASE_ADMIN_URL is required for FillX identity E2E tests");
}

async function countFillxUsers(): Promise<number> {
  const result = await getDb().execute(
    sql<{ count: string }>`select count(*)::text as count from fillx_users`,
  );
  const rows = Array.isArray(result) ? result : result.rows;
  const count = rows[0]?.count;
  assert.ok(count, "expected fillx_users count row");
  return Number(count);
}

function assertFillxCookie(cookie: string | undefined): void {
  assert.ok(cookie, "expected Set-Cookie header");
  assert.match(cookie, /(?:__Host-fillx_sid|fillx_sid)=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
}

async function verifyEvmWalletProfile(
  client: Awaited<ReturnType<typeof setupE2E>>["client"],
) {
  const challenge = await client.identity.requestWalletSessionChallenge({
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  return client.identity.verifyWalletSession({
    challengeId: challenge.challengeId,
    signature: await signEvmMessage(challenge.message),
  });
}

test("guest current-user is non-persistent", async (t) => {
  const { client } = await setupE2E(t);

  assert.deepEqual(await client.identity.getCurrentUser(), {
    state: "no_active_wallet",
    user: null,
    guest: { isGuest: true },
  });
  assert.equal(await countFillxUsers(), 0);
});

test("verified EVM wallet creates a FillX profile without username fields", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);

  const current = await verifyEvmWalletProfile(client);

  assert.equal(current.state, "authenticated");
  assert.ok(current.user);
  assert.equal(current.user.displayName, null);
  assert.equal(current.user.nationality, null);
  assert.equal(current.user.primaryWallet?.chainType, "evm");
  assert.equal(current.user.primaryWallet?.walletAddress, evmWallet.address);
  assert.equal("username" in current.user, false);
  assert.equal("usernameStatus" in current.user, false);
  assert.equal("hasClaimedUsername" in current.user, false);
  assertFillxCookie(cookieJar.lastSetCookieHeader());

  const { client: activeWalletClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(evmWalletKey(evmWallet.address)),
  });
  const resumed = await activeWalletClient.identity.getCurrentUser();
  assert.equal(resumed.state, "authenticated");
  assert.equal(resumed.user?.id, current.user.id);
});

test("public wallet lookup returns display metadata and no username fields", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);

  const current = await verifyEvmWalletProfile(client);
  assert.equal(current.state, "authenticated");
  const { client: activeWalletClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(evmWalletKey(evmWallet.address)),
  });

  await activeWalletClient.identity.updateDisplayName({
    displayName: "FillX Trader",
    nationality: "US",
  });

  const profile = await activeWalletClient.profile.getByWallets({
    walletAddresses: [evmWallet.address],
  });

  assert.equal(profile.profiles.length, 1);
  assert.equal(profile.profiles[0].walletAddress, evmWallet.address);
  assert.equal(profile.profiles[0].displayName, "FillX Trader");
  assert.equal(profile.profiles[0].nationality, "US");
  assert.equal("username" in profile.profiles[0], false);
  assert.equal("usernameStatus" in profile.profiles[0], false);
});
```

- [ ] **Step 2: Update avatar E2E helper profile creation**

In `fillx_backend/e2e/helpers/avatar.ts`, replace username claim setup with wallet-session setup:

```ts
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "../../shared/src/contract.js";
import { evmWallet, signEvmMessage } from "./wallets.js";

export function evmWalletKey(address: string): string {
  return `evm:${address.toLowerCase()}`;
}

export function activeWalletHeaders(walletKey: string): Record<string, string> {
  return { "x-fillx-active-wallet": walletKey };
}

export async function claimAvatarE2EUser(
  client: ContractRouterClient<Contract>,
): Promise<{ userId: string; walletKey: string }> {
  const challenge = await client.identity.requestWalletSessionChallenge({
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const current = await client.identity.verifyWalletSession({
    challengeId: challenge.challengeId,
    signature: await signEvmMessage(challenge.message),
  });
  if (current.state !== "authenticated" || !current.user) {
    throw new Error("Expected authenticated FillX profile");
  }
  return {
    userId: current.user.id,
    walletKey: evmWalletKey(evmWallet.address),
  };
}
```

Keep the exported function name `claimAvatarE2EUser` because `fillx_backend/e2e/avatar.e2e.test.ts` already imports it; only its internals switch from username claim to wallet verification.

- [ ] **Step 3: Update E2E database helper error wording**

In `fillx_backend/e2e/helpers/database.ts`, replace:

```ts
throw new Error("E2E_DATABASE_ADMIN_URL is required for username E2E tests");
```

with:

```ts
throw new Error("E2E_DATABASE_ADMIN_URL is required for FillX identity E2E tests");
```

- [ ] **Step 4: Run backend E2E typecheck**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn check:e2e
```

Expected: PASS.

- [ ] **Step 5: Run identity E2E when database env is available**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test:e2e -- ../e2e/identity-profile.e2e.test.ts
```

Expected with configured `E2E_DATABASE_ADMIN_URL` and database: PASS. Expected without that environment: FAIL immediately with `E2E_DATABASE_ADMIN_URL is required for FillX identity E2E tests`; record that as an environment limitation in the final verification notes.

- [ ] **Step 6: Commit backend E2E cleanup**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add e2e/identity-profile.e2e.test.ts e2e/helpers/avatar.ts e2e/helpers/database.ts
git commit -m "test: cover identity profiles without usernames"
```

Expected: commit succeeds and includes deletion of `e2e/username.e2e.test.ts`.

## Task 5: Frontend Contract and Types

**Files:**
- Modify: `eolive/app/generated/fillx-backend-contract.ts`
- Modify: `eolive/app/api/identity.ts`

- [ ] **Step 1: Sync the generated backend contract**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
yarn sync:fillx-contract --source /home/fillx/eolive/dev/fillx_backend/shared/src/contract.ts
```

Expected: PASS and `app/generated/fillx-backend-contract.ts` has no `UsernameStatus`, `username` router, `username`, `usernameStatus`, or `hasClaimedUsername`.

- [ ] **Step 2: Update frontend profile types**

In `eolive/app/api/identity.ts`, replace `FillxUserProfile`, `FillxPublicProfile`, and `FillxPublicWalletProfile` with:

```ts
export type FillxUserProfile = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  primaryWallet: FillxPrimaryWallet | null;
};

export type FillxPublicProfile = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  primaryWallet: FillxPrimaryWallet;
};

export type FillxPublicWalletProfile = {
  walletAddress: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
};
```

- [ ] **Step 3: Run frontend typecheck to surface consumers**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
yarn typecheck
```

Expected: FAIL with consumers referencing `username`, `usernameStatus`, `hasClaimedUsername`, `identityClient.username`, `FillxProfileDialogProps.username`, and `usernameLabel`.

- [ ] **Step 4: Commit generated contract and type update after consumers are fixed**

Do not commit yet if typecheck is still failing. After Tasks 6 and 7 pass, include these files in the frontend commit for the consumer task that made typecheck green.

## Task 6: Frontend Profile Summary, Editor, and Public Card

**Files:**
- Modify: `eolive/app/components/profile/fillxPortfolioProfileModel.ts`
- Modify: `eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`
- Modify: `eolive/app/hooks/useFillxProfileEditor.ts`
- Modify: `eolive/app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx`
- Modify: `eolive/app/components/profile/PublicProfileCard.tsx`
- Delete: `eolive/app/components/profile/UsernameClaimModal.tsx`

- [ ] **Step 1: Update profile model tests**

In `eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`, replace the first two summary tests with:

```ts
test("getFillxPortfolioProfileSummary prefers authenticated display name", () => {
  assert.deepEqual(
    getFillxPortfolioProfileSummary({
      user: {
        displayName: "Fill X",
        avatarUrl: "https://example.com/avatar.png",
        primaryWallet: {
          chainType: "evm",
          walletAddress: "0x1234567890abcdef",
          walletKey: "evm:0x1234567890abcdef",
        },
      },
      publicProfile: null,
      loading: false,
      walletAddress: "0x1234567890abcdef",
    }),
    {
      avatarUrl: "https://example.com/avatar.png",
      displayName: "Fill X",
      isEditable: true,
      statusLabel: null,
    },
  );
});

test("getFillxPortfolioProfileSummary falls back to public profile wallet display", () => {
  assert.deepEqual(
    getFillxPortfolioProfileSummary({
      user: null,
      publicProfile: {
        displayName: null,
        avatarUrl: null,
        primaryWallet: {
          chainType: "evm",
          walletAddress: "0x1234567890abcdef",
          walletKey: "evm:0x1234567890abcdef",
        },
      },
      loading: false,
      walletAddress: "0x0000000000000000",
    }),
    {
      avatarUrl: null,
      displayName: "0x1234...cdef",
      isEditable: true,
      statusLabel: null,
    },
  );
});
```

Remove every `handle` expected field from this test file.

- [ ] **Step 2: Run the focused model test**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts
```

Expected: FAIL because `fillxPortfolioProfileModel.ts` still requires `username` and returns `handle`.

- [ ] **Step 3: Update profile model implementation**

In `eolive/app/components/profile/fillxPortfolioProfileModel.ts`, replace `FillxProfileSummaryInput` and `FillxPortfolioProfileSummary` with:

```ts
type FillxProfileSummaryInput = {
  user: {
    displayName: string | null;
    avatarUrl: string | null;
    primaryWallet: { walletAddress: string } | null;
  } | null;
  publicProfile: {
    displayName: string | null;
    avatarUrl: string | null;
    primaryWallet: { walletAddress: string };
  } | null;
  loading: boolean;
  walletAddress: string | null | undefined;
};

export type FillxPortfolioProfileSummary = {
  avatarUrl: string | null;
  displayName: string;
  isEditable: boolean;
  statusLabel: string | null;
};
```

Replace the profile branch in `getFillxPortfolioProfileSummary()` with:

```ts
  if (profile) {
    const walletAddress =
      profile.primaryWallet?.walletAddress ?? input.walletAddress ?? null;
    const displayName =
      profile.displayName?.trim() ||
      (walletAddress ? shortenAddress(walletAddress) : "FillX profile");

    return {
      avatarUrl: profile.avatarUrl,
      displayName,
      isEditable: true,
      statusLabel: null,
    };
  }
```

- [ ] **Step 4: Update profile editor hook and dialog**

In `eolive/app/hooks/useFillxProfileEditor.ts`, add:

```ts
function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toDisplayNamePlaceholder(user: FillxUserProfile): string {
  const walletAddress = user.primaryWallet?.walletAddress;
  return walletAddress ? shortenAddress(walletAddress) : "";
}
```

Replace the dialog props block with:

```ts
        .show(fillxProfileDialogId, {
          walletKey: dialogWalletKey,
          initialDisplayName: toDialogInitialDisplayName(user),
          displayNamePlaceholder: toDisplayNamePlaceholder(user),
          initialAvatarUrl: user.avatarUrl,
          initialNationality: user.nationality,
          onProfileChanged: () => {
            void fillxProfile.refresh();
          },
        })
```

In `eolive/app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx`, replace `username: string;` in props with:

```ts
  displayNamePlaceholder: string;
```

Replace the display-name input placeholder:

```tsx
          placeholder={props.displayNamePlaceholder}
```

Delete the full `Username` label/input `<Flex>` block with `id="fillx-profile-username"`.

- [ ] **Step 5: Update public profile card**

In `eolive/app/components/profile/PublicProfileCard.tsx`, remove:

```ts
import { useMemo, useState } from "react";
import { UsernameClaimModal } from "./UsernameClaimModal";
```

Use:

```ts
import { useMemo } from "react";
```

Remove `claimOpen`, `setClaimOpen`, `chainId`, `chainType`, `walletProvider`, and `refresh` destructuring entries.

Replace `canClaim` and `canEdit` with:

```ts
  const canCreateOrEdit = Boolean(walletAddress);
```

Replace `title` with:

```ts
  const title = useMemo(() => {
    if (loading || fillxState === "syncing_profile") return "Syncing profile";
    const activeProfile = user ?? publicProfile ?? null;
    const profileWallet =
      user?.primaryWallet?.walletAddress ??
      publicProfile?.primaryWallet.walletAddress ??
      walletAddress;
    if (activeProfile) {
      return activeProfile.displayName?.trim() ||
        (profileWallet ? shortenAddress(profileWallet) : "FillX profile");
    }
    if (fillxState === "no_profile" && walletAddress) {
      return shortenAddress(walletAddress);
    }
    if (guest?.isGuest) return "Guest";
    return "No profile";
  }, [fillxState, guest?.isGuest, loading, publicProfile, user, walletAddress]);

  const secondaryLabel = useMemo(() => {
    const activeProfile = user ?? publicProfile ?? null;
    const profileWallet =
      user?.primaryWallet?.walletAddress ??
      publicProfile?.primaryWallet.walletAddress ??
      walletAddress;
    if (activeProfile?.displayName?.trim() && profileWallet) {
      return shortenAddress(profileWallet);
    }
    if (!activeProfile && !walletAddress) return "Wallet not connected";
    return null;
  }, [publicProfile, user, walletAddress]);
```

Replace the secondary text with:

```tsx
            {secondaryLabel}
```

Replace the edit/claim buttons with one action:

```tsx
      {canCreateOrEdit ? (
        <button
          type="button"
          onClick={() => void openFillxProfileEditor()}
          disabled={editDisabled || providerUnavailable}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#3fff8c] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#33dc79] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {openingEditor || signingIn ? (
            <Loader2 size={16} className="animate-spin" />
          ) : null}
          {user || publicProfile ? "Edit" : "Create profile"}
        </button>
      ) : null}
```

Delete the `UsernameClaimModal` JSX.

- [ ] **Step 6: Delete the username claim modal**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
git rm app/components/profile/UsernameClaimModal.tsx
```

Expected: file is staged for deletion.

- [ ] **Step 7: Run focused frontend profile tests**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts
```

Expected: PASS.

## Task 7: Frontend Leaderboard and Account Sheet

**Files:**
- Modify: `eolive/app/components/leaderboard/leaderboardIdentity.ts`
- Modify: `eolive/app/components/leaderboard/leaderboardIdentity.test.ts`
- Modify: `eolive/app/components/leaderboard/LeaderboardIdentityCell.tsx`
- Modify: `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheet.script.tsx`
- Modify: `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheet.ui.tsx`

- [ ] **Step 1: Update leaderboard tests**

In `eolive/app/components/leaderboard/leaderboardIdentity.test.ts`, replace the fixture with:

```ts
const profile: FillxPublicWalletProfile = {
  walletAddress: "0xABCDEF1234567890",
  userId: "user-1",
  displayName: "FillX Trader",
  avatarUrl: "https://example.com/avatar.png",
  nationality: "US",
};
```

Replace the display-name test expected value with:

```ts
{
  primaryLabel: "FillX Trader",
  secondaryLabel: "0xABCD...7890",
  walletLabel: "0xABCD...7890",
  avatarUrl: "https://example.com/avatar.png",
  hasProfile: true,
}
```

Replace the blank display-name test with:

```ts
test("getLeaderboardIdentityDisplay falls back to wallet when display name is blank", () => {
  const display = getLeaderboardIdentityDisplay({
    address: "0xABCDEF1234567890",
    profile: {
      ...profile,
      displayName: " ",
      avatarUrl: null,
    },
  });

  assert.equal(display.primaryLabel, "0xABCD...7890");
  assert.equal(display.secondaryLabel, null);
  assert.equal(display.walletLabel, "0xABCD...7890");
  assert.equal(display.avatarUrl, null);
  assert.equal(display.hasProfile, true);
});
```

Remove all `usernameLabel` expectations.

In the no-profile fallback test, add `secondaryLabel: null` to the expected object:

```ts
{
  primaryLabel: "0xABCD...7890",
  secondaryLabel: null,
  walletLabel: "0xABCD...7890",
  avatarUrl: null,
  hasProfile: false,
}
```

- [ ] **Step 2: Run the focused leaderboard test**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
npx tsx --test app/components/leaderboard/leaderboardIdentity.test.ts
```

Expected: FAIL because implementation still reads `profile.username` and returns `usernameLabel`.

- [ ] **Step 3: Update leaderboard implementation**

In `eolive/app/components/leaderboard/leaderboardIdentity.ts`, replace `LeaderboardIdentityDisplay` with:

```ts
export type LeaderboardIdentityDisplay = {
  primaryLabel: string;
  secondaryLabel: string | null;
  walletLabel: string;
  avatarUrl: string | null;
  hasProfile: boolean;
};
```

Replace the profile branch in `getLeaderboardIdentityDisplay()` with:

```ts
  const displayName = cleanText(profile.displayName);
  const primaryLabel = displayName || walletLabel;

  return {
    primaryLabel,
    secondaryLabel: displayName ? walletLabel : null,
    walletLabel,
    avatarUrl: profile.avatarUrl,
    hasProfile: true,
  };
```

In the no-profile return object, add `secondaryLabel: null`:

```ts
    return {
      primaryLabel: walletLabel,
      secondaryLabel: null,
      walletLabel,
      avatarUrl: null,
      hasProfile: false,
    };
```

In `eolive/app/components/leaderboard/LeaderboardIdentityCell.tsx`, replace secondary rendering conditions that use `display.usernameLabel` with `display.secondaryLabel`. The secondary line should render only when there is a distinct wallet label:

```tsx
      {!compact && display.secondaryLabel ? (
        <span
          className={cn(
            "mt-0.5 block truncate text-left text-body-xs text-text-tertiary",
            secondaryClassName,
          )}
        >
          {display.secondaryLabel}
        </span>
      ) : null}
```

- [ ] **Step 4: Update account sheet labels**

In `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheet.script.tsx`, replace:

```ts
    fillxUsername:
      fillxProfile.user?.username ?? fillxProfile.publicProfile?.username ?? null,
```

with:

```ts
    hasFillxProfile: Boolean(fillxProfile.user ?? fillxProfile.publicProfile),
```

Update the `AccountSheetState` type in the same file if it declares `fillxUsername`; replace it with:

```ts
  hasFillxProfile: boolean;
```

In `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheet.ui.tsx`, replace the label logic with:

```ts
  const fillxLabel =
    props.fillxState === "syncing_profile"
      ? "Syncing profile"
      : props.hasFillxProfile
        ? "FillX profile"
        : props.fillxState === "no_profile"
          ? "Create profile"
          : null;
```

- [ ] **Step 5: Run focused leaderboard tests and frontend typecheck**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
npx tsx --test app/components/leaderboard/leaderboardIdentity.test.ts
yarn typecheck
```

Expected: leaderboard tests PASS and typecheck PASS, or typecheck FAIL only for username references found by the next step.

- [ ] **Step 6: Verify frontend username references are gone**

Run:

```bash
cd /home/fillx/eolive/dev
rg -n "username|Username|hasClaimedUsername|usernameStatus|Claim username|UsernameClaim|identityClient\\.username|usernameLabel|fillxUsername" eolive/app -g '!features/ai/services/github-trending.ts'
```

Expected: no matches. `eolive/app/features/ai/services/github-trending.ts` is excluded because it models unrelated GitHub API data and must remain untouched.

- [ ] **Step 7: Commit frontend profile and leaderboard removal**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
git add app/generated/fillx-backend-contract.ts app/api/identity.ts app/components/profile/fillxPortfolioProfileModel.ts app/components/profile/fillxPortfolioProfileModel.test.ts app/hooks/useFillxProfileEditor.ts app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx app/components/profile/PublicProfileCard.tsx app/components/leaderboard/leaderboardIdentity.ts app/components/leaderboard/leaderboardIdentity.test.ts app/components/leaderboard/LeaderboardIdentityCell.tsx app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheet.script.tsx app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheet.ui.tsx
git commit -m "refactor: remove username from frontend identity"
```

Expected: commit succeeds and includes deletion of `app/components/profile/UsernameClaimModal.tsx`.

## Task 8: Documentation, Global Verification, and Final Review

**Files:**
- Modify: `fillx_backend/CONTEXT.md`
- Modify: `fillx_backend/docs/adr/0001-identity-proof-and-session-boundaries.md`

- [ ] **Step 1: Update backend domain documentation**

In `fillx_backend/CONTEXT.md`, replace username identity language with:

```md
FillX profile identity is anchored by verified wallets. A profile may have editable display metadata such as display name, avatar, and nationality, but display name is nullable and not unique. Public UI should render `displayName || shortened primary wallet address`.
```

In `fillx_backend/docs/adr/0001-identity-proof-and-session-boundaries.md`, replace username ownership/proof language with:

```md
Wallet signatures prove control of a wallet for session establishment and profile creation. The system does not maintain unique public handles; public identity is display metadata plus the verified primary wallet binding.
```

- [ ] **Step 2: Run full backend checks**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn check
yarn workspace @fillx/server test
yarn check:e2e
```

Expected: all PASS.

- [ ] **Step 3: Run frontend checks**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts app/components/leaderboard/leaderboardIdentity.test.ts
yarn typecheck
```

Expected: all PASS.

- [ ] **Step 4: Run global username scans**

Run:

```bash
cd /home/fillx/eolive/dev
rg -n "username|Username|hasClaimedUsername|usernameStatus|username_claim|Claim username|UsernameClaim|identityClient\\.username|fillxUsername|usernameLabel" fillx_backend/shared/src fillx_backend/server/src fillx_backend/e2e eolive/app fillx_backend/CONTEXT.md fillx_backend/docs/adr -g '!fillx_backend/server/src/db/migrations/**' -g '!eolive/app/features/ai/services/github-trending.ts'
```

Expected: no matches. Migration files are excluded because the new destructive migration must contain the old column and table names in `DROP` statements.

- [ ] **Step 5: Inspect git state**

Run:

```bash
cd /home/fillx/eolive/dev
git -C fillx_backend status --short
git -C eolive status --short
```

Expected: only intended docs changes remain unstaged, or both repos are clean after commits. Pre-existing unrelated backend docs changes must not be reverted or included in commits.

- [ ] **Step 6: Commit documentation updates**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add CONTEXT.md docs/adr/0001-identity-proof-and-session-boundaries.md
git commit -m "docs: document wallet-based FillX identity"
```

Expected: commit succeeds.

- [ ] **Step 7: Final manual smoke test**

Run:

```bash
cd /home/fillx/eolive/dev
FRONTEND_PORT=7471 BACKEND_PORT=7472 ./start-dev.sh
```

Expected: frontend serves on `http://localhost:7471` and backend on `http://localhost:7472`. In the browser, connect a wallet with no existing profile, open the public profile card, click `Create profile`, sign the wallet session, save a display name, and verify the profile, account sheet, and leaderboard display the saved name with wallet secondary text and no username field.

## Self-Review Notes

- Spec coverage: database removal is Task 1; backend user creation and route contract removal are Tasks 2 and 3; wallet-session/public-profile E2E is Task 4; frontend generated contract/profile/editor/leaderboard/account-sheet removal is Tasks 5 through 7; docs and final scans are Task 8.
- Red-flag scan: this plan avoids deferred markers and includes exact file paths, commands, expected outcomes, and concrete code blocks for each code-changing step.
- Type consistency: backend uses `createUser()` everywhere after Task 2; public and private profile DTOs contain `displayName`, `avatarUrl`, `nationality`, and wallet fields only; frontend display helpers use `displayName || shortened wallet`.
