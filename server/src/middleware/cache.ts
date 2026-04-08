// ── Upstash Redis + in-memory fallback cache ──

const isSidecar = (process.env.LOCAL_API_MODE || "").includes("sidecar");

// ── In-memory cache (desktop / sidecar) ──

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

const mem = new Map<string, CacheEntry>();
let persistPath: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight = false;
let persistQueued = false;
let loaded = false;
const MAX_PERSIST_ENTRIES = Math.max(
  100,
  Number(process.env.LOCAL_API_CACHE_PERSIST_MAX || 5000),
);

async function ensureDesktopCache(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const { join } = await import("node:path");
    const { readFileSync } = await import("node:fs");
    const dir = process.env.LOCAL_API_RESOURCE_DIR || ".";
    persistPath = join(dir, "api-cache.json");
    const data = JSON.parse(
      readFileSync(persistPath, "utf8"),
    ) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [k, entry] of Object.entries(data)) {
      if (entry.expiresAt > now) mem.set(k, entry);
    }
    console.log(`[Cache] Loaded ${mem.size} entries from disk`);
  } catch {
    // File doesn't exist yet
  }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of mem) {
      if (v.expiresAt <= now) mem.delete(k);
    }
  }, 60_000);
  timer.unref?.();
}

function buildPersistSnapshot(): Record<string, CacheEntry> {
  const now = Date.now();
  const payload: Record<string, CacheEntry> = Object.create(null) as Record<string, CacheEntry>;
  let kept = 0;

  for (const [key, entry] of mem) {
    if (!entry || entry.expiresAt <= now) continue;
    payload[key] = entry;
    kept += 1;
    if (kept >= MAX_PERSIST_ENTRIES) break;
  }

  return payload;
}

async function persistToDisk(): Promise<void> {
  if (!persistPath) return;
  if (persistInFlight) {
    persistQueued = true;
    return;
  }

  persistInFlight = true;
  try {
    const snapshot = buildPersistSnapshot();
    const json = JSON.stringify(snapshot);
    const { writeFile, rename } = await import("node:fs/promises");
    const tmp = persistPath + ".tmp";
    await writeFile(tmp, json, "utf8");
    await rename(tmp, persistPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Cache] Persist error:", message);
  } finally {
    persistInFlight = false;
    if (persistQueued) {
      persistQueued = false;
      void persistToDisk();
    }
  }
}

function debouncedPersist(): void {
  if (!persistPath) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistToDisk();
  }, 2000);
  persistTimer.unref?.();
}

// ── Redis (cloud / Upstash REST API via fetch) ──

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ?? "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const hasRedisConfig = !!(UPSTASH_URL && UPSTASH_TOKEN);

async function redisCommand<T = unknown>(
  ...args: (string | number)[]
): Promise<T | null> {
  if (!hasRedisConfig || isSidecar) return null;
  try {
    const res = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      console.warn(`[Cache] Redis HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { result: T };
    return body.result ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Cache] Redis request failed:", message);
    return null;
  }
}

// ── Shared API ──

export async function getCachedJson<T = unknown>(
  key: string,
): Promise<T | null> {
  if (isSidecar) {
    await ensureDesktopCache();
    const entry = mem.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      mem.delete(key);
      return null;
    }
    return entry.value as T;
  }

  const raw = await redisCommand<string>("GET", key);
  if (raw === null) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return raw as T;
  }
}

export async function setCachedJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<boolean> {
  if (isSidecar) {
    await ensureDesktopCache();
    mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    debouncedPersist();
    return true;
  }

  const result = await redisCommand("SET", key, JSON.stringify(value), "EX", ttlSeconds);
  return result !== null;
}

export async function mget<T = unknown>(
  ...keys: string[]
): Promise<(T | null)[]> {
  if (isSidecar) {
    await ensureDesktopCache();
    const now = Date.now();
    return keys.map((k) => {
      const entry = mem.get(k);
      if (!entry || entry.expiresAt <= now) return null;
      return entry.value as T;
    });
  }

  if (!hasRedisConfig) return keys.map(() => null);

  const results = await redisCommand<(string | null)[]>("MGET", ...keys);
  if (!results || !Array.isArray(results)) return keys.map(() => null);

  return results.map((raw) => {
    if (raw === null) return null;
    try {
      return typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T);
    } catch {
      return raw as unknown as T;
    }
  });
}

export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
