/**
 * Cloudflare Outages Service
 * Fetches internet outage annotations from Cloudflare Radar API.
 * In-memory cache with 2min TTL.
 */

const CF_CACHE_TTL_MS = 120 * 1000; // 2 min

const cache = new Map<string, { data: any; expires: number }>();

function clampLimit(rawLimit?: string): number {
  const parsed = Number.parseInt(rawLimit || '', 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, parsed));
}

export async function getCloudflareOutages(params?: {
  dateRange?: string;
  limit?: string;
}): Promise<any> {
  const dateRange = params?.dateRange || '7d';
  const limit = clampLimit(params?.limit);

  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return { configured: false };
  }

  const cacheKey = `cf-outages:${dateRange}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=${dateRange}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await response.json();
    cache.set(cacheKey, { data, expires: Date.now() + CF_CACHE_TTL_MS });
    return data;
  } catch (error) {
    // Return empty result on error
    return { success: true, result: { annotations: [] } };
  }
}
