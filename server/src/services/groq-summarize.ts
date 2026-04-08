/**
 * Groq API Summarization Service
 * Uses Llama 3.1 8B Instant for high-throughput summarization.
 * In-memory cache with 24h TTL.
 */

import crypto from 'crypto';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';
const CACHE_TTL_MS = 86400 * 1000; // 24 hours
const CACHE_VERSION = 'v3';

interface SummarizeParams {
  headlines: string[];
  mode?: string;
  geoContext?: string;
  variant?: string;
  lang?: string;
}

interface SummarizeResult {
  summary: string;
  model: string;
  provider: string;
  cached: boolean;
  tokens?: number;
}

interface SummarizeError {
  error: string;
  fallback: true;
  errorType?: string;
  skipped?: boolean;
  reason?: string;
  summary?: null;
}

interface CacheEntry {
  summary: string;
  model: string;
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

function getCacheKey(headlines: string[], mode: string, geoContext = '', variant = 'full', lang = 'en'): string {
  const sorted = headlines.slice(0, 8).sort().join('|');
  const geoHash = geoContext ? ':g' + hashString(geoContext).slice(0, 6) : '';
  const hash = hashString(`${mode}:${sorted}`);
  const normalizedVariant = typeof variant === 'string' && variant ? variant.toLowerCase() : 'full';
  const normalizedLang = typeof lang === 'string' && lang ? lang.toLowerCase() : 'en';

  if (mode === 'translate') {
    const targetLang = normalizedVariant || normalizedLang;
    return `summary:${CACHE_VERSION}:${mode}:${targetLang}:${hash}${geoHash}`;
  }

  return `summary:${CACHE_VERSION}:${mode}:${normalizedVariant}:${normalizedLang}:${hash}${geoHash}`;
}

function deduplicateHeadlines(headlines: string[]): string[] {
  const seen: Set<string>[] = [];
  const unique: string[] = [];

  for (const headline of headlines) {
    const normalized = headline.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const words = new Set(normalized.split(' ').filter((w) => w.length >= 4));

    let isDuplicate = false;
    for (const seenWords of seen) {
      const intersection = [...words].filter((w) => seenWords.has(w));
      const similarity = intersection.length / Math.min(words.size, seenWords.size);
      if (similarity > 0.6) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.push(words);
      unique.push(headline);
    }
  }

  return unique;
}

export async function groqSummarize(params: SummarizeParams): Promise<SummarizeResult | SummarizeError> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { summary: null, fallback: true, skipped: true, reason: 'GROQ_API_KEY not configured', error: 'GROQ_API_KEY not configured' };
  }

  const { headlines, mode = 'brief', geoContext = '', variant = 'full', lang = 'en' } = params;

  if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
    throw new Error('Headlines array required');
  }

  // Check cache first
  const cacheKey = getCacheKey(headlines, mode, geoContext, variant, lang);
  const cached = getCached(cacheKey);
  if (cached && cached.summary) {
    console.log('[Groq] Cache hit:', cacheKey);
    return {
      summary: cached.summary,
      model: cached.model || MODEL,
      provider: 'cache',
      cached: true,
    };
  }

  const uniqueHeadlines = deduplicateHeadlines(headlines.slice(0, 8));
  const headlineText = uniqueHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n');

  let systemPrompt: string;
  let userPrompt: string;

  const intelSection = geoContext ? `\n\n${geoContext}` : '';
  const isTechVariant = variant === 'tech';
  const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}.${isTechVariant ? '' : ' Donald Trump is the current US President (second term, inaugurated Jan 2025).'}`;
  const langInstruction = lang && lang !== 'en' ? `\nIMPORTANT: Output the summary in ${lang.toUpperCase()} language.` : '';

  if (mode === 'brief') {
    if (isTechVariant) {
      systemPrompt = `${dateContext}

Summarize the key tech/startup development in 2-3 sentences.
Rules:
- Focus ONLY on technology, startups, AI, funding, product launches, or developer news
- IGNORE political news, trade policy, tariffs, government actions unless directly about tech regulation
- Lead with the company/product/technology name
- Start directly: "OpenAI announced...", "A new $50M Series B...", "GitHub released..."
- No bullet points, no meta-commentary${langInstruction}`;
    } else {
      systemPrompt = `${dateContext}

Summarize the key development in 2-3 sentences.
Rules:
- Lead with WHAT happened and WHERE - be specific
- NEVER start with "Breaking news", "Good evening", "Tonight", or TV-style openings
- Start directly with the subject: "Iran's regime...", "The US Treasury...", "Protests in..."
- CRITICAL FOCAL POINTS are the main actors - mention them by name
- If focal points show news + signals convergence, that's the lead
- No bullet points, no meta-commentary${langInstruction}`;
    }
    userPrompt = `Summarize the top story:\n${headlineText}${intelSection}`;
  } else if (mode === 'analysis') {
    if (isTechVariant) {
      systemPrompt = `${dateContext}

Analyze the tech/startup trend in 2-3 sentences.
Rules:
- Focus ONLY on technology implications: funding trends, AI developments, market shifts, product strategy
- IGNORE political implications, trade wars, government unless directly about tech policy
- Lead with the insight for tech industry
- Connect to startup ecosystem, VC trends, or technical implications`;
    } else {
      systemPrompt = `${dateContext}

Provide analysis in 2-3 sentences. Be direct and specific.
Rules:
- Lead with the insight - what's significant and why
- NEVER start with "Breaking news", "Tonight", "The key/dominant narrative is"
- Start with substance: "Iran faces...", "The escalation in...", "Multiple signals suggest..."
- CRITICAL FOCAL POINTS are your main actors - explain WHY they matter
- If focal points show news-signal correlation, flag as escalation
- Connect dots, be specific about implications`;
    }
    userPrompt = isTechVariant
      ? `What's the key tech trend or development?\n${headlineText}${intelSection}`
      : `What's the key pattern or risk?\n${headlineText}${intelSection}`;
  } else if (mode === 'translate') {
    const targetLang = variant;
    systemPrompt = `You are a professional news translator. Translate the following news headlines/summaries into ${targetLang}.
Rules:
- Maintain the original tone and journalistic style.
- Do NOT add any conversational filler (e.g., "Here is the translation").
- Output ONLY the translated text.
- If the text is already in ${targetLang}, return it as is.`;
    userPrompt = `Translate to ${targetLang}:\n${headlines[0]}`;
  } else {
    systemPrompt = isTechVariant
      ? `${dateContext}\n\nSynthesize tech news in 2 sentences. Focus on startups, AI, funding, products. Ignore politics unless directly about tech regulation.${langInstruction}`
      : `${dateContext}\n\nSynthesize in 2 sentences max. Lead with substance. NEVER start with "Breaking news" or "Tonight" - just state the insight directly. CRITICAL focal points with news-signal convergence are significant.${langInstruction}`;
    userPrompt = `Key takeaway:\n${headlineText}${intelSection}`;
  }

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
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 150,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Groq] API error:', response.status, errorText);

      if (response.status === 429) {
        return { error: 'Rate limited', fallback: true };
      }

      return { error: 'Groq API error', fallback: true };
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      return { error: 'Empty response', fallback: true };
    }

    setCache(cacheKey, { summary, model: MODEL, timestamp: Date.now() });

    return {
      summary,
      model: MODEL,
      provider: 'groq',
      cached: false,
      tokens: data.usage?.total_tokens || 0,
    };
  } catch (error: any) {
    console.error('[Groq] Error:', error.name, error.message, error.stack?.split('\n')[1]);
    return {
      error: error.message,
      errorType: error.name,
      fallback: true,
    };
  }
}
