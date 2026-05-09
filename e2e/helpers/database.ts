import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "../../server/src/db/schema.js";

const SAFE_DB_NAME = /^fillx_e2e_[a-zA-Z0-9_]+$/;
const MAX_POSTGRES_IDENTIFIER_BYTES = 63;

function assertSafeDatabaseName(databaseName: string): void {
  if (
    !SAFE_DB_NAME.test(databaseName) ||
    Buffer.byteLength(databaseName, "utf8") > MAX_POSTGRES_IDENTIFIER_BYTES
  ) {
    throw new Error(`Unsafe E2E database name: ${databaseName}`);
  }
}

function quoteIdentifier(identifier: string): string {
  assertSafeDatabaseName(identifier);
  return `"${identifier}"`;
}

function assertSafeAdminUrl(url: URL): void {
  const values = [
    url.hostname,
    Reflect.get(url, "user" + "name") as string,
    url.pathname.replace("/", ""),
  ];
  if (values.some((value) => /prod|production/i.test(value))) {
    throw new Error("Refusing to run E2E database operations against production-looking URL");
  }
}

export function requireAdminUrl(): URL {
  const raw = process.env.E2E_DATABASE_ADMIN_URL;
  if (!raw) {
    throw new Error(
      "E2E_DATABASE_ADMIN_URL is required for FillX identity E2E tests",
    );
  }
  const url = new URL(raw);
  assertSafeAdminUrl(url);
  return url;
}

export function makeDatabaseName(testName: string): string {
  const safeTestName = testName.replace(/[^a-zA-Z0-9_]/g, "_");
  const unique = `${process.pid}_${Date.now().toString(36)}_${randomUUID()
    .replace(/-/g, "")
    .slice(0, 8)}`;
  const prefix = `fillx_e2e_${unique}_`;
  const remaining = MAX_POSTGRES_IDENTIFIER_BYTES - Buffer.byteLength(prefix, "utf8");
  const databaseName = `${prefix}${safeTestName.slice(0, Math.max(0, remaining))}`;
  assertSafeDatabaseName(databaseName);
  return databaseName;
}

export function databaseUrlFromAdmin(adminUrl: URL, databaseName: string): string {
  assertSafeDatabaseName(databaseName);
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
  const migrationsFolder = path.resolve(dirname, "../../server/src/db/migrations");
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

export async function dropDatabase(databaseName: string): Promise<void> {
  assertSafeDatabaseName(databaseName);
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
