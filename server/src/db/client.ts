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
