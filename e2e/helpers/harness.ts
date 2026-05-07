import type { TestContext } from "node:test";
import {
  createDatabase,
  databaseUrlFromAdmin,
  dropDatabase,
  makeDatabaseName,
  requireAdminUrl,
  runMigrations,
} from "./database.js";
import { createE2EClient } from "./client.js";
import { CookieJar } from "./session.js";
import { startTestServer } from "./server.js";
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

  function restoreEnv(): void {
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
  }

  await createDatabase(databaseName);

  let server: Awaited<ReturnType<typeof startTestServer>> | null = null;
  let shouldDrop = true;

  async function cleanup(input: { drop: boolean; originalError?: unknown } = { drop: true }) {
    const errors: unknown[] = [];
    if (input.originalError) errors.push(input.originalError);

    if (server) {
      try {
        await server.stop();
      } catch (error) {
        errors.push(error);
      } finally {
        server = null;
      }
    }

    try {
      restoreEnv();
    } catch (error) {
      errors.push(error);
    }

    if (input.drop) {
      try {
        await dropDatabase(databaseName);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "E2E cleanup failed");
    }
  }

  t.after(async () => {
    await cleanup({ drop: shouldDrop });
  });

  let privy: Awaited<ReturnType<typeof createTestPrivy>> | null = null;
  try {
    privy = await createTestPrivy();
    process.env.DATABASE_URL = databaseUrl;
    process.env.FILLX_JWT_SECRET = "e2e-fillx-session-secret";
    process.env.PRIVY_APP_ID = privy.appId;
    process.env.PRIVY_JWT_VERIFICATION_KEY = privy.verificationKey;
    process.env.NODE_ENV = "test";
    await runMigrations(databaseUrl);
    server = await startTestServer();
  } catch (error) {
    try {
      await cleanup({ drop: true, originalError: error });
    } finally {
      shouldDrop = false;
    }
  }

  if (!server || !privy) {
    throw new Error("E2E setup failed before server startup");
  }

  const cookieJar = new CookieJar();
  return {
    baseUrl: server.baseUrl,
    privy,
    cookieJar,
    client: createE2EClient({ baseUrl: server.baseUrl, cookieJar }).client,
    createClient: createE2EClient,
  };
}
