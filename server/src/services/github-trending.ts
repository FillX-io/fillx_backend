/**
 * GitHub Trending Service
 * Fetches trending repositories from GitHub (via unofficial API).
 * In-memory cache with 30min TTL.
 */

const GH_CACHE_TTL_MS = 1800 * 1000; // 30 min

const cache = new Map<string, { data: any; expires: number }>();

export async function getGithubTrending(params?: {
  language?: string;
  since?: string;
  spoken_language?: string;
}): Promise<any> {
  const language = params?.language || 'python';
  const since = params?.since || 'daily';
  const spoken_language = params?.spoken_language || '';

  const cacheKey = `github-trending:${language}:${since}:${spoken_language}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  const baseUrl = 'https://api.gitterapp.com/repositories';
  const queryParams = new URLSearchParams({
    language,
    since,
  });

  if (spoken_language) {
    queryParams.append('spoken_language_code', spoken_language);
  }

  const apiUrl = `${baseUrl}?${queryParams.toString()}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GlobalIntel/1.0 (Tech Tracker)',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // Fallback: try alternative API
      const fallbackUrl = `https://gh-trending-api.herokuapp.com/repositories/${language}?since=${since}`;
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!fallbackResponse.ok) {
        throw new Error(`GitHub trending API returned ${fallbackResponse.status}`);
      }

      const data = await fallbackResponse.json();
      cache.set(cacheKey, { data, expires: Date.now() + GH_CACHE_TTL_MS });
      return data;
    }

    const data = await response.json();
    cache.set(cacheKey, { data, expires: Date.now() + GH_CACHE_TTL_MS });
    return data;
  } catch (error: any) {
    throw new Error(`Failed to fetch GitHub trending data: ${error.message}`);
  }
}
