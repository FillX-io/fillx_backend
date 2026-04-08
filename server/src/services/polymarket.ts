const GAMMA_BASE = "https://gamma-api.polymarket.com";

const ALLOWED_ORDER = ["volume", "liquidity", "startDate", "endDate", "spread"];
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

function validateBoolean(val: string | null, defaultVal: string): string {
  if (val === "true" || val === "false") return val;
  return defaultVal;
}

function validateLimit(val: string | null): number {
  const num = parseInt(val || "", 10);
  if (isNaN(num)) return 50;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, num));
}

function validateOrder(val: string | null): string {
  return val && ALLOWED_ORDER.includes(val) ? val : "volume";
}

function sanitizeTagSlug(val: string | null): string | null {
  if (!val) return null;
  return val.replace(/[^a-z0-9-]/gi, "").slice(0, 100) || null;
}

async function tryFetch(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function buildUrl(
  base: string,
  endpoint: string,
  params: URLSearchParams
): string {
  if (endpoint === "events") {
    return `${base}/events?${params}`;
  }
  return `${base}/markets?${params}`;
}

interface PolymarketParams {
  endpoint?: string;
  closed?: string;
  order?: string;
  ascending?: string;
  limit?: string;
  tag?: string;
}

export async function fetchPolymarket(params: PolymarketParams) {
  const endpoint = params.endpoint || "markets";

  const closed = validateBoolean(params.closed || null, "false");
  const order = validateOrder(params.order || null);
  const ascending = validateBoolean(params.ascending || null, "false");
  const limit = validateLimit(params.limit || null);

  const queryParams = new URLSearchParams({
    closed,
    order,
    ascending,
    limit: String(limit),
  });

  if (endpoint === "events") {
    const tag = sanitizeTagSlug(params.tag || null);
    if (tag) queryParams.set("tag_slug", tag);
  }

  try {
    const data = await tryFetch(buildUrl(GAMMA_BASE, endpoint, queryParams));
    return JSON.parse(data);
  } catch {
    // Expected: Cloudflare blocks non-browser TLS connections
    return [];
  }
}
