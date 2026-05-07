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

## Scope

Create a new `e2e/` folder in `fillx_backend` containing backend API E2E tests and helpers. The tests should focus on username behavior and only touch app structure where needed to support a side-effect-free test harness.

The implementation should avoid broad refactors. Any server or database lifecycle changes should be narrowly scoped to making the existing backend testable through HTTP.

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

The helpers should have small public APIs so individual test files do not duplicate setup details.

## Username Coverage

Cover username behavior through HTTP routes, not service internals.

Required scenarios:

- Anonymous identity bootstrap creates or returns a generated user.
- Username availability reports available, invalid, and taken names correctly.
- EVM username claim succeeds with a deterministic private key signing the exact returned challenge message.
- Solana username claim succeeds with a deterministic Ed25519 keypair signing the exact returned challenge message.
- Invalid signature is rejected and does not consume the ability to retry with a correct signature.
- Replayed or expired challenges are rejected.
- A challenge requested by one user cannot be claimed by another user.
- Concurrent or sequential contention cannot claim an already-taken username.
- A user whose primary wallet is already set cannot claim an incompatible primary wallet.
- Profile lookup returns the claimed username and wallet data after a successful claim.

The tests should avoid exhaustive validation-matrix coverage for every username regex edge. Those cases are better suited to unit tests.

## Authentication and Identity

The E2E tests should use the same identity mechanisms exposed by the API:

- Anonymous/generated users should be created by calling `identity.getCurrentUser` through the test oRPC client, not by inserting users directly.
- If the identity context uses headers or cookies for generated users, the E2E client helper owns one isolated credential jar per test and reuses it across calls in that test.
- Wallet signatures should be generated deterministically by the test helpers.
- Privy-specific protected routes should only be included if they are directly needed for username behavior. Otherwise, leave Privy coverage to a separate E2E spec.

## Error Handling

Tests should assert stable observable errors rather than internal implementation details.

For expected failures, assert:

- The route rejects the request.
- The high-level error code or category is correct.
- The failed attempt does not create partial username, wallet, challenge, or profile state.

Teardown errors should fail the test run. A leaked test database is not acceptable hidden cleanup debt.

## Data Flow

The primary happy path is:

1. Test creates a fresh database and runs migrations.
2. Test starts the backend server with that database URL.
3. Test creates an oRPC client pointed at the test server.
4. Test gets or creates the current generated user.
5. Test checks username availability.
6. Test requests a claim challenge for a deterministic wallet.
7. Test signs the returned challenge message.
8. Test submits the claim.
9. Test verifies API responses and persisted profile behavior.
10. Test closes the server and drops the database.

## Tooling and Configuration

Add E2E scripts without changing the existing unit test command:

- Root `package.json`: `"test:e2e": "yarn workspace @fillx/server test:e2e"`.
- `server/package.json`: `"test:e2e": "tsx --test --test-concurrency=1 ../e2e/**/*.test.ts"`.

Required environment:

- `E2E_DATABASE_ADMIN_URL`: admin Postgres URL with permission to create and drop databases.

Derived per test:

- `DATABASE_URL`: application Postgres URL pointing at the unique test database.

The E2E helpers should reject unsafe admin URLs and unsafe generated database names before issuing create or drop commands.

## Risks and Mitigations

- Cached database client leaks between tests: add an explicit close/reset helper and call it during teardown.
- Server starts at import time: extract a server factory and keep production listen logic isolated.
- Dropping a database fails because of open connections: close the app pool first, then terminate remaining connections from the admin connection before dropping.
- Parallel execution races through shared process environment: run E2E tests serially in the initial implementation.
- Solana wallet lookup may expose address lowercasing bugs: keep a Solana profile lookup test in the required matrix.

## Acceptance Criteria

- `fillx_backend/e2e/` exists with username-focused backend API E2E tests and helpers.
- Each test creates a unique database and drops it afterward.
- Tests run through the real HTTP server and oRPC client.
- Tests do not use Supertest.
- Existing unit test command remains available.
- A dedicated E2E command is documented in package scripts.
- The username E2E suite fails fast when `E2E_DATABASE_ADMIN_URL` is missing or unsafe.
