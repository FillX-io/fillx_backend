# FillX User Nationality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-entered ISO alpha-2 nationality field to FillX user profiles and return it from current-user and public wallet profile reads.

**Architecture:** Store `nationality` as nullable text on `fillx_users` with a database check constraint for uppercase two-letter codes. Normalize and validate profile updates in the identity service, keep the existing `identity.updateDisplayName` route name, and extend the shared ORPC contract plus frontend identity types. Public wallet profile lookups read the same persisted value from `fillx_users`.

**Tech Stack:** TypeScript, Node test runner, Drizzle ORM and drizzle-kit migrations, PostgreSQL, ORPC contract, React frontend TypeScript types.

---

## File Structure

- Modify `fillx_backend/server/src/db/schema.ts`: add `fillx_users.nationality` and the database check constraint.
- Create generated migration files under `fillx_backend/server/src/db/migrations/`: add the nullable column and constraint, plus Drizzle metadata.
- Modify `fillx_backend/server/src/identity/identity.service.ts`: normalize profile update input and call a broader repo method.
- Modify `fillx_backend/server/src/identity/identity.service.test.ts`: cover nationality normalization, clearing, invalid input, and partial update preservation.
- Modify `fillx_backend/server/src/identity/username.service.test.ts`: keep `FillxUser` fixtures aligned with the schema type.
- Modify `fillx_backend/server/src/identity/repositories.ts`: update `fillx_users` profile fields and include nationality in public wallet profile selects.
- Modify `fillx_backend/server/src/routes/identity.ts`: serialize nationality and pass profile update fields to the service.
- Modify `fillx_backend/shared/src/contract.ts`: expose nationality in profile schemas and allow partial profile update input.
- Modify `fillx_backend/e2e/username.e2e.test.ts`: verify nationality through current-user update and public wallet lookup.
- Modify `eolive/app/generated/fillx-backend-contract.ts`: regenerate from the shared backend contract.
- Modify `eolive/app/api/identity.ts`: add nationality to frontend identity types.

## Scope Check

The spec covers one cohesive subsystem: FillX user profile nationality. The backend, contract, and frontend type changes are coupled because the ORPC contract is shared across them. This is one implementation plan.

### Task 1: Add Database Column and Migration

**Files:**
- Modify: `fillx_backend/server/src/db/schema.ts`
- Modify: `fillx_backend/server/src/identity/identity.service.test.ts`
- Modify: `fillx_backend/server/src/identity/username.service.test.ts`
- Create: `fillx_backend/server/src/db/migrations/0002_add_fillx_user_nationality.sql`
- Create: `fillx_backend/server/src/db/migrations/meta/0002_snapshot.json`
- Modify: `fillx_backend/server/src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Add the schema field and check constraint**

In `fillx_backend/server/src/db/schema.ts`, add `nationality` immediately after `avatar_url`:

```ts
    avatar_url: text("avatar_url"),
    nationality: text("nationality"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
```

In the `fillxUsers` table constraints, add this check after `displayNameCheck`:

```ts
    nationalityCheck: check(
      "fillx_users_nationality_check",
      sql`${table.nationality} is null or ${table.nationality} ~ '^[A-Z]{2}$'`,
    ),
```

- [ ] **Step 2: Run typecheck to verify fixtures now fail**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server check
```

Expected: FAIL with TypeScript errors in `server/src/identity/identity.service.test.ts` and `server/src/identity/username.service.test.ts` because `FillxUser` fixtures do not include `nationality`.

- [ ] **Step 3: Update identity service test fixture**

In `fillx_backend/server/src/identity/identity.service.test.ts`, update `makeUser` so the returned object includes nationality:

```ts
function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  const now = new Date("2026-05-07T00:00:00.000Z");
  return {
    id: input.id === undefined ? "user-1" : input.id,
    username: input.username === undefined ? "trader_0001" : input.username,
    username_status:
      input.username_status === undefined ? "generated" : input.username_status,
    display_name: input.display_name === undefined ? null : input.display_name,
    avatar_url: input.avatar_url === undefined ? null : input.avatar_url,
    nationality: input.nationality === undefined ? null : input.nationality,
    created_at: input.created_at === undefined ? now : input.created_at,
    updated_at: input.updated_at === undefined ? now : input.updated_at,
  };
}
```

- [ ] **Step 4: Update username service test fixture**

In `fillx_backend/server/src/identity/username.service.test.ts`, update `makeUser` so the returned object includes nationality:

```ts
function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  const now = new Date("2026-05-07T00:00:00.000Z");
  return {
    id: input.id === undefined ? "user-1" : input.id,
    username: input.username === undefined ? "trader_0001" : input.username,
    username_status:
      input.username_status === undefined ? "generated" : input.username_status,
    display_name: input.display_name === undefined ? null : input.display_name,
    avatar_url: input.avatar_url === undefined ? null : input.avatar_url,
    nationality: input.nationality === undefined ? null : input.nationality,
    created_at: input.created_at === undefined ? now : input.created_at,
    updated_at: input.updated_at === undefined ? now : input.updated_at,
  };
}
```

- [ ] **Step 5: Generate the Drizzle migration**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server db:generate --name=add_fillx_user_nationality
```

Expected:

- `server/src/db/migrations/0002_add_fillx_user_nationality.sql` is created.
- `server/src/db/migrations/meta/0002_snapshot.json` is created.
- `server/src/db/migrations/meta/_journal.json` gains an entry for `0002_add_fillx_user_nationality`.

The SQL migration should contain the equivalent of:

```sql
ALTER TABLE "fillx_users" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "fillx_users" ADD CONSTRAINT "fillx_users_nationality_check" CHECK ("fillx_users"."nationality" is null or "fillx_users"."nationality" ~ '^[A-Z]{2}$');
```

- [ ] **Step 6: Run backend typecheck**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server check
```

Expected: PASS.

- [ ] **Step 7: Commit database change**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add server/src/db/schema.ts \
  server/src/db/migrations/0002_add_fillx_user_nationality.sql \
  server/src/db/migrations/meta/0002_snapshot.json \
  server/src/db/migrations/meta/_journal.json \
  server/src/identity/identity.service.test.ts \
  server/src/identity/username.service.test.ts
git commit -m "feat: add fillx user nationality column"
```

Expected: commit succeeds. Existing unrelated modified username docs stay unstaged.

### Task 2: Validate Nationality in Identity Service

**Files:**
- Modify: `fillx_backend/server/src/identity/identity.service.ts`
- Modify: `fillx_backend/server/src/identity/identity.service.test.ts`
- Modify: `fillx_backend/server/src/identity/repositories.ts`

- [ ] **Step 1: Replace test repo mocks with `updateProfile`**

In `fillx_backend/server/src/identity/identity.service.test.ts`, replace each existing `updateDisplayName` mock with:

```ts
      updateProfile: async () => {
        throw new Error("should not update user");
      },
```

There are four mocks in the existing current-user tests.

- [ ] **Step 2: Add failing profile update tests**

Append this helper and tests to `fillx_backend/server/src/identity/identity.service.test.ts`:

```ts
function makeProfileUpdateService(initialUser: FillxUser = makeUser()) {
  let stored = initialUser;
  const updates: Array<{
    userId: string;
    displayName?: string | null;
    nationality?: string | null;
  }> = [];

  const service = createIdentityService({
    users: {
      findById: async (id) => (id === stored.id ? stored : undefined),
      findByUsername: async () => undefined,
      createGeneratedUser: async () => {
        throw new Error("should not create user");
      },
      updateProfile: async (input) => {
        updates.push(input);
        stored = {
          ...stored,
          display_name:
            input.displayName === undefined ? stored.display_name : input.displayName,
          nationality:
            input.nationality === undefined ? stored.nationality : input.nationality,
          updated_at: new Date("2026-05-07T00:01:00.000Z"),
        };
        return stored;
      },
    },
  });

  return {
    service,
    updates,
    getStored: () => stored,
  };
}

test("updateProfile normalizes lowercase nationality to uppercase", async () => {
  const { service, updates } = makeProfileUpdateService();

  const result = await service.updateProfile({
    userId: "user-1",
    nationality: "us",
  });

  assert.equal(result.nationality, "US");
  assert.deepEqual(updates, [{ userId: "user-1", nationality: "US" }]);
});

test("updateProfile accepts uppercase nationality unchanged", async () => {
  const { service, updates } = makeProfileUpdateService();

  const result = await service.updateProfile({
    userId: "user-1",
    nationality: "NG",
  });

  assert.equal(result.nationality, "NG");
  assert.deepEqual(updates, [{ userId: "user-1", nationality: "NG" }]);
});

test("updateProfile clears nationality with empty string or null", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ nationality: "JP" }),
  );

  const emptyResult = await service.updateProfile({
    userId: "user-1",
    nationality: "   ",
  });
  const nullResult = await service.updateProfile({
    userId: "user-1",
    nationality: null,
  });

  assert.equal(emptyResult.nationality, null);
  assert.equal(nullResult.nationality, null);
  assert.deepEqual(updates, [
    { userId: "user-1", nationality: null },
    { userId: "user-1", nationality: null },
  ]);
});

test("updateProfile rejects invalid nationality before writing", async () => {
  const { service, updates } = makeProfileUpdateService();

  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "usa" }),
    /INVALID_NATIONALITY/,
  );
  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "1!" }),
    /INVALID_NATIONALITY/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile preserves omitted fields and trims display name", async () => {
  const { service } = makeProfileUpdateService(
    makeUser({ display_name: "Existing", nationality: "BR" }),
  );

  const displayNameResult = await service.updateProfile({
    userId: "user-1",
    displayName: "  New Display  ",
  });
  const nationalityResult = await service.updateProfile({
    userId: "user-1",
    nationality: "ca",
  });

  assert.equal(displayNameResult.display_name, "New Display");
  assert.equal(displayNameResult.nationality, "BR");
  assert.equal(nationalityResult.display_name, "New Display");
  assert.equal(nationalityResult.nationality, "CA");
});

test("updateProfile clears display name with null", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing" }),
  );

  const result = await service.updateProfile({
    userId: "user-1",
    displayName: null,
  });

  assert.equal(result.display_name, null);
  assert.deepEqual(updates, [{ userId: "user-1", displayName: null }]);
});
```

- [ ] **Step 3: Run the service tests to verify they fail**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test --test-name-pattern "updateProfile"
```

Expected: FAIL with TypeScript/runtime errors because `updateProfile` is not defined on the service and repo interface yet.

- [ ] **Step 4: Update the service repo type and add normalization**

In `fillx_backend/server/src/identity/identity.service.ts`, replace the `updateDisplayName` repo method in `IdentityRepos` with:

```ts
    updateProfile: (input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
    }) => Promise<FillxUser>;
```

Add these helpers above `export function createIdentityService`:

```ts
function normalizeDisplayName(input: string | null): string | null {
  if (input === null) return null;

  const displayName = input.trim();
  if (displayName.length === 0 || displayName.length > 50) {
    throw new Error("INVALID_DISPLAY_NAME");
  }
  return displayName;
}

function normalizeNationality(input: string | null): string | null {
  if (input === null) return null;

  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const nationality = trimmed.toUpperCase();
  if (!/^[A-Z]{2}$/.test(nationality)) {
    throw new Error("INVALID_NATIONALITY");
  }

  return nationality;
}
```

Replace the existing `updateDisplayName` service method with:

```ts
    async updateProfile(input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
    }): Promise<FillxUser> {
      const update: {
        userId: string;
        displayName?: string | null;
        nationality?: string | null;
      } = { userId: input.userId };

      if (input.displayName !== undefined) {
        update.displayName = normalizeDisplayName(input.displayName);
      }
      if (input.nationality !== undefined) {
        update.nationality = normalizeNationality(input.nationality);
      }
      if (update.displayName === undefined && update.nationality === undefined) {
        throw new Error("PROFILE_UPDATE_EMPTY");
      }

      return repos.users.updateProfile(update);
    },
```

- [ ] **Step 5: Update repository profile write method**

In `fillx_backend/server/src/identity/repositories.ts`, replace `updateDisplayName` in `createUsersRepo` with:

```ts
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
```

- [ ] **Step 6: Run service tests**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test --test-name-pattern "updateProfile"
```

Expected: PASS.

- [ ] **Step 7: Run all backend unit tests**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test
```

Expected: PASS.

- [ ] **Step 8: Commit service validation**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add server/src/identity/identity.service.ts \
  server/src/identity/identity.service.test.ts \
  server/src/identity/repositories.ts
git commit -m "feat: validate nationality profile updates"
```

Expected: commit succeeds.

### Task 3: Expose Nationality Through Backend Contract and Routes

**Files:**
- Modify: `fillx_backend/shared/src/contract.ts`
- Modify: `fillx_backend/server/src/routes/identity.ts`
- Modify: `fillx_backend/server/src/identity/repositories.ts`
- Modify: `fillx_backend/e2e/username.e2e.test.ts`

- [ ] **Step 1: Add failing E2E contract coverage**

In `fillx_backend/e2e/username.e2e.test.ts`, inside the test named `"Privy token does not resolve to an already claimed wallet-backed profile"`, replace the block from `const privyCurrent = ...` through the `profile.profiles[0].displayName` assertion with:

```ts
  const walletNationality = await client.identity.updateDisplayName({
    nationality: "ca",
  });
  assert.equal(walletNationality.user.id, walletUser.user.id);
  assert.equal(walletNationality.user.nationality, "CA");

  const walletCurrent = await client.identity.getCurrentUser();
  assert.equal(walletCurrent.user?.nationality, "CA");

  const token = await privy.createAccessToken({
    privyUserId: "did:privy:isolated",
  });
  const { client: privyClient } = createClient({
    baseUrl,
    cookieJar,
    headers: { authorization: `Bearer ${token}` },
  });

  const privyCurrent = await privyClient.identity.getCurrentUser();
  assert.ok(privyCurrent.user);
  assert.notEqual(privyCurrent.user.id, walletUser.user.id);
  assert.equal(privyCurrent.user.nationality, null);

  const updated = await privyClient.identity.updateDisplayName({
    displayName: "Privy Display",
    nationality: "us",
  });
  assert.equal(updated.user.id, privyCurrent.user.id);
  assert.equal(updated.user.displayName, "Privy Display");
  assert.equal(updated.user.nationality, "US");

  const profile = await client.profile.getByWallets({
    walletAddresses: [evmWallet.address],
  });
  assert.equal(profile.profiles.length, 1);
  assert.equal(profile.profiles[0].userId, walletUser.user.id);
  assert.equal(profile.profiles[0].username, "walletonly");
  assert.equal(profile.profiles[0].displayName, null);
  assert.equal(profile.profiles[0].nationality, "CA");
```

Keep the existing final assertion in that test:

```ts
  assert.equal(await countFillxUsers(), 2);
```

- [ ] **Step 2: Run E2E typecheck to verify it fails**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn check:e2e
```

Expected: FAIL because the shared contract does not yet accept `nationality` in `identity.updateDisplayName` input and does not return `nationality` on profile DTOs.

- [ ] **Step 3: Update shared ORPC contract schemas**

In `fillx_backend/shared/src/contract.ts`, add `nationality` to `FillxUserProfile`:

```ts
const FillxUserProfile = z.object({
  id: z.string(),
  username: z.string(),
  usernameStatus: UsernameStatus,
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
  hasClaimedUsername: z.boolean(),
});
```

Add `nationality` to `PublicWalletProfile`:

```ts
const PublicWalletProfile = z.object({
  walletAddress: z.string(),
  userId: z.string(),
  username: z.string(),
  usernameStatus: UsernameStatus,
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  nationality: z.string().nullable(),
});
```

Replace the `identity.updateDisplayName` input with:

```ts
    updateDisplayName: oc
      .input(
        z.object({
          displayName: z.string().max(50).nullable().optional(),
          nationality: z.string().nullable().optional(),
        }),
      )
      .output(z.object({ user: FillxUserProfile })),
```

- [ ] **Step 4: Update route serialization and update handler**

In `fillx_backend/server/src/routes/identity.ts`, update `serializeUser` to accept and return nationality:

```ts
function serializeUser(user: {
  id: string;
  username: string;
  username_status: "generated" | "claimed";
  display_name: string | null;
  avatar_url: string | null;
  nationality: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    usernameStatus: user.username_status,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    nationality: user.nationality,
    hasClaimedUsername: user.username_status === "claimed",
  };
}
```

In the `updateDisplayName` handler, replace the service call with:

```ts
          const updated = await service.updateProfile({
            userId: user.id,
            displayName: input.displayName,
            nationality: input.nationality,
          });
```

- [ ] **Step 5: Include nationality in public wallet profile lookup**

In `fillx_backend/server/src/identity/repositories.ts`, update the return type of `getProfilesByWallets` to include:

```ts
    nationality: string | null;
```

Update the select object to include:

```ts
      nationality: fillxUsers.nationality,
```

The complete selected profile shape should be:

```ts
    walletAddress: string;
    userId: string;
    username: string;
    usernameStatus: UsernameStatus;
    displayName: string | null;
    avatarUrl: string | null;
    nationality: string | null;
```

- [ ] **Step 6: Run E2E typecheck**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn check:e2e
```

Expected: PASS.

- [ ] **Step 7: Run backend unit tests**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test
```

Expected: PASS.

- [ ] **Step 8: Run username E2E when a safe admin database URL is available**

Run with a non-production PostgreSQL admin URL:

```bash
cd /home/fillx/eolive/dev/fillx_backend
E2E_DATABASE_ADMIN_URL="postgres://postgres:postgres@localhost:5432/postgres" yarn test:e2e
```

Expected when that local database is running: PASS. If the database is not running, the expected failure is a PostgreSQL connection error; start the local database and rerun before marking this step complete.

- [ ] **Step 9: Commit backend API exposure**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git add shared/src/contract.ts \
  server/src/routes/identity.ts \
  server/src/identity/repositories.ts \
  e2e/username.e2e.test.ts
git commit -m "feat: expose nationality in identity profiles"
```

Expected: commit succeeds.

### Task 4: Sync Frontend Contract and Types

**Files:**
- Modify: `eolive/app/generated/fillx-backend-contract.ts`
- Modify: `eolive/app/api/identity.ts`

- [ ] **Step 1: Regenerate frontend contract copy**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
yarn sync:fillx-contract --source ../fillx_backend/shared/src/contract.ts
```

Expected output:

```text
Synced /home/fillx/eolive/dev/fillx_backend/shared/src/contract.ts -> /home/fillx/eolive/dev/eolive/app/generated/fillx-backend-contract.ts
```

- [ ] **Step 2: Verify generated contract includes nationality**

In `eolive/app/generated/fillx-backend-contract.ts`, verify `FillxUserProfile` includes:

```ts
  nationality: z.string().nullable(),
```

Verify `PublicWalletProfile` includes:

```ts
  nationality: z.string().nullable(),
```

Verify `identity.updateDisplayName` input is:

```ts
      .input(
        z.object({
          displayName: z.string().max(50).nullable().optional(),
          nationality: z.string().nullable().optional(),
        }),
      )
```

- [ ] **Step 3: Update frontend identity types**

In `eolive/app/api/identity.ts`, update `FillxUserProfile`:

```ts
export type FillxUserProfile = {
  id: string;
  username: string;
  usernameStatus: "generated" | "claimed";
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  hasClaimedUsername: boolean;
};
```

Update `FillxPublicWalletProfile`:

```ts
export type FillxPublicWalletProfile = {
  walletAddress: string;
  userId: string;
  username: string;
  usernameStatus: "generated" | "claimed";
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
};
```

- [ ] **Step 4: Run frontend typecheck**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
yarn typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit frontend contract sync**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
git add app/generated/fillx-backend-contract.ts app/api/identity.ts
git commit -m "feat: sync fillx nationality contract"
```

Expected: commit succeeds.

### Task 5: Final Verification

**Files:**
- Verify: `fillx_backend`
- Verify: `eolive`

- [ ] **Step 1: Run backend checks**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
yarn workspace @fillx/server test
yarn workspace @fillx/server check
yarn check:e2e
```

Expected: all commands PASS.

- [ ] **Step 2: Run backend E2E**

Run with a safe local admin database:

```bash
cd /home/fillx/eolive/dev/fillx_backend
E2E_DATABASE_ADMIN_URL="postgres://postgres:postgres@localhost:5432/postgres" yarn test:e2e
```

Expected: PASS. If PostgreSQL is unavailable, record that E2E runtime verification is blocked by local database availability and keep `yarn check:e2e` as the completed compile verification.

- [ ] **Step 3: Run frontend typecheck**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
yarn typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect backend git status**

Run:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git status --short
```

Expected: no nationality implementation files are modified. Pre-existing unrelated edits to username docs can remain if they were present before this implementation.

- [ ] **Step 5: Inspect frontend git status**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
git status --short
```

Expected: clean after the frontend commit.

## Self-Review

Spec coverage:

- User-entered nationality stored on `fillx_users`: Task 1.
- ISO alpha-2 uppercase normalization and nullable unset state: Tasks 1 and 2.
- Editable through existing profile API surface: Tasks 2 and 3.
- Current-user profile response includes nationality: Task 3.
- Public wallet profile response includes nationality: Task 3.
- Frontend contract/types agree with backend: Task 4.
- Tests for normalization, clearing, invalid rejection, partial preservation, and profile reads: Tasks 2 and 3.

Placeholder scan:

- The plan contains concrete file paths, commands, code snippets, expected failures, expected passes, and commit commands for each task.

Type consistency:

- The persisted column is `nationality`.
- Database objects use snake_case fields already used by Drizzle where applicable.
- API DTOs and frontend types use camelCase field `nationality`.
- The route name remains `identity.updateDisplayName`.
- The internal service and repository method name becomes `updateProfile`.
