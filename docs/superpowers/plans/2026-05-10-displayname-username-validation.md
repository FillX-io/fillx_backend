# DisplayName-Backed Username Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `displayName` behave as the app's user-facing Username everywhere, with frontend UX updates and backend validation, uniqueness, and database enforcement.

**Architecture:** Keep the internal API/database names as `displayName` / `display_name`; only user-facing language says "Username". Backend service validation is the source of truth for rules and stable error codes, with a database check and partial unique index as the final guard. Frontend model validation mirrors backend rules so the dialog can disable Save and show precise inline messages before submitting.

**Tech Stack:** TypeScript, React, Orderly UI, lucide-react, zod/orpc contracts, Node test runner, Drizzle ORM, PostgreSQL migrations, Yarn workspaces.

---

## Worktree And Scope

Current bundle root is `/home/fillx/eolive/dev`.

Repos:
- Frontend: `/home/fillx/eolive/dev/eolive`
- Backend: `/home/fillx/eolive/dev/fillx_backend`

Preserve these existing dirty files unless Task 0 commits them first:
- `/home/fillx/eolive/dev/eolive/app/components/profile/FillxPortfolioProfileHeader.tsx`
- `/home/fillx/eolive/dev/eolive/app/components/profile/fillxPortfolioProfileModel.ts`
- `/home/fillx/eolive/dev/eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`
- `/home/fillx/eolive/dev/fillx_backend/docs/superpowers/plans/2026-05-07-username-identity-e2e.md`
- `/home/fillx/eolive/dev/fillx_backend/docs/superpowers/specs/2026-05-07-username-e2e-design.md`

The two backend docs dated `2026-05-07` are unrelated to this plan. Do not stage them.

## File Map

Backend files:
- Modify `fillx_backend/server/src/identity/identity.service.ts`: normalize, validate, require, and uniqueness-check usernames while keeping `displayName` naming.
- Modify `fillx_backend/server/src/identity/identity.service.test.ts`: add service tests for username rules and update old space-containing display name fixtures.
- Modify `fillx_backend/server/src/identity/repositories.ts`: add case-insensitive `display_name` lookup for service uniqueness checks.
- Modify `fillx_backend/server/src/identity/errors.ts`: add stable API error codes.
- Modify `fillx_backend/server/src/identity/errors.test.ts`: cover status mapping for new API error codes.
- Modify `fillx_backend/server/src/routes/identity.ts`: map profile update domain errors to stable ORPC API errors.
- Modify `fillx_backend/shared/src/contract.ts`: remove the old 50-character display name cap from the contract so service-level errors stay stable.
- Modify `fillx_backend/server/src/db/schema.ts`: replace the old display name check and add a partial unique lower index.
- Create through Drizzle `fillx_backend/server/src/db/migrations/0006_displayname_username_validation.sql`: clean legacy values, add the check, add the index.
- Create through Drizzle `fillx_backend/server/src/db/migrations/meta/0006_snapshot.json`: generated schema snapshot.
- Modify through Drizzle `fillx_backend/server/src/db/migrations/meta/_journal.json`: add migration entry.
- Modify `fillx_backend/e2e/identity-profile.e2e.test.ts`: update invalid test fixtures and add duplicate username coverage if the existing helpers support a second verified user cheaply.
- Modify `fillx_backend/CONTEXT.md`: update domain language so display name is now a unique user-facing username, while profile identity is still anchored by wallets.

Frontend files:
- Modify `eolive/app/components/profile/fillxPortfolioProfileModel.ts`: mirror username rules and expose `FILLX_USERNAME_MAX_LENGTH`.
- Modify `eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`: add username model tests and update old space-containing fixtures.
- Modify `eolive/app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx`: dynamic title, Username label, tooltip icon, counter, `maxLength={25}`, stable backend error messages.
- Modify `eolive/app/hooks/useFillxProfileEditor.ts`: change username placeholder behavior.
- Modify `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.ts`: user-facing "Create Username" copy.
- Modify `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts`: copy assertion update.
- Modify `eolive/app/components/profile/PublicProfileCard.tsx`: user-facing create/edit button copy.
- Modify `eolive/app/components/profile/FillxPortfolioProfileHeader.tsx`: keep existing layout edits and update edit button accessible copy to Username.
- Modify generated `eolive/app/generated/fillx-backend-contract.ts` only by running the sync command.

## Username Rules

Use the same rules on both sides:

```ts
const FILLX_USERNAME_MAX_LENGTH = 25;
const FILLX_USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
```

Validation behavior:
- Trim surrounding whitespace before validation and before saving.
- Preserve typed case after trimming.
- Required for every profile update path handled by `identity.updateDisplayName`.
- Valid length is 3 through 25 characters after trimming.
- Only ASCII letters, numbers, and underscores are valid.
- Case-insensitive uniqueness is required.
- `null`, blank strings, and clearing an existing value are rejected.

Stable error codes:
- `USERNAME_REQUIRED`
- `INVALID_DISPLAY_NAME`
- `DISPLAY_NAME_TAKEN`

Frontend messages:
- `USERNAME_REQUIRED`: `Username is required.`
- `INVALID_DISPLAY_NAME` length: `Username must be between 3 and 25 characters.`
- `INVALID_DISPLAY_NAME` characters: `Username can only contain letters, numbers, and underscores.`
- `DISPLAY_NAME_TAKEN`: `Username is already taken.`

Tooltip copy:

```txt
Username must be unique and between 3 and 25 characters. Can only contain letters, numbers, and underscores.
```

---

### Task 0: Preserve Existing Frontend Header Work

**Files:**
- Inspect: `eolive/app/components/profile/FillxPortfolioProfileHeader.tsx`
- Inspect: `eolive/app/components/profile/fillxPortfolioProfileModel.ts`
- Inspect: `eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`

- [ ] **Step 1: Check current dirty state**

Run:

```bash
git -C eolive status --short
git -C fillx_backend status --short
```

Expected frontend output includes only these existing profile-header files before username work starts:

```txt
 M app/components/profile/FillxPortfolioProfileHeader.tsx
 M app/components/profile/fillxPortfolioProfileModel.test.ts
 M app/components/profile/fillxPortfolioProfileModel.ts
```

Expected backend output includes unrelated docs dated `2026-05-07`; leave them unstaged.

- [ ] **Step 2: Verify the existing frontend header work still passes**

Run:

```bash
cd eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts
yarn typecheck
```

Expected: both commands pass. If either command fails before username work begins, stop and fix only the existing profile-header failure before continuing.

- [ ] **Step 3: Commit the existing frontend header work before username edits**

Run:

```bash
git -C eolive add \
  app/components/profile/FillxPortfolioProfileHeader.tsx \
  app/components/profile/fillxPortfolioProfileModel.ts \
  app/components/profile/fillxPortfolioProfileModel.test.ts
git -C eolive commit -m "feat: refine FillX profile header"
```

Expected: a frontend commit containing only the existing header/model/test changes. This keeps the username work reviewable in separate commits.

---

### Task 1: Backend Service Username Rules

**Files:**
- Modify: `fillx_backend/server/src/identity/identity.service.test.ts`
- Modify: `fillx_backend/server/src/identity/identity.service.ts`
- Modify: `fillx_backend/server/src/identity/repositories.ts`

- [ ] **Step 1: Update the profile update test helper**

In `fillx_backend/server/src/identity/identity.service.test.ts`, replace `makeProfileUpdateService` with this version:

```ts
function makeProfileUpdateService(
  initialUser: FillxUser = makeUser(),
  otherUsers: FillxUser[] = [],
) {
  let stored = initialUser;
  const updates: Array<{
    userId: string;
    displayName?: string | null;
    nationality?: string | null;
  }> = [];

  const findMatchingDisplayName = (displayName: string) => {
    const normalized = displayName.toLowerCase();
    return [stored, ...otherUsers].find(
      (user) => user.display_name?.toLowerCase() === normalized,
    );
  };

  const service = createIdentityService({
    users: {
      findById: async (id) => (id === stored.id ? stored : undefined),
      findByDisplayNameCaseInsensitive: async (displayName) =>
        findMatchingDisplayName(displayName),
      createUser: async () => {
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
```

- [ ] **Step 2: Replace old display-name tests with username-rule tests**

In `fillx_backend/server/src/identity/identity.service.test.ts`, replace the existing tests from `updateProfile trims and updates display name without avatar fields` through `updateProfile clears display name with null` with:

```ts
test("updateProfile trims and updates username without avatar fields", async () => {
  const { service, updates } = makeProfileUpdateService();

  const result = await service.updateProfile({
    userId: "user-1",
    displayName: " FillX_Trader ",
  });

  assert.equal(result.display_name, "FillX_Trader");
  assert.deepEqual(updates, [
    {
      userId: "user-1",
      displayName: "FillX_Trader",
    },
  ]);
});

test("updateProfile normalizes lowercase nationality to uppercase for users with username", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User" }),
  );

  const result = await service.updateProfile({
    userId: "user-1",
    nationality: "us",
  });

  assert.equal(result.nationality, "US");
  assert.deepEqual(updates, [{ userId: "user-1", nationality: "US" }]);
});

test("updateProfile accepts uppercase nationality unchanged for users with username", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User" }),
  );

  const result = await service.updateProfile({
    userId: "user-1",
    nationality: "NG",
  });

  assert.equal(result.nationality, "NG");
  assert.deepEqual(updates, [{ userId: "user-1", nationality: "NG" }]);
});

test("updateProfile clears nationality with empty string or null for users with username", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User", nationality: "JP" }),
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
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User" }),
  );

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

test("updateProfile rejects non-ASCII nationality before writing", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User" }),
  );

  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "ß" }),
    /INVALID_NATIONALITY/,
  );
  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "ﬀ" }),
    /INVALID_NATIONALITY/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile preserves omitted fields and trims username", async () => {
  const { service } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User", nationality: "BR" }),
  );

  const displayNameResult = await service.updateProfile({
    userId: "user-1",
    displayName: "  New_Display  ",
  });
  const nationalityResult = await service.updateProfile({
    userId: "user-1",
    nationality: "ca",
  });

  assert.equal(displayNameResult.display_name, "New_Display");
  assert.equal(displayNameResult.nationality, "BR");
  assert.equal(nationalityResult.display_name, "New_Display");
  assert.equal(nationalityResult.nationality, "CA");
});

test("updateProfile requires a username before nationality-only updates", async () => {
  const { service, updates } = makeProfileUpdateService();

  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "US" }),
    /USERNAME_REQUIRED/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile rejects null and blank usernames before writing", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User" }),
  );

  await assert.rejects(
    service.updateProfile({ userId: "user-1", displayName: null }),
    /USERNAME_REQUIRED/,
  );
  await assert.rejects(
    service.updateProfile({ userId: "user-1", displayName: "   " }),
    /USERNAME_REQUIRED/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile rejects usernames outside the allowed length", async () => {
  const { service, updates } = makeProfileUpdateService();

  await assert.rejects(
    service.updateProfile({ userId: "user-1", displayName: "ab" }),
    /INVALID_DISPLAY_NAME/,
  );
  await assert.rejects(
    service.updateProfile({
      userId: "user-1",
      displayName: "abcdefghijklmnopqrstuvwxyz",
    }),
    /INVALID_DISPLAY_NAME/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile rejects usernames with invalid characters", async () => {
  const { service, updates } = makeProfileUpdateService();

  for (const displayName of [
    "FillX Trader",
    "fillx-trader",
    "fillx.trader",
    "Ålice",
    "交易员",
    "name!",
  ]) {
    await assert.rejects(
      service.updateProfile({ userId: "user-1", displayName }),
      /INVALID_DISPLAY_NAME/,
    );
  }

  assert.deepEqual(updates, []);
});

test("updateProfile rejects case-insensitive duplicate usernames", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ id: "user-1", display_name: "Current_User" }),
    [makeUser({ id: "user-2", display_name: "Alice_1" })],
  );

  await assert.rejects(
    service.updateProfile({ userId: "user-1", displayName: "alice_1" }),
    /DISPLAY_NAME_TAKEN/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile allows a user to keep their own username case-insensitively", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ id: "user-1", display_name: "Alice_1" }),
  );

  const result = await service.updateProfile({
    userId: "user-1",
    displayName: "alice_1",
  });

  assert.equal(result.display_name, "alice_1");
  assert.deepEqual(updates, [
    { userId: "user-1", displayName: "alice_1" },
  ]);
});
```

- [ ] **Step 3: Run backend service tests to verify failure**

Run:

```bash
cd fillx_backend
yarn workspace @fillx/server test -- src/identity/identity.service.test.ts
```

Expected: tests fail because `findByDisplayNameCaseInsensitive` is not in the repo type and service still allows `null`, spaces, duplicates, and nationality-only updates without a username.

- [ ] **Step 4: Add repository uniqueness lookup**

In `fillx_backend/server/src/identity/repositories.ts`, change the import:

```ts
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
```

Inside `createUsersRepo(db: DbLike)`, after `findById`, add:

```ts
    async findByDisplayNameCaseInsensitive(
      displayName: string,
    ): Promise<FillxUser | undefined> {
      return first(
        await db
          .select()
          .from(fillxUsers)
          .where(sql`lower(${fillxUsers.display_name}) = ${displayName.toLowerCase()}`)
          .limit(1),
      );
    },
```

- [ ] **Step 5: Replace backend display name normalization with username validation**

In `fillx_backend/server/src/identity/identity.service.ts`, replace `normalizeDisplayName` with:

```ts
const FILLX_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,25}$/;
const DISPLAY_NAME_UNIQUE_INDEX = "fillx_users_display_name_lower_unique_idx";

function normalizeDisplayName(input: string | null): string {
  if (input === null) throw new Error("USERNAME_REQUIRED");

  const displayName = input.trim();
  if (displayName.length === 0) throw new Error("USERNAME_REQUIRED");
  if (!FILLX_USERNAME_PATTERN.test(displayName)) {
    throw new Error("INVALID_DISPLAY_NAME");
  }

  return displayName;
}

function hasValidDisplayName(displayName: string | null): displayName is string {
  return displayName !== null && FILLX_USERNAME_PATTERN.test(displayName);
}

function isDisplayNameUniqueViolation(error: unknown): boolean {
  const pgError = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  };
  return (
    pgError.code === "23505" &&
    (pgError.constraint === DISPLAY_NAME_UNIQUE_INDEX ||
      String(pgError.message ?? "").includes(DISPLAY_NAME_UNIQUE_INDEX))
  );
}
```

- [ ] **Step 6: Extend the service repo type**

In `fillx_backend/server/src/identity/identity.service.ts`, add `findByDisplayNameCaseInsensitive` to `IdentityRepos.users`:

```ts
    findByDisplayNameCaseInsensitive?: (
      displayName: string,
    ) => Promise<FillxUser | undefined>;
```

The `users` repo type should now contain:

```ts
  users: {
    findById?: (id: string) => Promise<FillxUser | undefined>;
    findByDisplayNameCaseInsensitive?: (
      displayName: string,
    ) => Promise<FillxUser | undefined>;
    createUser?: () => Promise<FillxUser>;
    updateProfile: (input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
    }) => Promise<FillxUser>;
  };
```

- [ ] **Step 7: Replace `updateProfile` service logic**

In `fillx_backend/server/src/identity/identity.service.ts`, replace the body of `async updateProfile(...)` with:

```ts
      if (!repos.users.findById || !repos.users.findByDisplayNameCaseInsensitive) {
        throw new Error("IDENTITY_REPO_INCOMPLETE");
      }

      const existing = await repos.users.findById(input.userId);
      if (!existing) throw new Error("USER_NOT_FOUND");

      const update: {
        userId: string;
        displayName?: string | null;
        nationality?: string | null;
      } = { userId: input.userId };

      const normalizedDisplayName =
        input.displayName === undefined
          ? undefined
          : normalizeDisplayName(input.displayName);

      if (input.nationality !== undefined) {
        update.nationality = normalizeNationality(input.nationality);
      }
      if (normalizedDisplayName !== undefined) {
        const existingWithDisplayName =
          await repos.users.findByDisplayNameCaseInsensitive(
            normalizedDisplayName,
          );
        if (
          existingWithDisplayName &&
          existingWithDisplayName.id !== input.userId
        ) {
          throw new Error("DISPLAY_NAME_TAKEN");
        }
        update.displayName = normalizedDisplayName;
      }
      if (
        update.displayName === undefined &&
        update.nationality === undefined
      ) {
        throw new Error("PROFILE_UPDATE_EMPTY");
      }

      const nextDisplayName =
        update.displayName === undefined
          ? existing.display_name
          : update.displayName;
      if (!hasValidDisplayName(nextDisplayName)) {
        throw new Error("USERNAME_REQUIRED");
      }

      try {
        return await repos.users.updateProfile(update);
      } catch (error) {
        if (isDisplayNameUniqueViolation(error)) {
          throw new Error("DISPLAY_NAME_TAKEN");
        }
        throw error;
      }
```

- [ ] **Step 8: Run backend service tests to verify pass**

Run:

```bash
cd fillx_backend
yarn workspace @fillx/server test -- src/identity/identity.service.test.ts
```

Expected: all tests in `identity.service.test.ts` pass.

- [ ] **Step 9: Commit backend service rules**

Run:

```bash
git -C fillx_backend add \
  server/src/identity/identity.service.ts \
  server/src/identity/identity.service.test.ts \
  server/src/identity/repositories.ts
git -C fillx_backend commit -m "feat: validate display names as usernames"
```

Expected: commit includes only the three listed files.

---

### Task 2: Backend API Errors, Contract, Migration, And Context

**Files:**
- Modify: `fillx_backend/server/src/identity/errors.ts`
- Modify: `fillx_backend/server/src/identity/errors.test.ts`
- Modify: `fillx_backend/server/src/routes/identity.ts`
- Modify: `fillx_backend/shared/src/contract.ts`
- Modify: `fillx_backend/server/src/db/schema.ts`
- Create: `fillx_backend/server/src/db/migrations/0006_displayname_username_validation.sql`
- Create: `fillx_backend/server/src/db/migrations/meta/0006_snapshot.json`
- Modify: `fillx_backend/server/src/db/migrations/meta/_journal.json`
- Modify: `fillx_backend/e2e/identity-profile.e2e.test.ts`
- Modify: `fillx_backend/CONTEXT.md`

- [ ] **Step 1: Add failing API error tests**

Append this test to `fillx_backend/server/src/identity/errors.test.ts`:

```ts
test("IdentityApiError maps username profile errors to stable statuses", () => {
  const required = apiError("USERNAME_REQUIRED");
  const invalid = apiError("INVALID_DISPLAY_NAME");
  const taken = apiError("DISPLAY_NAME_TAKEN");

  assert.equal(required.status, 400);
  assert.equal(required.toJSON().message, "USERNAME_REQUIRED");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.toJSON().message, "INVALID_DISPLAY_NAME");
  assert.equal(taken.status, 409);
  assert.equal(taken.toJSON().message, "DISPLAY_NAME_TAKEN");
});
```

- [ ] **Step 2: Run error tests to verify failure**

Run:

```bash
cd fillx_backend
yarn workspace @fillx/server test -- src/identity/errors.test.ts
```

Expected: TypeScript/runtime failure because `ApiErrorCode` does not include the three new codes.

- [ ] **Step 3: Add new API error codes**

In `fillx_backend/server/src/identity/errors.ts`, add these variants to `ApiErrorCode`:

```ts
  | "USERNAME_REQUIRED"
  | "INVALID_DISPLAY_NAME"
  | "DISPLAY_NAME_TAKEN"
```

In `statusForApiError`, add `USERNAME_REQUIRED` and `INVALID_DISPLAY_NAME` to the `400` group:

```ts
    case "CHALLENGE_EXPIRED":
    case "SIGNATURE_INVALID":
    case "AVATAR_UPLOAD_EXPIRED":
    case "AVATAR_UPLOAD_OBJECT_MISMATCH":
    case "USERNAME_REQUIRED":
    case "INVALID_DISPLAY_NAME":
      return 400;
```

Add `DISPLAY_NAME_TAKEN` to the `409` group:

```ts
    case "PRIMARY_WALLET_ALREADY_SET":
    case "CHALLENGE_ALREADY_USED":
    case "AVATAR_UPLOAD_ALREADY_FINALIZED":
    case "DISPLAY_NAME_TAKEN":
      return 409;
```

- [ ] **Step 4: Run error tests to verify pass**

Run:

```bash
cd fillx_backend
yarn workspace @fillx/server test -- src/identity/errors.test.ts
```

Expected: all tests in `errors.test.ts` pass.

- [ ] **Step 5: Map service errors at the identity route boundary**

In `fillx_backend/server/src/routes/identity.ts`, add this helper after `serializePublicProfile`:

```ts
function profileUpdateError(error: unknown): never {
  if (error instanceof Error) {
    switch (error.message) {
      case "USERNAME_REQUIRED":
        throw apiError("USERNAME_REQUIRED");
      case "INVALID_DISPLAY_NAME":
        throw apiError("INVALID_DISPLAY_NAME");
      case "DISPLAY_NAME_TAKEN":
        throw apiError("DISPLAY_NAME_TAKEN");
      case "USER_NOT_FOUND":
        throw apiError("USER_NOT_FOUND");
    }
  }

  throw error;
}
```

Then replace the `updateDisplayName` handler body with:

```ts
    updateDisplayName: pub.identity.updateDisplayName.handler(
      async ({ input, context }) =>
        protectedProcedure(context, async ({ user }) => {
          const repos = createIdentityRepos(context.db);
          const service = createIdentityService({
            users: repos.users,
            authIdentities: repos.authIdentities,
          });

          try {
            const updated = await service.updateProfile({
              userId: user.id,
              displayName: input.displayName,
              nationality: input.nationality,
            });
            return { user: serializeUser(updated) };
          } catch (error) {
            profileUpdateError(error);
          }
        }),
    ),
```

- [ ] **Step 6: Make the contract defer shape validation to the service**

In `fillx_backend/shared/src/contract.ts`, replace the `updateDisplayName` input object with:

```ts
        z.object({
          displayName: z.string().nullable().optional(),
          nationality: z.string().nullable().optional(),
        }),
```

This keeps `null` and long strings from being rejected by zod before the service can return `USERNAME_REQUIRED` or `INVALID_DISPLAY_NAME`.

- [ ] **Step 7: Update Drizzle schema constraints**

In `fillx_backend/server/src/db/schema.ts`, replace the `displayNameCheck` block with this block and add the unique index in the same returned object:

```ts
    displayNameLowerUniqueIdx: uniqueIndex(
      "fillx_users_display_name_lower_unique_idx",
    )
      .on(sql`lower(${table.display_name})`)
      .where(sql`${table.display_name} is not null`),
    displayNameCheck: check(
      "fillx_users_display_name_check",
      sql`${table.display_name} is null or ${table.display_name} ~ '^[A-Za-z0-9_]{3,25}$'`,
    ),
```

The start of the returned object should now look like:

```ts
  (table) => ({
    displayNameLowerUniqueIdx: uniqueIndex(
      "fillx_users_display_name_lower_unique_idx",
    )
      .on(sql`lower(${table.display_name})`)
      .where(sql`${table.display_name} is not null`),
    displayNameCheck: check(
      "fillx_users_display_name_check",
      sql`${table.display_name} is null or ${table.display_name} ~ '^[A-Za-z0-9_]{3,25}$'`,
    ),
    nationalityCheck: check(
      "fillx_users_nationality_check",
      sql`${table.nationality} is null or ${table.nationality} ~ '^[A-Z]{2}$'`,
    ),
  }),
```

- [ ] **Step 8: Generate migration metadata**

Run:

```bash
cd fillx_backend/server
yarn db:generate --name displayname_username_validation
```

Expected created/modified files:

```txt
server/src/db/migrations/0006_displayname_username_validation.sql
server/src/db/migrations/meta/0006_snapshot.json
server/src/db/migrations/meta/_journal.json
```

- [ ] **Step 9: Replace generated SQL with deterministic cleanup plus constraints**

Replace the entire contents of `fillx_backend/server/src/db/migrations/0006_displayname_username_validation.sql` with:

```sql
ALTER TABLE "fillx_users" DROP CONSTRAINT IF EXISTS "fillx_users_display_name_check";--> statement-breakpoint
WITH ranked_display_names AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY lower("display_name")
      ORDER BY "created_at" ASC, "id" ASC
    ) AS display_name_rank
  FROM "fillx_users"
  WHERE "display_name" IS NOT NULL
    AND "display_name" ~ '^[A-Za-z0-9_]{3,25}$'
),
display_names_to_clear AS (
  SELECT "id"
  FROM "fillx_users"
  WHERE "display_name" IS NOT NULL
    AND "display_name" !~ '^[A-Za-z0-9_]{3,25}$'
  UNION
  SELECT "id"
  FROM ranked_display_names
  WHERE display_name_rank > 1
)
UPDATE "fillx_users"
SET
  "display_name" = NULL,
  "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM display_names_to_clear);--> statement-breakpoint
ALTER TABLE "fillx_users" ADD CONSTRAINT "fillx_users_display_name_check" CHECK ("fillx_users"."display_name" is null or "fillx_users"."display_name" ~ '^[A-Za-z0-9_]{3,25}$');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fillx_users_display_name_lower_unique_idx" ON "fillx_users" USING btree (lower("display_name")) WHERE "display_name" IS NOT NULL;
```

- [ ] **Step 10: Update backend E2E display name fixtures**

In `fillx_backend/e2e/identity-profile.e2e.test.ts`, replace the public profile test's invalid username:

```ts
  await activeWalletClient.identity.updateDisplayName({
    displayName: "FillX_Trader",
    nationality: "US",
  });
```

and replace the assertion:

```ts
  assert.equal(profile.profiles[0].displayName, "FillX_Trader");
```

- [ ] **Step 11: Add duplicate username E2E coverage if the existing helpers can verify two users without new infrastructure**

If `identity-profile.e2e.test.ts` already has a second wallet/client helper in the file, append this test:

```ts
test("profile update rejects case-insensitive duplicate usernames", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);
  const current = await verifyEvmWalletProfile(client);
  assert.equal(current.state, "authenticated");

  const { client: activeWalletClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(evmWalletKey(evmWallet.address)),
  });
  await activeWalletClient.identity.updateDisplayName({
    displayName: "Alice_1",
    nationality: "US",
  });

  const secondJar = new CookieJar();
  const { client: secondClient, cookieJar: secondCookieJar } = createClient({
    baseUrl,
    cookieJar: secondJar,
  });
  const secondCurrent = await verifySolanaWalletProfile(secondClient);
  assert.equal(secondCurrent.state, "authenticated");

  const { client: secondActiveWalletClient } = createClient({
    baseUrl,
    cookieJar: secondCookieJar,
    headers: activeWalletHeaders(solanaWalletKey(solanaWallet.address)),
  });

  await assert.rejects(
    secondActiveWalletClient.identity.updateDisplayName({
      displayName: "alice_1",
      nationality: "CA",
    }),
    /DISPLAY_NAME_TAKEN/,
  );
});
```

If `verifySolanaWalletProfile`, `solanaWallet`, `solanaWalletKey`, or `CookieJar` are not available in the file, skip this E2E addition and rely on the service test from Task 1. Do not create new wallet-signature helpers in this task.

- [ ] **Step 12: Update backend context language**

In `fillx_backend/CONTEXT.md`, replace this sentence:

```md
FillX profile identity is anchored by verified wallets. A profile may have editable display metadata such as display name, avatar, and nationality, but display name is nullable and not unique. Public UI should render `displayName || shortened primary wallet address`.
```

with:

```md
FillX profile identity is anchored by verified wallets. A profile may have editable display metadata such as username-backed `displayName`, avatar, and nationality. `displayName` remains nullable for legacy profiles but, when present, is unique case-insensitively and follows username syntax. Public UI should render `displayName || shortened primary wallet address`.
```

Replace this definition:

```md
**Display Metadata**:
Editable public profile fields such as display name, avatar, and nationality. Display name is nullable and not unique.
_Avoid_: identity proof, unique handle
```

with:

```md
**Display Metadata**:
Editable public profile fields such as username-backed `displayName`, avatar, and nationality. `displayName` is the public username label, but it does not prove profile identity.
_Avoid_: identity proof
```

Replace this relationship:

```md
- A **User Profile** is anchored by verified wallet bindings and may have nullable, non-unique **Display Metadata**.
```

with:

```md
- A **User Profile** is anchored by verified wallet bindings and may have nullable **Display Metadata**; a non-null `displayName` is a unique public username label.
```

Replace this dialogue:

```md
> **Dev:** "Can display name prove that two requests belong to the same FillX user?"
> **Domain expert:** "No. Display name is nullable and not unique. Verified wallet bindings anchor profile identity."
```

with:

```md
> **Dev:** "Can displayName prove that two requests belong to the same FillX user?"
> **Domain expert:** "No. displayName is a unique public username label when present, but verified wallet bindings anchor profile identity."
```

- [ ] **Step 13: Run backend checks for Task 2**

Run:

```bash
cd fillx_backend
yarn workspace @fillx/server test -- src/identity/errors.test.ts src/identity/identity.service.test.ts
yarn check
```

Expected: both commands pass. If `yarn check` fails only because the optional duplicate E2E test references unavailable helpers, remove that optional E2E test and run `yarn check` again.

- [ ] **Step 14: Commit backend API and database enforcement**

Run:

```bash
git -C fillx_backend add \
  CONTEXT.md \
  shared/src/contract.ts \
  server/src/db/schema.ts \
  server/src/db/migrations/0006_displayname_username_validation.sql \
  server/src/db/migrations/meta/0006_snapshot.json \
  server/src/db/migrations/meta/_journal.json \
  server/src/identity/errors.ts \
  server/src/identity/errors.test.ts \
  server/src/routes/identity.ts \
  e2e/identity-profile.e2e.test.ts
git -C fillx_backend commit -m "feat: enforce username display names"
```

Expected: commit excludes the unrelated `docs/superpowers/...2026-05-07...` files.

---

### Task 3: Frontend Profile Editor Model Rules

**Files:**
- Modify: `eolive/app/components/profile/fillxPortfolioProfileModel.ts`
- Modify: `eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`

- [ ] **Step 1: Add failing frontend model tests**

Append these tests to `eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`:

```ts
test("getFillxProfileEditorState validates and trims usernames", () => {
  assert.deepEqual(
    getFillxProfileEditorState({
      initialDisplayName: null,
      displayName: " FillX_Trader ",
      initialNationality: null,
      nationality: "",
    }),
    {
      displayNameError: null,
      nationalityError: null,
      canSave: true,
      updateInput: {
        displayName: "FillX_Trader",
      },
    },
  );
});

test("getFillxProfileEditorState requires username before nationality changes", () => {
  assert.deepEqual(
    getFillxProfileEditorState({
      initialDisplayName: null,
      displayName: "",
      initialNationality: null,
      nationality: "US",
    }),
    {
      displayNameError: "Username is required.",
      nationalityError: null,
      canSave: false,
      updateInput: {},
    },
  );
});

test("getFillxProfileEditorState rejects usernames outside the allowed length", () => {
  const tooShort = getFillxProfileEditorState({
    initialDisplayName: null,
    displayName: "ab",
    initialNationality: null,
    nationality: "",
  });
  const tooLong = getFillxProfileEditorState({
    initialDisplayName: null,
    displayName: "abcdefghijklmnopqrstuvwxyz",
    initialNationality: null,
    nationality: "",
  });

  assert.equal(
    tooShort.displayNameError,
    "Username must be between 3 and 25 characters.",
  );
  assert.equal(tooShort.canSave, false);
  assert.deepEqual(tooShort.updateInput, {});
  assert.equal(
    tooLong.displayNameError,
    "Username must be between 3 and 25 characters.",
  );
  assert.equal(tooLong.canSave, false);
  assert.deepEqual(tooLong.updateInput, {});
});

test("getFillxProfileEditorState accepts exactly 25 username characters", () => {
  const state = getFillxProfileEditorState({
    initialDisplayName: null,
    displayName: "abcdefghijklmnopqrstuvwxy",
    initialNationality: null,
    nationality: "",
  });

  assert.equal(state.displayNameError, null);
  assert.equal(state.canSave, true);
  assert.deepEqual(state.updateInput, {
    displayName: "abcdefghijklmnopqrstuvwxy",
  });
});

test("getFillxProfileEditorState rejects usernames with invalid characters", () => {
  for (const displayName of [
    "FillX Trader",
    "fillx-trader",
    "fillx.trader",
    "Ålice",
    "交易员",
    "name!",
  ]) {
    const state = getFillxProfileEditorState({
      initialDisplayName: null,
      displayName,
      initialNationality: null,
      nationality: "",
    });

    assert.equal(
      state.displayNameError,
      "Username can only contain letters, numbers, and underscores.",
    );
    assert.equal(state.canSave, false);
    assert.deepEqual(state.updateInput, {});
  }
});
```

- [ ] **Step 2: Update old frontend fixtures that contain spaces**

In `eolive/app/components/profile/fillxPortfolioProfileModel.test.ts`, update the existing profile-editor tests:

```ts
initialDisplayName: "FillX",
displayName: " FillX_Trader ",
```

and expected update input:

```ts
displayName: "FillX_Trader",
```

For tests that keep an existing display name while checking nationality, use:

```ts
initialDisplayName: "FillX",
displayName: "FillX",
```

Do not change summary tests that intentionally display `"Fill X"` as legacy public metadata; the profile summary should still render server data as received.

- [ ] **Step 3: Run frontend model tests to verify failure**

Run:

```bash
cd eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts
```

Expected: failures because the model still allows blanks, spaces, hyphens, and 50 characters.

- [ ] **Step 4: Implement frontend username constants and validation**

In `eolive/app/components/profile/fillxPortfolioProfileModel.ts`, change:

```ts
export type FillxProfileUpdateInput = {
  displayName?: string | null;
  nationality?: string | null;
};
```

to:

```ts
export type FillxProfileUpdateInput = {
  displayName?: string;
  nationality?: string | null;
};
```

After `shortenAddress`, add:

```ts
export const FILLX_USERNAME_MAX_LENGTH = 25;

const FILLX_USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

function getUsernameError(displayName: string | null): string | null {
  if (displayName === null) return "Username is required.";
  if (
    displayName.length < 3 ||
    displayName.length > FILLX_USERNAME_MAX_LENGTH
  ) {
    return "Username must be between 3 and 25 characters.";
  }
  if (!FILLX_USERNAME_PATTERN.test(displayName)) {
    return "Username can only contain letters, numbers, and underscores.";
  }
  return null;
}
```

In `getFillxProfileEditorState`, replace:

```ts
  const displayNameError =
    displayName && displayName.length > 50
      ? "Display name must be 50 characters or fewer."
      : null;
```

with:

```ts
  const displayNameError = getUsernameError(displayName);
```

Keep the existing `updateInput` construction:

```ts
  if (!displayNameError && displayName !== initialDisplayName) {
    updateInput.displayName = displayName;
  }
```

Because `displayNameError` is non-null for blank values, `updateInput.displayName` will no longer receive `null`.

- [ ] **Step 5: Run frontend model tests to verify pass**

Run:

```bash
cd eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts
```

Expected: all tests in `fillxPortfolioProfileModel.test.ts` pass.

- [ ] **Step 6: Commit frontend model rules**

Run:

```bash
git -C eolive add \
  app/components/profile/fillxPortfolioProfileModel.ts \
  app/components/profile/fillxPortfolioProfileModel.test.ts
git -C eolive commit -m "feat: validate FillX usernames in profile editor"
```

Expected: commit includes only the frontend model and model test changes from this task.

---

### Task 4: Frontend Dialog UX And Username Copy

**Files:**
- Modify: `eolive/app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx`
- Modify: `eolive/app/hooks/useFillxProfileEditor.ts`
- Modify: `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.ts`
- Modify: `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts`
- Modify: `eolive/app/components/profile/PublicProfileCard.tsx`
- Modify: `eolive/app/components/profile/FillxPortfolioProfileHeader.tsx`

- [ ] **Step 1: Update account sheet copy test**

In `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts`, replace the expected no-profile label:

```ts
    "Create Username",
```

The old expected value was `"Create profile"`.

- [ ] **Step 2: Run account sheet copy test to verify failure**

Run:

```bash
cd eolive
npx tsx --test app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts
```

Expected: one failure because the production copy still returns `Create profile`.

- [ ] **Step 3: Update account sheet copy**

In `eolive/app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.ts`, replace:

```ts
  if (input.fillxState === "no_profile") return "Create profile";
```

with:

```ts
  if (input.fillxState === "no_profile") return "Create Username";
```

- [ ] **Step 4: Run account sheet copy test to verify pass**

Run:

```bash
cd eolive
npx tsx --test app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts
```

Expected: all tests in `accountSheetIdentity.test.ts` pass.

- [ ] **Step 5: Update profile editor placeholder**

In `eolive/app/hooks/useFillxProfileEditor.ts`, replace `toDisplayNamePlaceholder` with:

```ts
function toDisplayNamePlaceholder() {
  return "Enter username";
}
```

Then update its call site from:

```ts
          displayNamePlaceholder: toDisplayNamePlaceholder(user),
```

to:

```ts
          displayNamePlaceholder: toDisplayNamePlaceholder(),
```

- [ ] **Step 6: Add dialog imports and constants**

In `eolive/app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx`, change the Orderly import to include `Tooltip`:

```ts
import {
  Button,
  Flex,
  Input,
  Text,
  Tooltip,
  registerSimpleDialog,
} from "@orderly.network/ui";
```

Change the profile model import to:

```ts
import {
  FILLX_USERNAME_MAX_LENGTH,
  getFillxProfileEditorState,
} from "@/components/profile/fillxPortfolioProfileModel";
```

Add the tooltip icon import:

```ts
import { TooltipIcon } from "@/customOrderlyComponents/ui-transfer/components/icons/tooltipIcon";
```

After the props type, add:

```ts
const USERNAME_TOOLTIP =
  "Username must be unique and between 3 and 25 characters. Can only contain letters, numbers, and underscores.";

function profileSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case "USERNAME_REQUIRED":
      return "Username is required.";
    case "INVALID_DISPLAY_NAME":
      return "Username must be unique and between 3 and 25 characters. Can only contain letters, numbers, and underscores.";
    case "DISPLAY_NAME_TAKEN":
      return "Username is already taken.";
    default:
      return message;
  }
}
```

- [ ] **Step 7: Add dynamic dialog title**

In `FillxProfileDialog`, after `canSave`, add:

```ts
  const dialogTitle = props.initialDisplayName.trim()
    ? "Edit Username"
    : "Create Username";
```

At the start of the returned `<form>`, before the avatar `<Flex>`, add:

```tsx
      <Text.formatted size="base" weight="semibold" intensity={98}>
        {dialogTitle}
      </Text.formatted>
```

At the bottom of the file, change:

```ts
registerSimpleDialog(fillxProfileDialogId, Dialog, {
  size: "sm",
  title: "Edit Fillx profile",
});
```

to:

```ts
registerSimpleDialog(fillxProfileDialogId, Dialog, {
  size: "sm",
});
```

- [ ] **Step 8: Replace display name field with Username label, tooltip, and counter**

In `fillxProfileDialog.tsx`, replace the display-name field block:

```tsx
      <Flex direction="column" gap={2} itemAlign="start" width="100%">
        <label
          htmlFor="fillx-profile-display-name"
          className="oui-text-2xs oui-font-medium oui-text-base-contrast-54"
        >
          Display name
        </label>
        <Input
          id="fillx-profile-display-name"
          value={displayName}
          maxLength={50}
          placeholder={props.displayNamePlaceholder}
          className="oui-w-full"
          onValueChange={changeDisplayName}
        />
      </Flex>
```

with:

```tsx
      <Flex direction="column" gap={2} itemAlign="start" width="100%">
        <Flex itemAlign="center" justify="between" width="100%">
          <Flex itemAlign="center" gap={1}>
            <label
              htmlFor="fillx-profile-username"
              className="oui-text-2xs oui-font-medium oui-text-base-contrast-54"
            >
              Username
            </label>
            <Tooltip className="oui-max-w-[260px] oui-p-2" content={USERNAME_TOOLTIP}>
              <TooltipIcon
                aria-label="Username requirements"
                className="oui-cursor-pointer oui-text-base-contrast-36"
              />
            </Tooltip>
          </Flex>
          <Text.formatted size="2xs" intensity={54}>
            {displayName.length}/{FILLX_USERNAME_MAX_LENGTH}
          </Text.formatted>
        </Flex>
        <Input
          id="fillx-profile-username"
          value={displayName}
          maxLength={FILLX_USERNAME_MAX_LENGTH}
          placeholder={props.displayNamePlaceholder}
          className="oui-w-full"
          onValueChange={changeDisplayName}
        />
      </Flex>
```

- [ ] **Step 9: Map backend save errors to Username messages**

In `fillxProfileDialog.tsx`, replace:

```ts
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
```

with:

```ts
    } catch (caught) {
      setError(profileSaveErrorMessage(caught));
    } finally {
```

- [ ] **Step 10: Update public profile card action copy**

In `eolive/app/components/profile/PublicProfileCard.tsx`, replace:

```tsx
          {user || publicProfile ? "Edit" : "Create profile"}
```

with:

```tsx
          {user || publicProfile ? "Edit Username" : "Create Username"}
```

- [ ] **Step 11: Update portfolio profile header edit accessible copy**

In `eolive/app/components/profile/FillxPortfolioProfileHeader.tsx`, replace:

```tsx
                aria-label="Edit profile"
```

with:

```tsx
                aria-label="Edit username"
```

If the button has a `title` prop with old profile copy, set it to:

```tsx
                title="Edit username"
```

Keep the existing icon-only inline button, no `Edit` text, no container border, and no container padding.

- [ ] **Step 12: Run frontend targeted tests**

Run:

```bash
cd eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts
npx tsx --test app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts
```

Expected: both test commands pass.

- [ ] **Step 13: Run frontend typecheck**

Run:

```bash
cd eolive
yarn typecheck
```

Expected: typecheck passes. If `Tooltip` content typing rejects a plain string, wrap the content in:

```tsx
<Text.formatted size="2xs" intensity={80}>
  {USERNAME_TOOLTIP}
</Text.formatted>
```

and rerun `yarn typecheck`.

- [ ] **Step 14: Commit frontend dialog UX**

Run:

```bash
git -C eolive add \
  app/components/profile/FillxPortfolioProfileHeader.tsx \
  app/components/profile/PublicProfileCard.tsx \
  app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.ts \
  app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts \
  app/customOrderlyComponents/ui-order-entry/components/dialog/fillxProfileDialog.tsx \
  app/hooks/useFillxProfileEditor.ts
git -C eolive commit -m "feat: show display names as usernames"
```

Expected: commit includes only the frontend UI/copy changes from this task.

---

### Task 5: Contract Sync And Final Verification

**Files:**
- Modify by command: `eolive/app/generated/fillx-backend-contract.ts`

- [ ] **Step 1: Sync frontend backend contract**

Run:

```bash
cd eolive
yarn sync:fillx-contract --source ../fillx_backend/shared/src/contract.ts
```

Expected: `eolive/app/generated/fillx-backend-contract.ts` updates the `identity.updateDisplayName` input so `displayName` no longer has the old `.max(50)` cap.

- [ ] **Step 2: Commit generated contract sync if it changed**

Run:

```bash
git -C eolive status --short app/generated/fillx-backend-contract.ts
```

If the file is modified, run:

```bash
git -C eolive add app/generated/fillx-backend-contract.ts
git -C eolive commit -m "chore: sync FillX backend contract"
```

Expected: commit contains only `app/generated/fillx-backend-contract.ts`.

- [ ] **Step 3: Run backend verification**

Run:

```bash
cd fillx_backend
yarn workspace @fillx/server test
yarn check
```

Expected: both commands pass.

- [ ] **Step 4: Run frontend verification**

Run:

```bash
cd eolive
npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts
npx tsx --test app/customOrderlyComponents/Trading/components/mobile/accountSheet/accountSheetIdentity.test.ts
yarn typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Inspect final dirty state**

Run:

```bash
git -C eolive status --short
git -C fillx_backend status --short
```

Expected frontend: clean, or only files intentionally left uncommitted by the execution owner.

Expected backend: clean except these unrelated pre-existing docs if they were not committed by their owner:

```txt
 M docs/superpowers/plans/2026-05-07-username-identity-e2e.md
 M docs/superpowers/specs/2026-05-07-username-e2e-design.md
```

- [ ] **Step 6: Report implementation summary**

Report:
- Backend service, API, and database now enforce username rules while keeping `displayName` / `display_name`.
- Frontend dialog says Create/Edit Username, shows Username label, tooltip icon, `current/25` counter, and maps backend username errors.
- User-facing app copy now says Username for profile creation/editing paths.
- Verification command results with pass/fail status.

## Self-Review

Spec coverage:
- User-facing display name is labeled Username in the dialog and profile creation/editing action copy.
- Dialog title is `Create Username` when `initialDisplayName.trim()` is empty and `Edit Username` otherwise.
- Dialog input has a character counter and `maxLength={25}`.
- Existing `TooltipIcon` is reused with exact tooltip copy.
- Backend service validates trim, required, 3-25 length, ASCII letters/numbers/underscore, no clearing, and case-insensitive uniqueness.
- Database migration clears invalid legacy values and duplicate lowercased values before adding the check and index.

Placeholder scan:
- The plan contains no placeholder marker text and no missing code for required code steps.

Type consistency:
- Public field name remains `displayName`.
- Database field remains `display_name`.
- User-facing copy says `Username`.
- Error codes are `USERNAME_REQUIRED`, `INVALID_DISPLAY_NAME`, and `DISPLAY_NAME_TAKEN`.
