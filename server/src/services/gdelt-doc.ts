// GDELT Doc API proxy - article search

const GDELT_CACHE_TTL_MS = 300 * 1000; // 5 minutes
const MAX_RECORDS = 20;
const DEFAULT_RECORDS = 10;

let cache: { data: unknown; expires: number; key: string } | null = null;

interface GdeltArticle {
  title: string;
  url: string;
  source: string;
  date: string;
  image: string;
  language: string;
  tone: number;
}

interface GdeltDocResult {
  articles: GdeltArticle[];
  query: string;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export async function fetchGdeltDoc(
  query: string,
  maxrecords?: number,
  timespan?: string,
): Promise<GdeltDocResult> {
  if (!query || query.length < 2) {
    throw new Error('Query parameter required');
  }

  const effectiveMaxrecords = Math.min(
    maxrecords ?? DEFAULT_RECORDS,
    MAX_RECORDS,
  );
  const effectiveTimespan = timespan || '72h';

  const cacheKey = `gdelt-doc:${hashString(`${query}:${effectiveMaxrecords}:${effectiveTimespan}`)}`;
  const now = Date.now();

  if (cache && cache.key === cacheKey && now < cache.expires) {
    return cache.data as GdeltDocResult;
  }

  const gdeltUrl = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  gdeltUrl.searchParams.set('query', query);
  gdeltUrl.searchParams.set('mode', 'artlist');
  gdeltUrl.searchParams.set('maxrecords', effectiveMaxrecords.toString());
  gdeltUrl.searchParams.set('format', 'json');
  gdeltUrl.searchParams.set('sort', 'date');
  gdeltUrl.searchParams.set('timespan', effectiveTimespan);

  const response = await fetch(gdeltUrl.toString());

  if (!response.ok) {
    throw new Error(`GDELT returned ${response.status}`);
  }

  const data = await response.json();

  const articles: GdeltArticle[] = (data.articles || []).map(
    (article: Record<string, unknown>) => ({
      title: article.title,
      url: article.url,
      source: (article as Record<string, unknown>).domain || ((article as Record<string, unknown>).source as Record<string, unknown>)?.domain,
      date: article.seendate,
      image: article.socialimage,
      language: article.language,
      tone: article.tone,
    }),
  );

  const result: GdeltDocResult = { articles, query };

  cache = { data: result, expires: now + GDELT_CACHE_TTL_MS, key: cacheKey };

  return result;
}
