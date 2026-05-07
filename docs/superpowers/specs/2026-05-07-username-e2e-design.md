# Username Backend E2E Design

Date: 2026-05-07

## Goal

Add backend API E2E coverage for username functionality in `fillx_backend`. The tests should exercise the real HTTP API surface, use a real Postgres database, and prove the username flows work through the same oRPC routes a client uses.

## Non-Goals

- Do not add frontend E2E coverage.
- Do not add Playwright for this work.
- Do not use Supertest.
- Do not replace unit tests or service-level tests.
- Do not introduce Docker or Testcontainers as a required dependency.
- Do not add separate Orderly subaccount username coverage; Orderly account IDs are trading identifiers, not wallet addresses or wallet proof.

## Scope

Create a new `e2e/` folder in `fillx_backend` containing backend API E2E tests and helpers. The tests should focus on username behavior and only touch app structure where needed to support a side-effect-free test harness.

The implementation should avoid broad refactors. Any server or database lifecycle changes should be narrowly scoped to making the existing backend testable through HTTP.

The identity matrix is a threat model, not a requirement to run every row as a full E2E. E2E should cover cross-boundary behavior and the most important happy paths. Parser, verifier, token, cookie-header, and adapter edge cases belong in focused integration or unit tests.

## Architecture

The backend should expose a side-effect-free server factory for tests.

- Production startup remains in `server/src/index.ts`.
- A new or extracted server module creates the app/server without listening at import time.
- E2E tests start the server on `127.0.0.1:0` and use the assigned port.
- Tests call the oRPC endpoint at `/rpc` using an oRPC client.
- Native `fetch` is reserved for low-level checks where the oRPC client is not appropriate.

This keeps the tests close to production behavior while still allowing deterministic setup and teardown.

## Database Isolation

Each E2E test must get its own Postgres database.

Before each test:

1. Require `E2E_DATABASE_ADMIN_URL`.
2. Reject admin URLs whose host, username, or database name contains `prod` or `production`, and restrict create/drop operations to helper-generated names matching `^fillx_e2e_[a-zA-Z0-9_]+$`.
3. Generate a unique database name, such as `fillx_e2e_<pid>_<test_id>`.
4. Create the database from `template0`.
5. Set that test's application `DATABASE_URL`.
6. Run the committed Drizzle migrations against the new database.
7. Start a fresh backend server instance.

After each test:

1. Close the HTTP server.
2. Close and reset the app database pool or cached Drizzle client.
3. Terminate leftover connections to the test database from the admin connection.
4. Drop the test database.
5. Surface teardown failures clearly so leaked databases are visible.

The E2E runner should execute tests serially unless the app database singleton and environment handling are refactored to be fully per-test isolated.

## Test Harness

Use Node's built-in test runner through `tsx --test`. Add a dedicated E2E command rather than changing the existing unit test command. The command should force serial execution for the first implementation.

Expected helper boundaries:

- `e2e/helpers/database.ts`: admin connection, database creation, migration, connection termination, database drop.
- `e2e/helpers/server.ts`: start and stop an isolated HTTP server for a test.
- `e2e/helpers/client.ts`: create an oRPC client with per-test headers.
- `e2e/helpers/wallets.ts`: deterministic EVM and Solana wallets plus signing helpers.
- `e2e/helpers/privy.ts`: generate a test Privy access token and matching verification key for the backend.
- `e2e/helpers/session.ts`: maintain a cookie jar for backend-issued FillX session cookies.

The helpers should have small public APIs so individual test files do not duplicate setup details.

## Identity Threat Model

Privileged identity mutations must declare the proof type they accept. A different proof type must not accidentally satisfy the mutation.

| Proof type | What it proves | Allowed | Not allowed |
| --- | --- | --- | --- |
| No proof | Anonymous visitor only | Read public data and receive non-persistent guest UI state | Claim username, bind wallet, mutate profile, create a permanent user profile |
| FillX session cookie | Request is authenticated as FillX user ID | Read or update that user's normal profile settings | Prove control of a new wallet |
| EVM wallet signature | Fresh control of exact EVM address, chain, nonce, domain, and action | Claim username, bind EVM wallet, create FillX session | Claim Solana wallet, replay old challenge, claim another username |
| Solana wallet signature | Fresh control of exact Solana public key, nonce, domain, and action | Claim username, bind Solana wallet, create FillX session | Be lowercased, replayed, or reused as EVM proof |
| Privy access token | Privy DID and session for this app | Resolve or create FillX user for that DID | Trust client-provided wallet address |
| Privy identity token or backend user lookup | Privy DID plus verified linked accounts | Bind verified linked wallet if policy allows it | Bind arbitrary connected wallet |
| Orderly account, key, or subaccount | Trading authorization or metadata | Store or link trading metadata | Own username or satisfy wallet proof |

FillX v1 claimed usernames are wallet-owned. If future work supports account-owned or hybrid usernames, the schema must encode owner type explicitly rather than inferring ownership from whichever login path happened first.

## E2E Coverage

Cover username behavior through HTTP routes, not service internals.

Required scenarios:

- Guest or anonymous visitor cannot claim a username.
- `identity.getCurrentUser` has no wallet-address input and returns either an authenticated FillX user or a non-persistent guest response.
- `identity.getCurrentUser` must not create a permanent `fillx_users` row for anonymous visitors.
- Username challenge and claim routes do not accept a client-supplied `userId`; wallet-only claims derive the target profile from verified wallet proof.
- Wallet-only username claim sets an HTTP-only `fillx-session` cookie for the claimed wallet-backed user.
- A FillX session cookie can authenticate later current-user requests, but cannot replace wallet proof for wallet-bound actions.
- Username availability reports available, invalid, and taken names correctly.
- EVM wallet-only username claim succeeds without Privy by signing the exact returned challenge message with a deterministic private key.
- Solana wallet-only username claim succeeds without Privy by signing the exact returned challenge message with a deterministic Ed25519 keypair.
- A FillX session alone cannot bind or claim a different wallet.
- A Privy access token maps the same DID to the same FillX user.
- A user whose primary wallet is already set cannot claim an incompatible primary wallet.
- A Privy-authenticated request with an already-claimed wallet lookup hint must return the Privy current user, not the wallet-backed profile, and must not link the Privy DID to that wallet-backed profile without wallet proof or trusted provider wallet ownership data.
- A Privy verified linked wallet can bind only if the backend verifies the linked wallet through an identity token or trusted backend user lookup.
- Orderly account and subaccount identifiers cannot claim a username or satisfy wallet proof.
- Concurrent or sequential contention cannot claim an already-taken username.
- Profile lookup returns the claimed username and wallet data after a successful claim.

The tests should avoid exhaustive validation-matrix coverage for every username regex edge. Those cases are better suited to unit tests.

## Lower-Level Test Coverage

The following cases are required, but they should be covered by service, integration, or unit tests rather than full E2E unless a route-level regression is suspected:

- Invalid wallet signature is rejected and does not consume the challenge.
- Replayed challenge is rejected after successful consumption.
- Expired challenge is rejected.
- Claim intent mismatch is rejected, such as a signature for `alice` trying to claim `bob`.
- Cross-chain replay is rejected.
- EVM domain, URI, chain ID, and recovered-address mismatch are rejected.
- Solana tampered signed message and account mismatch are rejected.
- Invalid Privy token, wrong issuer, wrong audience, and expired token are rejected.
- Cookie header builder sets `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` outside local development.
- Orderly main-account versus subaccount parsing remains trading metadata only.
- Username normalization and reserved-name rules remain unit-tested.

## Authentication and Identity

The E2E tests should use the same identity mechanisms exposed by the API:

- Identity proof and session boundaries are recorded in `docs/adr/0001-identity-proof-and-session-boundaries.md`.
- Anonymous visitors should call `identity.getCurrentUser` through the test oRPC client and receive a non-persistent guest response.
- Anonymous `identity.getCurrentUser` calls must not create permanent `fillx_users` rows.
- Username claim inputs must not include `userId`; the server derives the target profile from verified wallet proof for wallet-only users.
- The E2E client helper owns one isolated credential jar per test for backend-issued FillX session cookies. Guest requests start without a FillX session cookie.
- Wallet signatures should be generated deterministically by the test helpers.
- FillX session cookies contain backend-issued JWTs whose subject is the FillX user ID. They authenticate the current user for later FillX API calls but are not wallet proof.
- A request-supplied wallet address is a lookup hint until the matching wallet signs the challenge message.
- `identity.getCurrentUser` must not accept wallet lookup inputs. It returns the current request's authenticated FillX user, or a non-persistent guest response when unauthenticated.
- Wallet-only users become permanent user profiles only after wallet proof succeeds.
- An Orderly account ID or subaccount ID is not a wallet address and must not be accepted as wallet proof for username ownership.
- Privy wallet coverage uses a valid mock access token instead of a production Privy token.
- The Privy helper generates a test-controlled ES256 keypair with `jose`, exports the public key as SPKI for `PRIVY_JWT_VERIFICATION_KEY`, sets a test `PRIVY_APP_ID`, and signs a JWT with `iss: "privy.io"`, `aud` equal to the test app ID, `sub` set to a deterministic Privy DID, `sid`, `iat`, and `exp`.
- The Privy E2E client sends the token as `Authorization: Bearer <token>`. Cookie-based `privy-token` coverage is excluded from this username suite because bearer and cookie tokens enter the same backend verifier.
- Include Privy-specific protected routes only when they prove wallet lookup does not become unauthorized account linking. The required protected-route check is that after a wallet-backed username is claimed, calling `identity.getCurrentUser` and then `identity.updateDisplayName` with only a Privy token targets the Privy current user, not the wallet-backed profile.
- A verified Privy access token can issue a FillX session cookie for the Privy-linked FillX user. That FillX session still cannot prove wallet ownership.

## Error Handling

Tests should assert stable observable errors rather than internal implementation details.

For expected failures, assert:

- The route rejects the request.
- The high-level error code or category is correct.
- The failed attempt does not create partial username, wallet, challenge, or profile state.

Teardown errors should fail the test run. A leaked test database is not acceptable hidden cleanup debt.

## Data Flow

The primary wallet-only happy path is:

1. Test creates a fresh database and runs migrations.
2. Test starts the backend server with that database URL.
3. Test creates an oRPC client pointed at the test server.
4. Test checks username availability.
5. Test requests a claim challenge for a deterministic wallet without sending `userId`.
6. Test signs the returned challenge message.
7. Test submits the claim without sending `userId`.
8. Test verifies the response user is created or resolved from the verified wallet proof and a `Set-Cookie` header sets `fillx-session` with `HttpOnly`, `Secure` outside local development, `SameSite=Lax`, and `Path=/`.
9. Test stores the cookie in the E2E cookie jar, calls `identity.getCurrentUser`, and verifies it returns the same claimed user.
10. Test verifies persisted profile behavior through `profile.getByWallets`.
11. Test closes the server and drops the database.

The Privy current-user isolation path is:

1. Test claims a username for a deterministic wallet.
2. Test creates a valid mock Privy access token for a deterministic Privy DID.
3. Test calls `identity.getCurrentUser` with the bearer token and no wallet input.
4. Test asserts the returned user is a Privy current user, not the existing wallet-backed user.
5. Test calls `identity.updateDisplayName` with the bearer token and no wallet input.
6. Test asserts the updated user is the same Privy current user from step 4.
7. Test calls `profile.getByWallets` for the wallet address and asserts the wallet-backed profile still has its original username and display metadata.

## Tooling and Configuration

Add E2E scripts without changing the existing unit test command:

- Root `package.json`: `"test:e2e": "yarn workspace @fillx/server test:e2e"`.
- `server/package.json`: `"test:e2e": "tsx --test --test-concurrency=1 ../e2e/**/*.test.ts"`.

Required environment:

- `E2E_DATABASE_ADMIN_URL`: admin Postgres URL with permission to create and drop databases.

Derived per test:

- `DATABASE_URL`: application Postgres URL pointing at the unique test database.
- `FILLX_JWT_SECRET` or equivalent signing key: deterministic test secret used only for E2E-issued FillX session JWTs.
- `PRIVY_APP_ID`: deterministic test app ID for mock Privy tokens.
- `PRIVY_JWT_VERIFICATION_KEY`: SPKI public key matching the test signing key.

The E2E helpers should reject unsafe admin URLs and unsafe generated database names before issuing create or drop commands.

## Research Notes

Privy documents access tokens as ES256-signed JWTs that should be sent to backend APIs through either an `Authorization: Bearer <token>` header or the `privy-token` cookie. Privy also documents an automated-test pattern: construct a Privy-format JWT and sign it with a key controlled by the test suite instead of using a real production token.

Privy identity tokens carry signed user-level data such as linked accounts. A Privy access token alone proves the Privy DID/session, not ownership of a client-provided wallet address.

Orderly documents account IDs as trading-account identifiers derived from wallet address plus broker ID, with each builder account isolated from other builder accounts. Orderly subaccounts are controlled under a main account and are managed through authenticated Orderly APIs. They are not wallet addresses and do not provide wallet proof for FillX username ownership.

Wallet challenge messages should bind action, username, chain, address, nonce, domain, URI, issued-at, and expiration. EVM should follow the SIWE/EIP-4361 shape where practical. Solana should follow Sign-In With Solana or equivalent structured message semantics where practical.

Browser-facing FillX sessions should use an HTTP-only cookie. `__Host-fillx-session` is preferred in production when the API can set a host-only secure cookie with `Path=/` and no `Domain`.

Sources:

- https://docs.privy.io/recipes/mock-jwt
- https://docs.privy.io/authentication/user-authentication/access-tokens
- https://docs.privy.io/authentication/user-authentication/tokens
- https://docs.privy.io/user-management/users/identity-tokens
- https://orderly.network/docs/build-on-omnichain/user-flows/accounts
- https://orderly.network/docs/build-on-omnichain/evm-api/restful-api/private/get-sub-account
- https://orderly.network/docs/build-on-omnichain/evm-api/restful-api/private/add-sub-account
- https://orderly.network/docs/build-on-omnichain/api-authentication
- https://eips.ethereum.org/EIPS/eip-4361
- https://github.com/phantom/sign-in-with-solana
- https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

## Risks and Mitigations

- Cached database client leaks between tests: add an explicit close/reset helper and call it during teardown.
- Server starts at import time: extract a server factory and keep production listen logic isolated.
- Dropping a database fails because of open connections: close the app pool first, then terminate remaining connections from the admin connection before dropping.
- Parallel execution races through shared process environment: run E2E tests serially in the initial implementation.
- Privy-authenticated requests can mutate another user's wallet-backed profile if a wallet lookup hint determines the current user: include the Privy current-user isolation path in the required E2E matrix.
- FillX session cookies can be over-trusted as wallet proof: include a test or assertion that a FillX session authenticates the current user but wallet-bound ownership changes still require wallet proof.
- Solana wallet lookup may expose address lowercasing bugs: keep a Solana profile lookup test in the required matrix.
- E2E can become too broad: keep edge-case proof parsing in lower-level tests and reserve E2E for happy paths and cross-provider trust-boundary failures.

## Acceptance Criteria

- `fillx_backend/e2e/` exists with username-focused backend API E2E tests and helpers.
- Each test creates a unique database and drops it afterward.
- Tests run through the real HTTP server and oRPC client.
- Tests do not use Supertest.
- Existing unit test command remains available.
- A dedicated E2E command is documented in package scripts.
- The username E2E suite fails fast when `E2E_DATABASE_ADMIN_URL` is missing or unsafe.
