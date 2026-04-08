/**
 * Classify Event Service
 * Uses Groq LLM to classify news headlines into threat level and category.
 * In-memory cache with 24h TTL.
 */

import crypto from 'crypto';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';
const CACHE_TTL_MS = 86400 * 1000; // 24 hours
const CACHE_VERSION = 'v1';

const VALID_LEVELS = ['critical', 'high', 'medium', 'low', 'info'] as const;
const VALID_CATEGORIES = [
  'conflict', 'protest', 'disaster', 'diplomatic', 'economic',
  'terrorism', 'cyber', 'health', 'environmental', 'military',
  'crime', 'infrastructure', 'tech', 'general',
] as const;

type Level = typeof VALID_LEVELS[number];
type Category = typeof VALID_CATEGORIES[number];

interface ClassifyResult {
  level: Level;
  category: Category;
  confidence: number;
  source: string;
  cached: boolean;
}

interface FallbackResult {
  fallback: true;
  skipped?: boolean;
  reason?: string;
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

export async function classifyEvent(params: {
  title: string;
  variant?: string;
}): Promise<ClassifyResult | FallbackResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { fallback: true, skipped: true, reason: 'GROQ_API_KEY not configured' };
  }

  const { title, variant = 'full' } = params;

  if (!title) {
    throw new Error('title param required');
  }

  const cacheKey = `classify:${CACHE_VERSION}:${hashString(title.toLowerCase() + ':' + variant)}`;

  const cached = getCached(cacheKey);
  if (cached && cached.level) {
    return {
      level: cached.level,
      category: cached.category,
      confidence: 0.9,
      source: 'llm',
      cached: true,
    };
  }

  const isTech = variant === 'tech';
  const systemPrompt = `You classify news headlines into threat level and category. Return ONLY valid JSON, no other text.

Levels: critical, high, medium, low, info
Categories: conflict, protest, disaster, diplomatic, economic, terrorism, cyber, health, environmental, military, crime, infrastructure, tech, general

${isTech ? 'Focus: technology, startups, AI, cybersecurity. Most tech news is "low" or "info" unless it involves outages, breaches, or major disruptions.' : 'Focus: geopolitical events, conflicts, disasters, diplomacy. Classify by real-world severity and impact.'}

Return: {"level":"...","category":"..."}`;

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
          { role: 'user', content: title },
        ],
        temperature: 0,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      console.error('[Classify] Groq error:', response.status);
      return { fallback: true };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return { fallback: true };
    }

    let parsed: { level?: string; category?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[Classify] Invalid JSON from LLM:', raw);
      return { fallback: true };
    }

    const level = (VALID_LEVELS as readonly string[]).includes(parsed.level ?? '') ? parsed.level as Level : null;
    const category = (VALID_CATEGORIES as readonly string[]).includes(parsed.category ?? '') ? parsed.category as Category : null;
    if (!level || !category) {
      return { fallback: true };
    }

    setCache(cacheKey, { level, category, timestamp: Date.now() });

    return {
      level,
      category,
      confidence: 0.9,
      source: 'llm',
      cached: false,
    };
  } catch (error: any) {
    console.error('[Classify] Error:', error.message);
    return { fallback: true };
  }
}
