/**
 * Hacker News Service
 * Fetches stories from HackerNews Firebase API.
 * In-memory cache with 5min TTL.
 */

const HN_CACHE_TTL_MS = 300 * 1000; // 5 min
const ALLOWED_STORY_TYPES = new Set(['top', 'new', 'best', 'ask', 'show', 'job']);
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;
const MAX_CONCURRENCY = 10;

interface HNStory {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
  descendants?: number;
  type: string;
  [key: string]: any;
}

interface HNResult {
  type: string;
  stories: HNStory[];
  total: number;
  timestamp: string;
}

const cache = new Map<string, { data: HNResult; expires: number }>();

function parseLimit(rawLimit?: string): number {
  const parsed = Number.parseInt(rawLimit || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

export async function getHackerNews(params?: {
  type?: string;
  limit?: string;
}): Promise<HNResult> {
  const requestedType = params?.type || 'top';
  const storyType = ALLOWED_STORY_TYPES.has(requestedType) ? requestedType : 'top';
  const limit = parseLimit(params?.limit);

  const cacheKey = `hackernews:${storyType}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  const storiesUrl = `https://hacker-news.firebaseio.com/v0/${storyType}stories.json`;

  const storiesResponse = await fetch(storiesUrl, {
    signal: AbortSignal.timeout(10000),
  });

  if (!storiesResponse.ok) {
    throw new Error(`HackerNews API returned ${storiesResponse.status}`);
  }

  const storyIds: number[] = await storiesResponse.json();
  if (!Array.isArray(storyIds)) {
    throw new Error('HackerNews API returned unexpected payload');
  }
  const limitedIds = storyIds.slice(0, limit);

  const stories: HNStory[] = [];
  for (let i = 0; i < limitedIds.length; i += MAX_CONCURRENCY) {
    const batchIds = limitedIds.slice(i, i + MAX_CONCURRENCY);
    const storyPromises = batchIds.map(async (id) => {
      const storyUrl = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
      try {
        const response = await fetch(storyUrl, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          return await response.json();
        }
        return null;
      } catch (error) {
        console.error(`Failed to fetch story ${id}:`, error);
        return null;
      }
    });
    const batchResults = await Promise.all(storyPromises);
    stories.push(...batchResults.filter((story): story is HNStory => story !== null));
  }

  const result: HNResult = {
    type: storyType,
    stories,
    total: stories.length,
    timestamp: new Date().toISOString(),
  };

  cache.set(cacheKey, { data: result, expires: Date.now() + HN_CACHE_TTL_MS });
  return result;
}
