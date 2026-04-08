/**
 * Classify Batch Service
 * Uses Groq LLM to classify multiple news headlines in a single request.
 * In-memory cache with 24h TTL.
 */

import crypto from 'crypto';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';
const CACHE_TTL_MS = 86400 * 1000; // 24 hours
const CACHE_VERSION = 'v1';
const MAX_BATCH_SIZE = 20;

const VALID_LEVELS = ['critical', 'high', 'medium', 'low', 'info'] as const;
const VALID_CATEGORIES = [
  'conflict', 'protest', 'disaster', 'diplomatic', 'economic',
  'terrorism', 'cyber', 'health', 'environmental', 'military',
  'crime', 'infrastructure', 'tech', 'general',
] as const;

type Level = typeof VALID_LEVELS[number];
type Category = typeof VALID_CATEGORIES[number];

interface ClassifyItem {
  level: Level;
  category: Category;
  cached: boolean;
}

interface ClassifyBatchResult {
  results: (ClassifyItem | null)[];
  fallback?: boolean;
}

interface CacheEntry {
  level: Level;
  category: Category;
  timestamp: number;
}

const cache = new Map<string, { data: CacheEntry; expires: number }>();

function hashString(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: CacheEntry): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

function mget(keys: string[]): (CacheEntry | null)[] {
  return keys.map((k) => getCached(k));
}

export async function classifyBatch(params: {
  titles: string[];
  variant?: string;
}): Promise<ClassifyBatchResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { results: [], fallback: true };
  }

  const { titles, variant = 'full' } = params;

  if (!Array.isArray(titles) || titles.length === 0) {
    throw new Error('titles array required');
  }

  const batch = titles.slice(0, MAX_BATCH_SIZE);
  const results: (ClassifyItem | null)[] = new Array(batch.length).fill(null);
  const uncachedIndices: number[] = [];

  const cacheKeys = batch.map(
    (t) => `classify:${CACHE_VERSION}:${hashString(t.toLowerCase() + ':' + variant)}`
  );
  const cached = mget(cacheKeys);
  for (let i = 0; i < cached.length; i++) {
    const val = cached[i];
    if (val && val.level) {
      results[i] = { level: val.level, category: val.category, cached: true };
    } else {
      uncachedIndices.push(i);
    }
  }

  if (uncachedIndices.length === 0) {
    return { results };
  }

  const uncachedTitles = uncachedIndices.map((i) => batch[i]);
  const isTech = variant === 'tech';
  const numberedList = uncachedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const systemPrompt = `You classify news headlines into threat level and category. Return ONLY a valid JSON array, no other text.

Levels: critical, high, medium, low, info
Categories: conflict, protest, disaster, diplomatic, economic, terrorism, cyber, health, environmental, military, crime, infrastructure, tech, general

${isTech ? 'Focus: technology, startups, AI, cybersecurity. Most tech news is "low" or "info" unless it involves outages, breaches, or major disruptions.' : 'Focus: geopolitical events, conflicts, disasters, diplomacy. Classify by real-world severity and impact.'}

Return a JSON array with one object per headline in order: [{"level":"...","category":"..."},...]`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: numberedList },
        ],
        temperature: 0,
        max_tokens: uncachedTitles.length * 60,
      }),
    });

    if (!response.ok) {
      console.error('[ClassifyBatch] Groq error:', response.status);
      return { results, fallback: true };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return { results, fallback: true };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }

    if (!Array.isArray(parsed)) {
      return { results, fallback: true };
    }

    for (let i = 0; i < uncachedIndices.length; i++) {
      const classification = parsed[i];
      if (!classification) continue;

      const level = (VALID_LEVELS as readonly string[]).includes(classification.level) ? classification.level as Level : null;
      const category = (VALID_CATEGORIES as readonly string[]).includes(classification.category) ? classification.category as Category : null;
      if (!level || !category) continue;

      const idx = uncachedIndices[i];
      results[idx] = { level, category, cached: false };

      const cacheKey = `classify:${CACHE_VERSION}:${hashString(batch[idx].toLowerCase() + ':' + variant)}`;
      setCache(cacheKey, { level, category, timestamp: Date.now() });
    }

    return { results };
  } catch (error: any) {
    console.error('[ClassifyBatch] Error:', error.message);
    return { results, fallback: true };
  }
}
