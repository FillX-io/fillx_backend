import type { TestContext } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const e2eEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.env.e2e",
);

const avatarEnvKeys = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "AVATAR_S3_ENDPOINT",
  "AVATAR_S3_FORCE_PATH_STYLE",
  "AVATAR_S3_REGION",
  "AVATAR_S3_INCOMING_BUCKET",
  "AVATAR_S3_PUBLIC_BUCKET",
  "AVATAR_PUBLIC_BASE_URL",
] as const;

const importGuardEnvKeys = [
  "E2E_DATABASE_ADMIN_URL",
] as const;

const e2eEnvKeys = [
  ...importGuardEnvKeys,
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  ...avatarEnvKeys,
] as const;

const importGuardEnvKeySet = new Set<string>(importGuardEnvKeys);
const avatarEnvKeySet = new Set<string>(avatarEnvKeys);

const runtimeEnvKeys = [
  "DATABASE_URL",
  "FILLX_JWT_SECRET",
  "PRIVY_APP_ID",
  "PRIVY_JWT_VERIFICATION_KEY",
  "NODE_ENV",
] as const;

const managedEnvKeys = [...runtimeEnvKeys, ...e2eEnvKeys] as const;

function snapshotEnv(): Map<string, string | undefined> {
  return new Map(managedEnvKeys.map((key) => [key, process.env[key]]));
}

function restoreOptional(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function restoreEnv(previousEnv: Map<string, string | undefined>): void {
  for (const [key, value] of previousEnv) {
    restoreOptional(key, value);
  }
}

function loadE2EEnvValues(input: {
  keys: ReadonlySet<string>;
  forceExisting: boolean;
}): void {
  if (!existsSync(e2eEnvPath)) return;

  for (const line of readFileSync(e2eEnvPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex);
    if (!input.keys.has(key)) continue;
    if (!input.forceExisting && process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(separatorIndex + 1);
  }
}

function loadMissingE2EEnvForImportGuards(): void {
  loadE2EEnvValues({ keys: importGuardEnvKeySet, forceExisting: false });
}

function forceLoadAvatarE2EEnvForServer(): void {
  for (const key of avatarEnvKeys) {
    delete process.env[key];
  }
  loadE2EEnvValues({ keys: avatarEnvKeySet, forceExisting: true });
}

loadMissingE2EEnvForImportGuards();

export async function setupE2E(t: TestContext) {
  const previousEnv = snapshotEnv();
  const adminUrl = requireAdminUrl();
  const databaseName = makeDatabaseName(t.name);
  const databaseUrl = databaseUrlFromAdmin(adminUrl, databaseName);

  let server: Awaited<ReturnType<typeof startTestServer>> | null = null;
  let shouldDrop = false;

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

    if (input.drop) {
      try {
        await dropDatabase(databaseName);
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      restoreEnv(previousEnv);
    } catch (error) {
      errors.push(error);
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
    forceLoadAvatarE2EEnvForServer();
    await createDatabase(databaseName);
    shouldDrop = true;
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
