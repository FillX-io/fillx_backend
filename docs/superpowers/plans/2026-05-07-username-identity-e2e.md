# Username Identity E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend username E2E coverage with per-test databases, then make FillX identity behavior match the long-term proof model: no anonymous persistent users, no client-supplied `userId`, wallet-proof username claim, Privy isolation, and HTTP-only FillX session cookies.

**Architecture:** Keep the backend's oRPC API as the test surface by extracting a side-effect-free HTTP server factory and starting it on a random port per E2E test. Move identity proof decisions into focused identity modules: FillX sessions authenticate current users, wallet signatures prove wallet-owned username claims, Privy tokens resolve Privy users, and guest current-user calls return a non-persistent response. Update `eolive` only where the backend contract change requires it.

**Tech Stack:** TypeScript, Node 20 test runner, tsx, oRPC, Drizzle ORM, PostgreSQL, jose, viem, tweetnacl, bs58, Remix/React in `eolive`.

---

## Scope Notes

- Backend source repo: `/home/fillx/eolive/dev/fillx_backend`.
- Frontend source repo: `/home/fillx/eolive/dev/eolive`.
- Preserve unrelated dirty changes. The current backend worktree already contains uncommitted username implementation files under `server/src/identity/`, schema changes, and migration files. Build on them instead of resetting or reverting them.
- Do not add Playwright or frontend E2E.
- Use one Postgres database per E2E test and drop it in teardown.
- At execution time, start from an isolated worktree with `superpowers:using-git-worktrees` if the current dirty workspace is still shared.

## File Structure

Backend files to create:

- `server/src/app.ts`: constructs the HTTP server without listening, configures oRPC plugins, health route, REST compatibility, and oRPC context creation.
- `server/src/identity/session.ts`: signs and verifies FillX JWT sessions and builds `fillx-session` cookies.
- `server/src/identity/session.test.ts`: unit coverage for session JWT verification and cookie flags.
- `server/src/identity/profile-lookup.ts`: normalizes public wallet lookup inputs without lowercasing Solana addresses.
- `e2e/helpers/database.ts`: creates, migrates, terminates, and drops one Postgres database per test.
- `e2e/helpers/server.ts`: starts/stops the test HTTP server and resets the cached app DB.
- `e2e/helpers/session.ts`: cookie jar for E2E clients.
- `e2e/helpers/client.ts`: oRPC client factory with per-test headers and cookie capture.
- `e2e/helpers/wallets.ts`: deterministic EVM and Solana wallets plus message-signing helpers.
- `e2e/helpers/privy.ts`: test Privy ES256 keypair and token generator.
- `e2e/helpers/harness.ts`: `setupE2E()` wrapper that combines database, env, server, and clients.
- `e2e/username.e2e.test.ts`: required backend API E2E scenarios.

Backend files to modify:

- `package.json`: add root `test:e2e`.
- `server/package.json`: add server `test:e2e` and `@orpc/client` for E2E clients.
- `server/src/db/client.ts`: keep the cached Drizzle client but retain the pool and expose `closeDb()` / `resetDbForTests()`.
- `server/src/db/schema.ts`: make username claim challenges support wallet-only pre-user challenges.
- `server/src/db/migrations/0001_faithful_archangel.sql`: keep the uncommitted username migration consistent with schema changes.
- `server/src/db/migrations/meta/0001_snapshot.json`: regenerate or update the uncommitted Drizzle snapshot to match the schema.
- `server/src/db/migrations/meta/_journal.json`: keep the uncommitted Drizzle journal consistent with the migration files.
- `server/src/index.ts`: production-only listen entrypoint.
- `server/src/router.ts`: remove wallet hint current-user behavior, remove username `userId` inputs, issue FillX session cookies, and normalize profile lookups correctly.
- `server/src/identity/auth.ts`: add FillX session auth and prioritize explicit Privy bearer tokens over existing FillX cookies.
- `server/src/identity/context.ts`: include `resHeaders` support for oRPC response headers.
- `server/src/identity/identity.service.ts`: return guest responses for anonymous calls and create real users only after verified auth.
- `server/src/identity/identity.service.test.ts`: cover anonymous guest behavior and Privy creation.
- `server/src/identity/repositories.ts`: add user creation helpers and support nullable challenge `user_id`.
- `server/src/identity/username.service.ts`: remove client `userId`, store wallet-only challenges, create or resolve wallet-backed users at claim time, and consume challenges atomically.
- `server/src/identity/username.service.test.ts`: cover wallet-only claim, replay, expiry, invalid signature, contention, and primary-wallet mismatch.
- `server/src/identity/errors.ts`: add concrete API error codes needed by the new flow.
- `shared/src/contract.ts`: update oRPC identity and username contracts.

Frontend files to modify:

- `/home/fillx/eolive/dev/eolive/app/generated/fillx-backend-contract.ts`: sync from backend contract.
- `/home/fillx/eolive/dev/eolive/app/api/identity.ts`: update current-user response types and preserve cookie credentials.
- `/home/fillx/eolive/dev/eolive/app/hooks/useCurrentFillxUser.ts`: stop sending wallet hints to current-user API.
- `/home/fillx/eolive/dev/eolive/app/components/profile/PublicProfileCard.tsx`: allow wallet-only users to open the claim modal before a user profile exists.
- `/home/fillx/eolive/dev/eolive/app/components/profile/UsernameClaimModal.tsx`: stop passing `userId` to username challenge and claim routes.

---

### Task 1: Extract Server Factory and Resettable DB Client

**Files:**
- Create: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/db/client.ts`
- Test: `server/src/app.ts` verified by E2E in Task 8

- [ ] **Step 1: Replace the cached DB shape**

In `server/src/db/client.ts`, change the cache from a bare `Db` to `{ db, pool }`, and add close/reset helpers.

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: { db: Db; pool: pg.Pool } | null = null;

export function getDb(): Db {
  if (cached) return cached.db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  cached = { db, pool };
  return db;
}

export async function closeDb(): Promise<void> {
  const current = cached;
  cached = null;
  if (current) await current.pool.end();
}

export function resetDbForTests(): void {
  cached = null;
}

export { schema };
```

- [ ] **Step 2: Create the server factory**

Create `server/src/app.ts` with this module. The `ResponseHeadersPlugin` is required so route handlers can set `Set-Cookie`.

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RPCHandler } from "@orpc/server/node";
import { CORSPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins";
import { onError } from "@orpc/server";
import { router } from "./router.js";
import { handleRestApi } from "./rest-adapter.js";
import { createContext, type AppContext } from "./identity/context.js";

function parseCorsOrigins(): readonly string[] | undefined {
  const raw = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN;
  if (!raw) return undefined;
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : undefined;
}

function resolveCorsOrigin(origin: string): readonly string[] {
  const configured = parseCorsOrigins();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return [];
  return origin ? [origin] : [];
}

export function createAppServer() {
  const handler = new RPCHandler(router, {
    plugins: [
      new CORSPlugin<AppContext>({
        credentials: true,
        origin: (origin) => resolveCorsOrigin(origin),
      }),
      new ResponseHeadersPlugin<AppContext>(),
    ],
    interceptors: [
      onError((error) => {
        console.error(error);
      }),
    ],
  });

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url?.startsWith("/api/")) {
      return handleRestApi(req, res);
    }

    const { matched } = await handler.handle(req, res, {
      prefix: "/rpc",
      context: await createContext(req),
    });

    if (!matched) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
}
```

- [ ] **Step 3: Make production startup import the factory**

Replace `server/src/index.ts` with this entrypoint.

```ts
import "dotenv/config";
import { createAppServer } from "./app.js";

const port = Number(process.env.PORT ?? 8000);
const server = createAppServer();

server.listen(port, () => {
  console.log(`fillx_backend running on http://localhost:${port}`);
  console.log(`  RPC  -> http://localhost:${port}/rpc`);
  console.log(`  Health -> http://localhost:${port}/healthz`);
});
```

- [ ] **Step 4: Run typecheck for the server factory**

Run:

```bash
yarn workspace @fillx/server check
```

Expected: PASS. The response headers plugin accepts a context where `resHeaders` is optional; Task 2 adds the explicit context property before handlers write cookies.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/src/db/client.ts
git commit -m "refactor: extract backend server factory"
```

---

### Task 2: Add FillX Session Auth and Cookie Helpers

**Files:**
- Create: `server/src/identity/session.ts`
- Create: `server/src/identity/session.test.ts`
- Modify: `server/src/identity/auth.ts`
- Modify: `server/src/identity/context.ts`
- Modify: `server/src/identity/errors.ts`

- [ ] **Step 1: Write the failing session tests**

Create `server/src/identity/session.test.ts`.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  FILLX_SESSION_COOKIE,
  setFillxSessionCookie,
  signFillxSession,
  verifyFillxSessionToken,
} from "./session.js";

test("signFillxSession creates a JWT that verifies to the FillX user id", async () => {
  const token = await signFillxSession({
    userId: "user-123",
    secret: "test-secret",
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  const verified = await verifyFillxSessionToken({
    token,
    secret: "test-secret",
  });

  assert.deepEqual(verified, { userId: "user-123" });
});

test("verifyFillxSessionToken returns null for invalid tokens", async () => {
  assert.equal(
    await verifyFillxSessionToken({
      token: "not-a-jwt",
      secret: "test-secret",
    }),
    null,
  );
});

test("setFillxSessionCookie sets browser-safe cookie attributes", () => {
  const headers = new Headers();

  setFillxSessionCookie(headers, "jwt-value", {
    secure: true,
    maxAgeSeconds: 60,
  });

  const cookie = headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`${FILLX_SESSION_COOKIE}=jwt-value`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=60/);
});
```

- [ ] **Step 2: Run the failing session tests**

Run:

```bash
yarn workspace @fillx/server test -- src/identity/session.test.ts
```

Expected: FAIL because `server/src/identity/session.ts` does not exist.

- [ ] **Step 3: Create the session helper module**

Create `server/src/identity/session.ts`.

```ts
import { SignJWT, jwtVerify } from "jose";
import { setCookie } from "@orpc/server/helpers";

export const FILLX_SESSION_COOKIE = "fillx-session";
const SESSION_TYPE = "fillx-session";
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type VerifiedFillxSession = {
  userId: string;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signFillxSession(input: {
  userId: string;
  secret: string;
  now?: Date;
  maxAgeSeconds?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const maxAgeSeconds = input.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  return new SignJWT({ typ: SESSION_TYPE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + maxAgeSeconds)
    .sign(secretKey(input.secret));
}

export async function verifyFillxSessionToken(input: {
  token: string;
  secret: string;
}): Promise<VerifiedFillxSession | null> {
  try {
    const verified = await jwtVerify(input.token, secretKey(input.secret));
    if (verified.payload.typ !== SESSION_TYPE) return null;
    if (!verified.payload.sub) return null;
    return { userId: verified.payload.sub };
  } catch {
    return null;
  }
}

export function setFillxSessionCookie(
  headers: Headers | undefined,
  token: string,
  options: { secure: boolean; maxAgeSeconds?: number },
): void {
  setCookie(headers, FILLX_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: "/",
    maxAge: options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
  });
}
```

- [ ] **Step 4: Update auth environment and request auth**

Modify `server/src/identity/auth.ts` so it supports FillX session cookies. Explicit Privy bearer tokens should win over existing FillX cookies because the user is actively presenting provider auth.

```ts
import { getCookie } from "@orpc/server/helpers";
import { importSPKI, jwtVerify } from "jose";
import {
  FILLX_SESSION_COOKIE,
  verifyFillxSessionToken,
  type VerifiedFillxSession,
} from "./session.js";

export type VerifiedPrivyAuth = {
  privyUserId: string;
  sessionId: string | null;
};

export type RequestAuth =
  | { type: "privy"; privy: VerifiedPrivyAuth }
  | { type: "fillx"; session: VerifiedFillxSession }
  | { type: "anonymous" };

export type IdentityEnv = {
  privyAppId: string | null;
  privyJwtVerificationKey: string | null;
  fillxJwtSecret: string | null;
  nodeEnv: string;
};

export function getIdentityEnv(): IdentityEnv {
  return {
    privyAppId: process.env.PRIVY_APP_ID ?? null,
    privyJwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY ?? null,
    fillxJwtSecret: process.env.FILLX_JWT_SECRET ?? null,
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}

export function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export function getPrivyTokenFromCookie(headers: Headers): string | null {
  return getCookie(headers, "privy-token") ?? null;
}

export async function verifyPrivyAccessToken(input: {
  token: string;
  appId: string;
  verificationKey: string;
}): Promise<VerifiedPrivyAuth> {
  const key = await importSPKI(input.verificationKey, "ES256");
  const verified = await jwtVerify(input.token, key, {
    issuer: "privy.io",
    audience: input.appId,
  });

  const privyUserId = verified.payload.sub;
  if (!privyUserId) {
    throw new Error("Privy token is missing sub claim");
  }

  return {
    privyUserId,
    sessionId:
      typeof verified.payload.sid === "string" ? verified.payload.sid : null,
  };
}

async function getPrivyAuthFromToken(
  token: string | null,
  env: IdentityEnv,
): Promise<RequestAuth | null> {
  if (!token || !env.privyAppId || !env.privyJwtVerificationKey) return null;
  return {
    type: "privy",
    privy: await verifyPrivyAccessToken({
      token,
      appId: env.privyAppId,
      verificationKey: env.privyJwtVerificationKey,
    }),
  };
}

async function getFillxAuthFromCookie(
  headers: Headers,
  env: IdentityEnv,
): Promise<RequestAuth | null> {
  if (!env.fillxJwtSecret) return null;
  const token = getCookie(headers, FILLX_SESSION_COOKIE);
  if (!token) return null;
  const session = await verifyFillxSessionToken({
    token,
    secret: env.fillxJwtSecret,
  });
  return session ? { type: "fillx", session } : null;
}

export async function getRequestAuth(
  headers: Headers,
  env = getIdentityEnv(),
): Promise<RequestAuth> {
  const bearerPrivy = await getPrivyAuthFromToken(getBearerToken(headers), env);
  if (bearerPrivy) return bearerPrivy;

  const fillx = await getFillxAuthFromCookie(headers, env);
  if (fillx) return fillx;

  const cookiePrivy = await getPrivyAuthFromToken(
    getPrivyTokenFromCookie(headers),
    env,
  );
  if (cookiePrivy) return cookiePrivy;

  return { type: "anonymous" };
}
```

- [ ] **Step 5: Add response headers to the app context**

Modify `server/src/identity/context.ts`.

```ts
import type { IncomingMessage } from "node:http";
import { getDb, type Db } from "../db/client.js";
import {
  getIdentityEnv,
  getRequestAuth,
  type IdentityEnv,
  type RequestAuth,
} from "./auth.js";

export type AppContext = {
  db: Db;
  env: IdentityEnv;
  auth: RequestAuth;
  reqHeaders?: Headers;
  resHeaders?: Headers;
  requestId: string;
  ipAddress: string;
};

function headersFromIncomingMessage(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function createContext(req: IncomingMessage): Promise<AppContext> {
  const headers = headersFromIncomingMessage(req);
  const env = getIdentityEnv();
  const context = {
    env,
    auth: await getRequestAuth(headers, env),
    reqHeaders: headers,
    requestId: crypto.randomUUID(),
    ipAddress:
      headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  } as AppContext;

  Object.defineProperty(context, "db", {
    enumerable: true,
    get: () => getDb(),
  });

  return context;
}
```

- [ ] **Step 6: Add session-specific error codes**

In `server/src/identity/errors.ts`, add:

```ts
  | "SESSION_NOT_CONFIGURED"
  | "USER_NOT_AUTHENTICATED";
```

The full union should include the existing codes plus those two codes.

- [ ] **Step 7: Run session tests and typecheck**

Run:

```bash
yarn workspace @fillx/server test -- src/identity/session.test.ts
yarn workspace @fillx/server check
```

Expected: session tests PASS. Typecheck may still fail on identity service/router contract until Tasks 3-5 are complete.

- [ ] **Step 8: Commit**

```bash
git add server/src/identity/session.ts server/src/identity/session.test.ts server/src/identity/auth.ts server/src/identity/context.ts server/src/identity/errors.ts
git commit -m "feat: add FillX session auth"
```

---

### Task 3: Make Current User Anonymous-Safe

**Files:**
- Modify: `server/src/identity/identity.service.test.ts`
- Modify: `server/src/identity/identity.service.ts`
- Modify: `server/src/identity/repositories.ts`

- [ ] **Step 1: Replace identity service tests with guest and verified-auth cases**

Update `server/src/identity/identity.service.test.ts` so it covers no anonymous persistence.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityService, type FillxUser } from "./identity.service.js";

function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  const now = new Date("2026-05-07T00:00:00.000Z");
  return {
    id: input.id ?? "user-1",
    username: input.username ?? "trader_0001",
    username_status: input.username_status ?? "generated",
    display_name: input.display_name ?? null,
    avatar_url: input.avatar_url ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  };
}

test("getCurrentUser returns a guest response without creating a user for anonymous auth", async () => {
  let createCount = 0;
  const service = createIdentityService({
    users: {
      findById: async () => undefined,
      findByUsername: async () => undefined,
      createGeneratedUser: async () => {
        createCount += 1;
        return makeUser();
      },
      updateDisplayName: async () => {
        throw new Error("should not update user");
      },
    },
  });

  const result = await service.getCurrentUser({ auth: { type: "anonymous" } });

  assert.deepEqual(result, { user: null, guest: { isGuest: true } });
  assert.equal(createCount, 0);
});

test("getCurrentUser returns an existing FillX session user", async () => {
  const existing = makeUser({ id: "user-session", username: "alice" });
  const service = createIdentityService({
    users: {
      findById: async (id) => (id === existing.id ? existing : undefined),
      findByUsername: async () => undefined,
      createGeneratedUser: async () => {
        throw new Error("should not create user");
      },
      updateDisplayName: async () => {
        throw new Error("should not update user");
      },
    },
  });

  const result = await service.getCurrentUser({
    auth: { type: "fillx", userId: "user-session" },
  });

  assert.deepEqual(result, { user: existing, guest: null });
});

test("getCurrentUser returns an existing Privy-linked user", async () => {
  const existing = makeUser({ id: "user-existing", username: "alice" });
  const service = createIdentityService({
    users: {
      findById: async (id) => (id === existing.id ? existing : undefined),
      findByUsername: async () => undefined,
      createGeneratedUser: async () => {
        throw new Error("should not create user");
      },
      updateDisplayName: async () => {
        throw new Error("should not update user");
      },
    },
    authIdentities: {
      findByProviderUserId: async () => ({ user_id: existing.id }),
      linkPrivyIdentity: async () => {
        throw new Error("should not link identity");
      },
    },
  });

  const result = await service.getCurrentUser({
    auth: { type: "privy", privyUserId: "privy-user-1" },
  });

  assert.deepEqual(result, { user: existing, guest: null });
});

test("getCurrentUser creates a generated user only for verified Privy auth", async () => {
  const linked: Array<{ userId: string; privyUserId: string }> = [];
  const created = makeUser({ id: "user-created", username: "trader_002a" });
  const service = createIdentityService(
    {
      users: {
        findById: async () => undefined,
        findByUsername: async () => undefined,
        createGeneratedUser: async (username) => ({
          ...created,
          username,
        }),
        updateDisplayName: async () => {
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
    },
    { randomInt: () => 42 },
  );

  const result = await service.getCurrentUser({
    auth: { type: "privy", privyUserId: "privy-user-2" },
  });

  assert.equal(result.user?.username, "trader_002a");
  assert.equal(result.guest, null);
  assert.deepEqual(linked, [
    { userId: "user-created", privyUserId: "privy-user-2" },
  ]);
});
```

- [ ] **Step 2: Run the failing identity tests**

Run:

```bash
yarn workspace @fillx/server test -- src/identity/identity.service.test.ts
```

Expected: FAIL because `getCurrentUser` does not exist and anonymous calls still create generated users.

- [ ] **Step 3: Replace current-user service behavior**

Modify `server/src/identity/identity.service.ts`.

```ts
import type { FillxUser } from "../db/schema.js";
import { generateUsernameCandidate } from "./username.rules.js";

export type { FillxUser } from "../db/schema.js";

export type IdentityRepos = {
  users: {
    findById?: (id: string) => Promise<FillxUser | undefined>;
    findByUsername?: (username: string) => Promise<FillxUser | undefined>;
    createGeneratedUser?: (username: string) => Promise<FillxUser>;
    updateDisplayName: (input: {
      userId: string;
      displayName: string;
    }) => Promise<FillxUser>;
  };
  authIdentities?: {
    findByProviderUserId: (input: {
      provider: "privy";
      providerUserId: string;
    }) => Promise<{ user_id: string } | undefined>;
    linkPrivyIdentity: (input: {
      userId: string;
      privyUserId: string;
    }) => Promise<unknown>;
  };
};

export type CurrentUserAuth =
  | { type: "anonymous" }
  | { type: "fillx"; userId: string }
  | { type: "privy"; privyUserId: string };

export type CurrentUserResult = {
  user: FillxUser | null;
  guest: { isGuest: true } | null;
};

export function createIdentityService(
  repos: IdentityRepos,
  options: { randomInt?: () => number } = {},
) {
  async function createGeneratedUser(): Promise<FillxUser> {
    if (!repos.users.createGeneratedUser || !repos.users.findByUsername) {
      throw new Error("IDENTITY_REPO_INCOMPLETE");
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateUsernameCandidate(options.randomInt);
      const existing = await repos.users.findByUsername(candidate);
      if (!existing) return repos.users.createGeneratedUser(candidate);
    }

    throw new Error("GENERATED_USERNAME_COLLISION");
  }

  async function getOrCreatePrivyUser(privyUserId: string): Promise<FillxUser> {
    if (
      repos.authIdentities?.findByProviderUserId &&
      repos.users.findById
    ) {
      const identity = await repos.authIdentities.findByProviderUserId({
        provider: "privy",
        providerUserId: privyUserId,
      });
      if (identity) {
        const existing = await repos.users.findById(identity.user_id);
        if (existing) return existing;
      }
    }

    const created = await createGeneratedUser();
    if (repos.authIdentities?.linkPrivyIdentity) {
      await repos.authIdentities.linkPrivyIdentity({
        userId: created.id,
        privyUserId,
      });
    }
    return created;
  }

  return {
    async getCurrentUser(input: { auth: CurrentUserAuth }): Promise<CurrentUserResult> {
      if (input.auth.type === "anonymous") {
        return { user: null, guest: { isGuest: true } };
      }

      if (input.auth.type === "fillx") {
        const user = repos.users.findById
          ? await repos.users.findById(input.auth.userId)
          : undefined;
        return user
          ? { user, guest: null }
          : { user: null, guest: { isGuest: true } };
      }

      const user = await getOrCreatePrivyUser(input.auth.privyUserId);
      return { user, guest: null };
    },

    async updateDisplayName(input: {
      userId: string;
      displayName: string;
    }): Promise<FillxUser> {
      const displayName = input.displayName.trim();
      if (displayName.length === 0 || displayName.length > 50) {
        throw new Error("INVALID_DISPLAY_NAME");
      }
      return repos.users.updateDisplayName({ userId: input.userId, displayName });
    },
  };
}
```

- [ ] **Step 4: Remove wallet lookup from identity repos**

In `server/src/identity/repositories.ts`, leave `wallets.findByWallet` available for username claim, but stop passing `wallets` into `createIdentityService` call sites in Task 5. No repository deletion is required in this task.

- [ ] **Step 5: Run identity tests**

Run:

```bash
yarn workspace @fillx/server test -- src/identity/identity.service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/identity/identity.service.ts server/src/identity/identity.service.test.ts server/src/identity/repositories.ts
git commit -m "feat: make anonymous current user non-persistent"
```

---

### Task 4: Remove Client `userId` from Username Service

**Files:**
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/db/migrations/0001_faithful_archangel.sql`
- Modify: `server/src/db/migrations/meta/0001_snapshot.json`
- Modify: `server/src/db/migrations/meta/_journal.json`
- Modify: `server/src/identity/repositories.ts`
- Modify: `server/src/identity/username.service.ts`
- Modify: `server/src/identity/username.service.test.ts`

- [ ] **Step 1: Update username service tests for wallet-only claims**

In `server/src/identity/username.service.test.ts`, update the fake repos to support `createClaimedUser`, nullable challenge `user_id`, and wallet lookup. Add these tests:

```ts
test("requestClaimChallenge does not require a pre-existing user", async () => {
  const { repos } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
  });

  const challenge = await service.requestClaimChallenge({
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
    authenticatedUserId: null,
  });

  assert.equal(challenge.challengeId, "challenge-1");
  assert.match(challenge.message, /Username: alice_1/);
});

test("claimUsername creates a claimed wallet-backed user after valid wallet proof", async () => {
  const { repos, users, wallets } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
    authenticatedUserId: null,
  });

  const user = await service.claimUsername({
    challengeId: challenge.challengeId,
    signature: "0xsigned",
  });

  assert.equal(user.username, "alice_1");
  assert.equal(user.username_status, "claimed");
  assert.equal(users.size, 1);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].user_id, user.id);
});

test("claimUsername rejects a replayed challenge", async () => {
  const { repos } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
    authenticatedUserId: null,
  });

  await service.claimUsername({
    challengeId: challenge.challengeId,
    signature: "0xsigned",
  });

  await assert.rejects(
    service.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xsigned",
    }),
    /CHALLENGE_ALREADY_USED/,
  );
});

test("claimUsername rejects an expired challenge without creating a user", async () => {
  const { repos, users } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
    authenticatedUserId: null,
  });
  const expiredService = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:11:00.000Z"),
    verifySignature: async () => true,
  });

  await assert.rejects(
    expiredService.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xsigned",
    }),
    /CHALLENGE_EXPIRED/,
  );
  assert.equal(users.size, 0);
});

test("claimUsername rejects invalid signatures without consuming the challenge", async () => {
  const { repos, challenges } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => false,
  });
  const challenge = await service.requestClaimChallenge({
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
    authenticatedUserId: null,
  });

  await assert.rejects(
    service.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xwrong",
    }),
    /SIGNATURE_INVALID/,
  );
  assert.equal(challenges.get(challenge.challengeId)?.consumed_at, null);
});
```

- [ ] **Step 2: Run the failing username service tests**

Run:

```bash
yarn workspace @fillx/server test -- src/identity/username.service.test.ts
```

Expected: FAIL because `authenticatedUserId` is not accepted and `claimUsername` still requires `userId`.

- [ ] **Step 3: Update schema for wallet-only challenges**

In `server/src/db/schema.ts`, make `usernameClaimChallenges.user_id` nullable:

```ts
    user_id: uuid("user_id").references(() => fillxUsers.id, {
      onDelete: "cascade",
    }),
```

Keep `usernameClaims.user_id` non-null because an audit row is written only after a user is created or resolved.

- [ ] **Step 4: Update the current uncommitted username migration**

In `server/src/db/migrations/0001_faithful_archangel.sql`, change the `username_claim_challenges` user column from:

```sql
"user_id" uuid NOT NULL,
```

to:

```sql
"user_id" uuid,
```

Keep the foreign key:

```sql
ALTER TABLE "username_claim_challenges" ADD CONSTRAINT "username_claim_challenges_user_id_fillx_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fillx_users"("id") ON DELETE cascade ON UPDATE no action;
```

Then update `server/src/db/migrations/meta/0001_snapshot.json` so `username_claim_challenges.user_id.notNull` is `false`. Keep `_journal.json` pointing at the same `0001_faithful_archangel` migration.

- [ ] **Step 5: Add repository primitives**

In `server/src/identity/repositories.ts`, extend `createUsersRepo` with direct claimed-user creation:

```ts
    async createClaimedUser(username: string): Promise<FillxUser> {
      return firstOrThrow(
        await db
          .insert(fillxUsers)
          .values({
            username,
            username_status: "claimed" as UsernameStatus,
          })
          .returning(),
      );
    },
```

Extend `createUsernameClaimsRepo.createChallenge` input to accept `userId: string | null` and pass `user_id: input.userId`.

- [ ] **Step 6: Replace username service inputs and claim flow**

In `server/src/identity/username.service.ts`, update the repo type and public methods:

```ts
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
    consumeChallenge: (id: string) => Promise<void>;
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
```

Change `requestClaimChallenge` to accept `authenticatedUserId: string | null` and not require an existing user for wallet-only users.

```ts
    async requestClaimChallenge(input: {
      authenticatedUserId: string | null;
      username: string;
      walletAddress: string;
      chainType: ChainType;
      chainId: number | null;
    }): Promise<{ challengeId: string; expiresAt: string; message: string }> {
      let authenticatedUser: FillxUser | undefined;
      if (input.authenticatedUserId) {
        authenticatedUser = await repos.users.findById(input.authenticatedUserId);
        if (!authenticatedUser) throw apiError("USER_NOT_FOUND");
        if (authenticatedUser.username_status === "claimed") {
          throw apiError("USERNAME_ALREADY_CLAIMED");
        }
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
```

Change `claimUsername` so the user is resolved or created after signature verification:

```ts
    async claimUsername(input: {
      challengeId: string;
      signature: string;
    }): Promise<FillxUser> {
      const challenge = await repos.usernameClaims.findChallengeById(
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

      return repos.runTransaction(async (txRepos) => {
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

        await txRepos.usernameClaims.consumeChallenge(challenge.id);
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
```

- [ ] **Step 7: Run username service tests**

Run:

```bash
yarn workspace @fillx/server test -- src/identity/username.service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/db/schema.ts server/src/db/migrations/0001_faithful_archangel.sql server/src/db/migrations/meta/0001_snapshot.json server/src/db/migrations/meta/_journal.json server/src/identity/repositories.ts server/src/identity/username.service.ts server/src/identity/username.service.test.ts
git commit -m "feat: claim usernames from wallet proof"
```

---

### Task 5: Update oRPC Contract and Route Handlers

**Files:**
- Modify: `shared/src/contract.ts`
- Modify: `server/src/router.ts`
- Create: `server/src/identity/profile-lookup.ts`

- [ ] **Step 1: Change the shared contract**

In `shared/src/contract.ts`, add a current-user response schema:

```ts
const GuestResponse = z.object({
  isGuest: z.literal(true),
});

const CurrentUserResponse = z.object({
  user: FillxUserProfile.nullable(),
  guest: GuestResponse.nullable(),
});
```

Replace `identity.getCurrentUser` with no input:

```ts
    getCurrentUser: oc.output(CurrentUserResponse),
```

Replace username challenge and claim inputs:

```ts
    requestClaimChallenge: oc
      .input(
        z.object({
          username: z.string(),
          walletAddress: z.string(),
          chainType: ChainType,
          chainId: z.number().int().positive().nullable().optional(),
        }),
      )
      .output(
        z.object({
          challengeId: z.string(),
          expiresAt: z.string(),
          message: z.string(),
        }),
      ),
    claim: oc
      .input(
        z.object({
          challengeId: z.string(),
          signature: z.string(),
        }),
      )
      .output(z.object({ user: FillxUserProfile })),
```

- [ ] **Step 2: Create profile lookup normalization**

Create `server/src/identity/profile-lookup.ts`.

```ts
import { normalizeWalletAddress } from "./wallet.js";

export function normalizeProfileLookupWallets(
  walletAddresses: string[],
): string[] {
  const normalized = new Set<string>();

  for (const raw of walletAddresses) {
    try {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const chainType = trimmed.startsWith("0x") ? "evm" : "solana";
      normalized.add(normalizeWalletAddress(chainType, trimmed));
    } catch {
      continue;
    }
  }

  return [...normalized];
}
```

- [ ] **Step 3: Update router identity auth mapping and session issuing**

In `server/src/router.ts`, import session helpers:

```ts
import {
  setFillxSessionCookie,
  signFillxSession,
} from "./identity/session.js";
import { normalizeProfileLookupWallets } from "./identity/profile-lookup.js";
```

Add helpers near `requirePrivy`:

```ts
function isSecureCookieEnv(context: AppContext): boolean {
  return context.env.nodeEnv !== "development" && context.env.nodeEnv !== "test";
}

async function issueFillxSession(context: AppContext, userId: string): Promise<void> {
  if (!context.env.fillxJwtSecret) {
    throw apiError("SESSION_NOT_CONFIGURED");
  }
  const token = await signFillxSession({
    userId,
    secret: context.env.fillxJwtSecret,
  });
  setFillxSessionCookie(context.resHeaders, token, {
    secure: isSecureCookieEnv(context),
  });
}

function currentUserAuthFromContext(context: AppContext) {
  if (context.auth.type === "privy") {
    return {
      type: "privy" as const,
      privyUserId: context.auth.privy.privyUserId,
    };
  }
  if (context.auth.type === "fillx") {
    return {
      type: "fillx" as const,
      userId: context.auth.session.userId,
    };
  }
  return { type: "anonymous" as const };
}

function authenticatedUserIdFromContext(context: AppContext): string | null {
  return context.auth.type === "fillx" ? context.auth.session.userId : null;
}
```

Replace `identity.getCurrentUser` handler:

```ts
    getCurrentUser: pub.identity.getCurrentUser.handler(
      async ({ context }) => {
        const repos = createIdentityRepos(context.db);
        const service = createIdentityService({
          users: repos.users,
          authIdentities: repos.authIdentities,
        });
        const current = await service.getCurrentUser({
          auth: currentUserAuthFromContext(context),
        });
        if (current.user && context.auth.type === "privy") {
          await issueFillxSession(context, current.user.id);
        }
        return {
          user: current.user ? serializeUser(current.user) : null,
          guest: current.guest,
        };
      },
    ),
```

Replace `identity.updateDisplayName` current-user lookup so it accepts FillX session or Privy auth:

```ts
        const current = await service.getCurrentUser({
          auth: currentUserAuthFromContext(context),
        });
        if (!current.user) throw apiError("AUTH_REQUIRED");
        const updated = await service.updateDisplayName({
          userId: current.user.id,
          displayName: input.displayName,
        });
```

- [ ] **Step 4: Update username route handlers**

Replace rate-limit keys and service inputs:

```ts
    requestClaimChallenge: pub.username.requestClaimChallenge.handler(
      async ({ input, context }) => {
        const walletKey = `${input.chainType}:${input.walletAddress}`;
        const limit = identityRateLimiter.check({
          key: `${walletKey}:requestUsernameClaim`,
          limit: 10,
          windowMs: 60 * 60 * 1000,
        });
        if (!limit.allowed) throw apiError("RATE_LIMITED");
        return createUsernameServiceForContext(context).requestClaimChallenge({
          authenticatedUserId: authenticatedUserIdFromContext(context),
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
      const updated = await createUsernameServiceForContext(
        context,
      ).claimUsername(input);
      await issueFillxSession(context, updated.id);
      return { user: serializeUser(updated) };
    }),
```

Update `profile.getByWallets`:

```ts
          profiles: await getProfilesByWallets(
            context.db,
            normalizeProfileLookupWallets(input.walletAddresses),
          ),
```

- [ ] **Step 5: Run route contract typecheck**

Run:

```bash
yarn workspace @fillx/shared check
yarn workspace @fillx/server check
```

Expected: PASS after router call sites match the new contract.

- [ ] **Step 6: Commit**

```bash
git add shared/src/contract.ts server/src/router.ts server/src/identity/profile-lookup.ts
git commit -m "feat: update identity API proof boundaries"
```

---

### Task 6: Add Focused Lower-Level Identity Tests

**Files:**
- Modify: `server/src/identity/username.service.test.ts`
- Modify: `server/src/identity/wallet.ts`
- Create or modify: `server/src/identity/wallet.test.ts`
- Create or modify: `server/src/identity/profile-lookup.test.ts`

- [ ] **Step 1: Add Solana normalization tests**

Create `server/src/identity/profile-lookup.test.ts`.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProfileLookupWallets } from "./profile-lookup.js";

const solanaAddress = "11111111111111111111111111111111";

test("normalizeProfileLookupWallets lowercases EVM addresses", () => {
  assert.deepEqual(
    normalizeProfileLookupWallets([
      "0x000000000000000000000000000000000000ABCD",
    ]),
    ["0x000000000000000000000000000000000000abcd"],
  );
});

test("normalizeProfileLookupWallets preserves valid Solana base58 addresses", () => {
  assert.deepEqual(normalizeProfileLookupWallets([solanaAddress]), [
    solanaAddress,
  ]);
});

test("normalizeProfileLookupWallets drops invalid wallet lookup inputs", () => {
  assert.deepEqual(normalizeProfileLookupWallets(["not a wallet"]), []);
});
```

- [ ] **Step 2: Add wallet verifier tests**

Create `server/src/identity/wallet.test.ts` with deterministic EVM and Solana signatures:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";
import { normalizeWalletAddress, verifyWalletSignature } from "./wallet.js";

const evmPrivateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const evmAccount = privateKeyToAccount(evmPrivateKey);

const solanaSecret = Uint8Array.from(
  Array.from({ length: 32 }, (_, index) => index + 1),
);
const solanaKeypair = nacl.sign.keyPair.fromSeed(solanaSecret);
const solanaAddress = bs58.encode(solanaKeypair.publicKey);

test("verifyWalletSignature accepts valid EVM personal signatures", async () => {
  const message = "FillX test message";
  const signature = await evmAccount.signMessage({ message });

  assert.equal(
    await verifyWalletSignature({
      chainType: "evm",
      walletAddress: evmAccount.address,
      message,
      signature,
    }),
    true,
  );
});

test("verifyWalletSignature rejects EVM signatures for a different message", async () => {
  const signature = await evmAccount.signMessage({ message: "message a" });

  assert.equal(
    await verifyWalletSignature({
      chainType: "evm",
      walletAddress: evmAccount.address,
      message: "message b",
      signature,
    }),
    false,
  );
});

test("verifyWalletSignature accepts valid Solana signatures", async () => {
  const message = "FillX Solana test message";
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), solanaKeypair.secretKey),
  );

  assert.equal(
    await verifyWalletSignature({
      chainType: "solana",
      walletAddress: solanaAddress,
      message,
      signature,
    }),
    true,
  );
});

test("normalizeWalletAddress preserves Solana base58 case", () => {
  assert.equal(normalizeWalletAddress("solana", solanaAddress), solanaAddress);
});
```

- [ ] **Step 3: Run lower-level identity tests**

Run:

```bash
yarn workspace @fillx/server test -- src/identity/*.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/identity/username.service.test.ts server/src/identity/wallet.ts server/src/identity/wallet.test.ts server/src/identity/profile-lookup.test.ts
git commit -m "test: cover identity proof edge cases"
```

---

### Task 7: Add E2E Tooling and Helpers

**Files:**
- Modify: `package.json`
- Modify: `server/package.json`
- Create: `e2e/helpers/database.ts`
- Create: `e2e/helpers/server.ts`
- Create: `e2e/helpers/session.ts`
- Create: `e2e/helpers/client.ts`
- Create: `e2e/helpers/wallets.ts`
- Create: `e2e/helpers/privy.ts`
- Create: `e2e/helpers/harness.ts`

- [ ] **Step 1: Add E2E scripts and dependency**

In root `package.json`, add:

```json
"test:e2e": "yarn workspace @fillx/server test:e2e"
```

In `server/package.json`, add:

```json
"test:e2e": "tsx --test --test-concurrency=1 ../e2e/**/*.test.ts"
```

Add `@orpc/client` to `server/package.json` `devDependencies`:

```json
"@orpc/client": "^1.13.0"
```

Run:

```bash
yarn install
```

Expected: `yarn.lock` updates if the dependency was not already present for the server workspace.

- [ ] **Step 2: Create database helper**

Create `e2e/helpers/database.ts`.

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "../../server/src/db/schema.js";

const SAFE_DB_NAME = /^fillx_e2e_[a-zA-Z0-9_]+$/;

function quoteIdentifier(identifier: string): string {
  if (!SAFE_DB_NAME.test(identifier)) {
    throw new Error(`Unsafe E2E database name: ${identifier}`);
  }
  return `"${identifier}"`;
}

function assertSafeAdminUrl(url: URL): void {
  const values = [url.hostname, url.username, url.pathname.replace("/", "")];
  if (values.some((value) => /prod|production/i.test(value))) {
    throw new Error("Refusing to run E2E database operations against production-looking URL");
  }
}

export function requireAdminUrl(): URL {
  const raw = process.env.E2E_DATABASE_ADMIN_URL;
  if (!raw) {
    throw new Error("E2E_DATABASE_ADMIN_URL is required for username E2E tests");
  }
  const url = new URL(raw);
  assertSafeAdminUrl(url);
  return url;
}

export function makeDatabaseName(testName: string): string {
  const safeTestName = testName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48);
  return `fillx_e2e_${process.pid}_${Date.now()}_${safeTestName}`;
}

export function databaseUrlFromAdmin(adminUrl: URL, databaseName: string): string {
  if (!SAFE_DB_NAME.test(databaseName)) {
    throw new Error(`Unsafe E2E database name: ${databaseName}`);
  }
  const next = new URL(adminUrl.toString());
  next.pathname = `/${databaseName}`;
  return next.toString();
}

export async function createDatabase(databaseName: string): Promise<void> {
  const adminUrl = requireAdminUrl();
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE template0`);
  } finally {
    await client.end();
  }
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(
    dirname,
    "../../server/src/db/migrations",
  );
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

export async function dropDatabase(databaseName: string): Promise<void> {
  const adminUrl = requireAdminUrl();
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 3: Create server helper**

Create `e2e/helpers/server.ts`.

```ts
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createAppServer } from "../../server/src/app.js";
import { closeDb, resetDbForTests } from "../../server/src/db/client.js";

export type TestServer = {
  server: Server;
  baseUrl: string;
  stop: () => Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  resetDbForTests();
  const server = createAppServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await closeDb();
    },
  };
}
```

- [ ] **Step 4: Create session jar and E2E client**

Create `e2e/helpers/session.ts`.

```ts
export class CookieJar {
  private readonly cookies = new Map<string, string>();
  private lastSetCookies: string[] = [];

  storeFrom(headers: Headers): void {
    const withGetter = headers as Headers & { getSetCookie?: () => string[] };
    const setCookies =
      withGetter.getSetCookie?.() ??
      (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
    this.lastSetCookies = setCookies;

    for (const setCookie of setCookies) {
      const [pair] = setCookie.split(";");
      const index = pair.indexOf("=");
      if (index === -1) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  lastSetCookieHeader(): string | undefined {
    return this.lastSetCookies.length > 0
      ? this.lastSetCookies.join("\n")
      : undefined;
  }
}
```

Create `e2e/helpers/client.ts`.

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "../../shared/src/contract.js";
import { CookieJar } from "./session.js";

export function createE2EClient(input: {
  baseUrl: string;
  cookieJar?: CookieJar;
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
}) {
  const jar = input.cookieJar ?? new CookieJar();
  const link = new RPCLink({
    url: `${input.baseUrl}/rpc`,
    headers: async () => {
      const extra =
        typeof input.headers === "function"
          ? await input.headers()
          : input.headers ?? {};
      const cookie = jar.header();
      return cookie ? { ...extra, cookie } : extra;
    },
    fetch: async (request, init) => {
      const response = await fetch(request, init);
      jar.storeFrom(response.headers);
      return response;
    },
  });

  return {
    client: createORPCClient<ContractRouterClient<Contract>>(link),
    cookieJar: jar,
  };
}
```

- [ ] **Step 5: Create deterministic wallet helpers**

Create `e2e/helpers/wallets.ts`.

```ts
import bs58 from "bs58";
import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";

const EVM_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_EVM_PRIVATE_KEY =
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

export const evmWallet = privateKeyToAccount(EVM_PRIVATE_KEY);
export const secondEvmWallet = privateKeyToAccount(SECOND_EVM_PRIVATE_KEY);

const solanaSeed = Uint8Array.from(
  Array.from({ length: 32 }, (_, index) => index + 1),
);
export const solanaKeypair = nacl.sign.keyPair.fromSeed(solanaSeed);
export const solanaWalletAddress = bs58.encode(solanaKeypair.publicKey);

export async function signEvmMessage(message: string): Promise<string> {
  return evmWallet.signMessage({ message });
}

export async function signSecondEvmMessage(message: string): Promise<string> {
  return secondEvmWallet.signMessage({ message });
}

export function signSolanaMessage(message: string): string {
  return bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), solanaKeypair.secretKey),
  );
}
```

- [ ] **Step 6: Create Privy token helper**

Create `e2e/helpers/privy.ts`.

```ts
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

export type TestPrivy = {
  appId: string;
  verificationKey: string;
  createAccessToken: (input: { privyUserId: string; sessionId?: string }) => Promise<string>;
};

export async function createTestPrivy(): Promise<TestPrivy> {
  const appId = "test-privy-app";
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const verificationKey = await exportSPKI(publicKey);

  return {
    appId,
    verificationKey,
    createAccessToken: async ({ privyUserId, sessionId }) =>
      new SignJWT({ sid: sessionId ?? "test-session" })
        .setProtectedHeader({ alg: "ES256" })
        .setIssuer("privy.io")
        .setAudience(appId)
        .setSubject(privyUserId)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey),
  };
}
```

- [ ] **Step 7: Create harness helper**

Create `e2e/helpers/harness.ts`.

```ts
import type { TestContext } from "node:test";
import {
  createDatabase,
  databaseUrlFromAdmin,
  dropDatabase,
  makeDatabaseName,
  requireAdminUrl,
  runMigrations,
} from "./database.js";
import { startTestServer } from "./server.js";
import { createE2EClient } from "./client.js";
import { CookieJar } from "./session.js";
import { createTestPrivy } from "./privy.js";

export async function setupE2E(t: TestContext) {
  const adminUrl = requireAdminUrl();
  const databaseName = makeDatabaseName(t.name);
  const databaseUrl = databaseUrlFromAdmin(adminUrl, databaseName);
  const previousEnv = {
    databaseUrl: process.env.DATABASE_URL,
    fillxJwtSecret: process.env.FILLX_JWT_SECRET,
    privyAppId: process.env.PRIVY_APP_ID,
    privyJwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY,
    nodeEnv: process.env.NODE_ENV,
  };

  await createDatabase(databaseName);
  const privy = await createTestPrivy();
  process.env.DATABASE_URL = databaseUrl;
  process.env.FILLX_JWT_SECRET = "e2e-fillx-session-secret";
  process.env.PRIVY_APP_ID = privy.appId;
  process.env.PRIVY_JWT_VERIFICATION_KEY = privy.verificationKey;
  process.env.NODE_ENV = "test";
  await runMigrations(databaseUrl);
  const server = await startTestServer();

  t.after(async () => {
    await server.stop();
    if (previousEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousEnv.databaseUrl;
    if (previousEnv.fillxJwtSecret === undefined) delete process.env.FILLX_JWT_SECRET;
    else process.env.FILLX_JWT_SECRET = previousEnv.fillxJwtSecret;
    if (previousEnv.privyAppId === undefined) delete process.env.PRIVY_APP_ID;
    else process.env.PRIVY_APP_ID = previousEnv.privyAppId;
    if (previousEnv.privyJwtVerificationKey === undefined) {
      delete process.env.PRIVY_JWT_VERIFICATION_KEY;
    } else {
      process.env.PRIVY_JWT_VERIFICATION_KEY = previousEnv.privyJwtVerificationKey;
    }
    if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv.nodeEnv;
    await dropDatabase(databaseName);
  });

  const cookieJar = new CookieJar();
  return {
    baseUrl: server.baseUrl,
    privy,
    cookieJar,
    client: createE2EClient({ baseUrl: server.baseUrl, cookieJar }).client,
    createClient: createE2EClient,
  };
}
```

- [ ] **Step 8: Run E2E command without DB env**

Run:

```bash
yarn test:e2e
```

Expected without `E2E_DATABASE_ADMIN_URL`: FAIL fast with `E2E_DATABASE_ADMIN_URL is required for username E2E tests` after Task 8 adds a test file. If no test file exists yet, the command may report zero tests.

- [ ] **Step 9: Commit**

```bash
git add package.json server/package.json yarn.lock e2e/helpers/database.ts e2e/helpers/server.ts e2e/helpers/session.ts e2e/helpers/client.ts e2e/helpers/wallets.ts e2e/helpers/privy.ts e2e/helpers/harness.ts
git commit -m "test: add backend e2e harness"
```

---

### Task 8: Add Username Backend E2E Tests

**Files:**
- Create: `e2e/username.e2e.test.ts`

- [ ] **Step 1: Write E2E tests**

Create `e2e/username.e2e.test.ts`.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../server/src/db/client.js";
import { setupE2E } from "./helpers/harness.js";
import { createE2EClient } from "./helpers/client.js";
import {
  evmWallet,
  secondEvmWallet,
  signEvmMessage,
  signSecondEvmMessage,
  signSolanaMessage,
  solanaWalletAddress,
} from "./helpers/wallets.js";

async function countFillxUsers(): Promise<number> {
  const rows = await getDb().execute<{ count: string }>(
    sql`select count(*)::text as count from fillx_users`,
  );
  return Number(rows.rows[0]?.count ?? 0);
}

function assertFillxCookie(cookieHeader: string | undefined): void {
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /fillx-session=/);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Lax/);
  assert.match(cookieHeader, /Path=\//);
}

test("guest current user is non-persistent and cannot claim without wallet proof", async (t) => {
  const { client } = await setupE2E(t);

  const current = await client.identity.getCurrentUser();

  assert.equal(current.user, null);
  assert.deepEqual(current.guest, { isGuest: true });
  assert.equal(await countFillxUsers(), 0);
  await assert.rejects(
    client.username.claim({
      challengeId: crypto.randomUUID(),
      signature: "0xmissing",
    }),
  );
  assert.equal(await countFillxUsers(), 0);
});

test("EVM wallet-only user can claim username and receive FillX session cookie", async (t) => {
  const { baseUrl, client, cookieJar } = await setupE2E(t);

  assert.deepEqual(await client.username.checkAvailable({ username: "alice_1" }), {
    available: true,
    normalizedUsername: "alice_1",
  });

  const challenge = await client.username.requestClaimChallenge({
    username: "alice_1",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const signature = await signEvmMessage(challenge.message);
  const result = await client.username.claim({
    challengeId: challenge.challengeId,
    signature,
  });

  assert.equal(result.user.username, "alice_1");
  assert.equal(result.user.usernameStatus, "claimed");
  assert.equal(result.user.hasClaimedUsername, true);
  assertFillxCookie(cookieJar.lastSetCookieHeader());

  const sessionClient = createE2EClient({ baseUrl, cookieJar }).client;
  const current = await sessionClient.identity.getCurrentUser();
  assert.equal(current.user?.id, result.user.id);
  assert.equal(current.guest, null);

  const profile = await sessionClient.profile.getByWallets({
    walletAddresses: [evmWallet.address.toUpperCase()],
  });
  assert.equal(profile.profiles[0]?.username, "alice_1");
});

test("Solana wallet-only user can claim username and profile lookup preserves address", async (t) => {
  const { client } = await setupE2E(t);

  const challenge = await client.username.requestClaimChallenge({
    username: "solana_1",
    walletAddress: solanaWalletAddress,
    chainType: "solana",
    chainId: null,
  });
  const signature = signSolanaMessage(challenge.message);
  const result = await client.username.claim({
    challengeId: challenge.challengeId,
    signature,
  });

  assert.equal(result.user.username, "solana_1");
  const profile = await client.profile.getByWallets({
    walletAddresses: [solanaWalletAddress],
  });
  assert.equal(profile.profiles[0]?.walletAddress, solanaWalletAddress);
  assert.equal(profile.profiles[0]?.username, "solana_1");
});

test("FillX session cannot request a username claim for a different primary wallet", async (t) => {
  const { client } = await setupE2E(t);
  const firstChallenge = await client.username.requestClaimChallenge({
    username: "alice_1",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  await client.username.claim({
    challengeId: firstChallenge.challengeId,
    signature: await signEvmMessage(firstChallenge.message),
  });

  await assert.rejects(
    client.username.requestClaimChallenge({
      username: "bob_1",
      walletAddress: secondEvmWallet.address,
      chainType: "evm",
      chainId: 1,
    }),
  );
});

test("Privy access token maps the same DID to the same FillX user", async (t) => {
  const { baseUrl, privy } = await setupE2E(t);
  const token = await privy.createAccessToken({
    privyUserId: "did:privy:test-user",
  });
  const { client } = createE2EClient({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
  });

  const first = await client.identity.getCurrentUser();
  const second = await client.identity.getCurrentUser();

  assert.ok(first.user);
  assert.equal(first.user?.id, second.user?.id);
  assert.equal(first.guest, null);
});

test("Privy token does not resolve to an already claimed wallet-backed profile", async (t) => {
  const { baseUrl, client, privy } = await setupE2E(t);
  const walletChallenge = await client.username.requestClaimChallenge({
    username: "wallet_1",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const walletUser = await client.username.claim({
    challengeId: walletChallenge.challengeId,
    signature: await signEvmMessage(walletChallenge.message),
  });

  const token = await privy.createAccessToken({
    privyUserId: "did:privy:separate-user",
  });
  const { client: privyClient } = createE2EClient({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
  });
  const privyCurrent = await privyClient.identity.getCurrentUser();

  assert.ok(privyCurrent.user);
  assert.notEqual(privyCurrent.user?.id, walletUser.user.id);

  const updated = await privyClient.identity.updateDisplayName({
    displayName: "Privy User",
  });
  assert.equal(updated.user.id, privyCurrent.user?.id);

  const walletProfile = await privyClient.profile.getByWallets({
    walletAddresses: [evmWallet.address],
  });
  assert.equal(walletProfile.profiles[0]?.username, "wallet_1");
  assert.notEqual(walletProfile.profiles[0]?.userId, updated.user.id);
});

test("sequential contention cannot claim an already taken username", async (t) => {
  const { client } = await setupE2E(t);
  const first = await client.username.requestClaimChallenge({
    username: "taken_1",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const second = await client.username.requestClaimChallenge({
    username: "taken_1",
    walletAddress: secondEvmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  await client.username.claim({
    challengeId: first.challengeId,
    signature: await signEvmMessage(first.message),
  });

  await assert.rejects(
    client.username.claim({
      challengeId: second.challengeId,
      signature: await signSecondEvmMessage(second.message),
    }),
  );
});

test("Orderly account identifiers cannot satisfy wallet proof", async (t) => {
  const { client } = await setupE2E(t);

  await assert.rejects(
    client.username.requestClaimChallenge({
      username: "orderly_1",
      walletAddress: "orderly_subaccount_123",
      chainType: "evm",
      chainId: 1,
    }),
  );
  assert.equal(await countFillxUsers(), 0);
});
```

- [ ] **Step 2: Run E2E tests without database env**

Run:

```bash
unset E2E_DATABASE_ADMIN_URL
yarn test:e2e
```

Expected: FAIL fast with `E2E_DATABASE_ADMIN_URL is required for username E2E tests`.

- [ ] **Step 3: Run E2E tests with a local admin database URL**

Run with a non-production local admin URL:

```bash
E2E_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn test:e2e
```

Expected: PASS. Each test creates and drops a database named `fillx_e2e_<pid>_<timestamp>_<test_name>`.

- [ ] **Step 4: Commit**

```bash
git add e2e/username.e2e.test.ts
git commit -m "test: cover username identity e2e"
```

---

### Task 9: Update eolive for the New Username Contract

**Files:**
- Modify: `/home/fillx/eolive/dev/eolive/app/generated/fillx-backend-contract.ts`
- Modify: `/home/fillx/eolive/dev/eolive/app/api/identity.ts`
- Modify: `/home/fillx/eolive/dev/eolive/app/hooks/useCurrentFillxUser.ts`
- Modify: `/home/fillx/eolive/dev/eolive/app/components/profile/PublicProfileCard.tsx`
- Modify: `/home/fillx/eolive/dev/eolive/app/components/profile/UsernameClaimModal.tsx`

- [ ] **Step 1: Sync the backend contract into eolive**

Run from `/home/fillx/eolive/dev/eolive`:

```bash
yarn sync:fillx-contract --source /home/fillx/eolive/dev/fillx_backend/shared/src/contract.ts
```

Expected: `app/generated/fillx-backend-contract.ts` updates so `getCurrentUser` takes no input and username claim routes do not accept `userId`.

- [ ] **Step 2: Update frontend identity types**

In `/home/fillx/eolive/dev/eolive/app/api/identity.ts`, add:

```ts
export type FillxGuestResponse = {
  isGuest: true;
};

export type FillxCurrentUserResponse = {
  user: FillxUserProfile | null;
  guest: FillxGuestResponse | null;
};
```

Keep the existing `fetch` wrapper with `credentials: "include"` so browser responses store `fillx-session`.

- [ ] **Step 3: Stop sending wallet hints to current-user API**

Replace `/home/fillx/eolive/dev/eolive/app/hooks/useCurrentFillxUser.ts` with:

```ts
import { useEffect, useState } from "react";
import {
  identityClient,
  type FillxCurrentUserResponse,
  type FillxUserProfile,
} from "@/api/identity";

export function useCurrentFillxUser() {
  const [user, setUser] = useState<FillxUserProfile | null>(null);
  const [guest, setGuest] =
    useState<FillxCurrentUserResponse["guest"]>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await identityClient.identity.getCurrentUser();
      setUser(response.user);
      setGuest(response.guest);
      return response.user;
    } catch (err) {
      console.warn("[identity] getCurrentUser failed", err);
      setError("Unable to load FillX profile.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { user, guest, loading, error, refresh };
}
```

- [ ] **Step 4: Remove user dependency from username modal**

In `/home/fillx/eolive/dev/eolive/app/components/profile/UsernameClaimModal.tsx`, remove `user` from props and remove `userId` from API calls:

```ts
export function UsernameClaimModal(props: {
  walletAddress: string;
  chainType: "evm" | "solana";
  chainId: number | null;
  walletProvider: WalletState["provider"] | undefined;
  onClose: () => void;
  onClaimed: (user: FillxUserProfile) => void;
}) {
  // existing state remains

  async function claim() {
    setSubmitting(true);
    setStatus(null);
    try {
      const availability = await identityClient.username.checkAvailable({
        username,
      });
      if (!availability.available) {
        setStatus(availability.error ?? "USERNAME_TAKEN");
        return;
      }

      const challenge = await identityClient.username.requestClaimChallenge({
        username,
        walletAddress: props.walletAddress,
        chainType: props.chainType,
        chainId: props.chainId,
      });

      const signature = await signUsernameClaimMessage({
        walletProvider: props.walletProvider,
        walletAddress: props.walletAddress,
        chainType: props.chainType,
        message: challenge.message,
      });
      const result = await identityClient.username.claim({
        challengeId: challenge.challengeId,
        signature,
      });
      props.onClaimed(result.user);
      props.onClose();
    } catch (error) {
      console.warn("[identity] username claim failed", error);
      setStatus("Unable to claim username. Check the name and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // keep existing JSX
}
```

- [ ] **Step 5: Let wallet-only users open the claim modal**

In `/home/fillx/eolive/dev/eolive/app/components/profile/PublicProfileCard.tsx`, call the hook with no wallet input and render a claim button whenever a wallet is connected and no claimed username is present.

```tsx
  const { user, loading, error, refresh } = useCurrentFillxUser();
  const canClaim = Boolean(account?.address) && !user?.hasClaimedUsername;
```

Replace the generated-user-only button condition:

```tsx
        {canClaim && (
          <button
            onClick={() => setClaimOpen(true)}
            className="rounded bg-cyan-500 px-4 py-2 text-sm font-bold text-white"
          >
            Claim username
          </button>
        )}
```

Render a guest state when no user exists:

```tsx
          {!loading && !user && (
            <div className="mt-4 space-y-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Username
              </div>
              <div className="text-gray-300">No FillX username claimed</div>
            </div>
          )}
```

Update modal props:

```tsx
      {claimOpen && account.address && (
        <UsernameClaimModal
          walletAddress={account.address}
          chainType={chainType}
          chainId={parseChainId(connectedChain?.id)}
          walletProvider={wallet?.provider}
          onClose={() => setClaimOpen(false)}
          onClaimed={() => void refresh()}
        />
      )}
```

- [ ] **Step 6: Run frontend typecheck**

Run from `/home/fillx/eolive/dev/eolive`:

```bash
yarn typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit frontend changes**

Run from `/home/fillx/eolive/dev/eolive`:

```bash
git add app/generated/fillx-backend-contract.ts app/api/identity.ts app/hooks/useCurrentFillxUser.ts app/components/profile/PublicProfileCard.tsx app/components/profile/UsernameClaimModal.tsx
git commit -m "feat: support wallet-proof username claim"
```

---

### Task 10: Final Verification

**Files:**
- No new files

- [ ] **Step 1: Run backend unit tests**

Run from `/home/fillx/eolive/dev/fillx_backend`:

```bash
yarn workspace @fillx/server test
```

Expected: PASS.

- [ ] **Step 2: Run backend typecheck**

Run:

```bash
yarn check
```

Expected: PASS for all backend workspaces.

- [ ] **Step 3: Run E2E tests with local Postgres**

Run:

```bash
E2E_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn test:e2e
```

Expected: PASS. Confirm the output shows each E2E test passing and no teardown errors.

- [ ] **Step 4: Run frontend typecheck**

Run:

```bash
cd /home/fillx/eolive/dev/eolive
yarn typecheck
```

Expected: PASS.

- [ ] **Step 5: Inspect git status**

Run in both repos:

```bash
cd /home/fillx/eolive/dev/fillx_backend
git status --short
cd /home/fillx/eolive/dev/eolive
git status --short
```

Expected: only intentional committed branch changes remain absent from `git status --short`. If generated files remain dirty after successful tests, commit them with the task that produced them.

---

## Self-Review Notes

- Spec coverage: server factory is Task 1; per-test DB isolation and teardown are Task 7; real HTTP/oRPC E2E is Task 8; no Supertest is used; guest non-persistence is Tasks 3 and 8; no client `userId` is Tasks 4, 5, and 9; FillX HTTP-only session cookie is Tasks 2, 5, and 8; Privy DID stability and wallet-boundary E2E are Task 8; Orderly boundary is Task 8; Solana profile lookup is Tasks 5, 6, and 8.
- Test-level split: replay, expiry, invalid signature, wallet verifier, and profile normalization are lower-level tests in Tasks 4 and 6; browser/API E2E stays focused in Task 8.
- Frontend scope: no frontend E2E is added. The eolive task only updates the API contract usage required by the backend contract change.
