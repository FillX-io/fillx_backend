/**
 * AIS Snapshot Service
 * Fetches AIS vessel data from a WebSocket relay endpoint.
 * Multi-layer cache: memory (8s TTL) + stale fallback (60s).
 */

const CACHE_TTL_MS = 8 * 1000; // 8 seconds
const MEMORY_CACHE_MAX_ENTRIES = 8;
const MEMORY_FALLBACK_MAX_AGE_MS = 60 * 1000;

interface AisSnapshot {
  status: Record<string, any>;
  disruptions: any[];
  density: any[];
  [key: string]: any;
}

interface AisResult {
  vessels?: any[];
  skipped?: boolean;
  reason?: string;
  error?: string;
  status?: Record<string, any>;
  disruptions?: any[];
  density?: any[];
  [key: string]: any;
}

interface CacheEntry {
  data: AisSnapshot;
  timestamp: number;
  lastSeen: number;
}

const memoryCache = new Map<string, CacheEntry>();
const inFlightByKey = new Map<string, Promise<AisSnapshot>>();

function isValidSnapshot(data: any): data is AisSnapshot {
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.status &&
    typeof data.status === 'object' &&
    Array.isArray(data.disruptions) &&
    Array.isArray(data.density)
  );
}

function getMemoryCachedSnapshot(cacheKey: string, allowStale = false): AisSnapshot | null {
  const entry = memoryCache.get(cacheKey);
  if (!entry) return null;

  const now = Date.now();
  const age = now - entry.timestamp;
  if (age > MEMORY_FALLBACK_MAX_AGE_MS) {
    memoryCache.delete(cacheKey);
    return null;
  }

  if (!allowStale && age > CACHE_TTL_MS) {
    return null;
  }

  entry.lastSeen = now;
  return entry.data;
}

function setMemoryCachedSnapshot(cacheKey: string, data: AisSnapshot): void {
  const now = Date.now();
  memoryCache.set(cacheKey, { data, timestamp: now, lastSeen: now });

  if (memoryCache.size <= MEMORY_CACHE_MAX_ENTRIES) return;

  const overflow = memoryCache.size - MEMORY_CACHE_MAX_ENTRIES;
  const oldestEntries = Array.from(memoryCache.entries())
    .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  for (let i = 0; i < overflow; i++) {
    const entry = oldestEntries[i];
    if (!entry) break;
    memoryCache.delete(entry[0]);
  }
}

function getRelayBaseUrl(): string | null {
  const relayUrl = process.env.WS_RELAY_URL;
  if (!relayUrl) return null;
  return relayUrl
    .replace('wss://', 'https://')
    .replace('ws://', 'http://')
    .replace(/\/$/, '');
}

export async function getAisSnapshot(params?: {
  candidates?: boolean;
}): Promise<AisResult> {
  const includeCandidates = params?.candidates ?? false;
  const cacheKey = `ais-snapshot:v1:${includeCandidates ? 'full' : 'lite'}`;

  // Check memory cache
  const memoryCached = getMemoryCachedSnapshot(cacheKey);
  if (isValidSnapshot(memoryCached)) {
    return memoryCached;
  }

  const relayBaseUrl = getRelayBaseUrl();
  if (!relayBaseUrl) {
    return { vessels: [], skipped: true, reason: 'AIS relay not configured' };
  }

  try {
    let requestPromise = inFlightByKey.get(cacheKey);
    if (!requestPromise) {
      requestPromise = (async () => {
        const upstreamUrl = `${relayBaseUrl}/ais/snapshot?candidates=${includeCandidates ? 'true' : 'false'}`;
        const response = await fetch(upstreamUrl, {
          headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`AIS relay HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!isValidSnapshot(data)) {
          throw new Error('Invalid AIS snapshot payload');
        }
        return data;
      })();
      inFlightByKey.set(cacheKey, requestPromise);
    }

    const data = await requestPromise;
    if (!isValidSnapshot(data)) {
      throw new Error('Invalid AIS snapshot payload');
    }

    setMemoryCachedSnapshot(cacheKey, data);
    return data;
  } catch (error) {
    const staleMemory = getMemoryCachedSnapshot(cacheKey, true);
    if (isValidSnapshot(staleMemory)) {
      return staleMemory;
    }

    const errMsg = error instanceof Error ? error.message : String(error || 'Failed to fetch AIS snapshot');
    throw new Error(errMsg);
  } finally {
    inFlightByKey.delete(cacheKey);
  }
}
