/**
 * Country Intelligence Brief Service
 * Generates AI-powered country situation briefs using Groq.
 * In-memory cache with 2h TTL.
 */

import crypto from 'crypto';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';
const CACHE_TTL_MS = 7200 * 1000; // 2 hours
const CACHE_VERSION = 'ci-v2';

interface CountryContext {
  score?: number;
  change24h?: number;
  level?: string;
  trend?: string;
  components?: { unrest?: number; security?: number; information?: number };
  protests?: number;
  militaryFlights?: number;
  militaryVessels?: number;
  outages?: number;
  earthquakes?: number;
  stockIndex?: string;
  convergenceScore?: number;
  signalTypes?: string[];
  regionalConvergence?: string[];
  headlines?: string[];
}

interface CountryIntelResult {
  brief: string;
  country: string;
  code: string;
  model: string;
  generatedAt: string;
  cached?: boolean;
}

interface FallbackResult {
  intel?: null;
  error?: string;
  fallback: true;
  skipped?: boolean;
  reason?: string;
}

interface CacheEntry {
  brief: string;
  country: string;
  code: string;
  model: string;
  generatedAt: string;
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

export async function getCountryIntel(params: {
  country: string;
  code: string;
  context?: CountryContext;
}): Promise<CountryIntelResult | FallbackResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { intel: null, fallback: true, skipped: true, reason: 'GROQ_API_KEY not configured' };
  }

  const { country, code, context } = params;

  if (!country || !code) {
    throw new Error('country and code required');
  }

  const contextHash = context ? hashString(JSON.stringify(context)).slice(0, 8) : 'no-ctx';
  const cacheKey = `${CACHE_VERSION}:${code}:${contextHash}`;

  const cached = getCached(cacheKey);
  if (cached && cached.brief) {
    console.log('[CountryIntel] Cache hit:', code);
    return { ...cached, cached: true };
  }

  // Build data context section
  const dataLines: string[] = [];
  if (context?.score != null) {
    const changeStr = context.change24h ? ` (${context.change24h > 0 ? '+' : ''}${context.change24h} in 24h)` : '';
    dataLines.push(`Instability Score: ${context.score}/100 (${context.level || 'unknown'}) — trend: ${context.trend || 'unknown'}${changeStr}`);
  }
  if (context?.components) {
    const c = context.components;
    dataLines.push(`Score Components: Unrest ${c.unrest ?? '?'}/100, Security ${c.security ?? '?'}/100, Information ${c.information ?? '?'}/100`);
  }
  if (context?.protests != null) dataLines.push(`Active protests in/near country (7d): ${context.protests}`);
  if (context?.militaryFlights != null) dataLines.push(`Military aircraft detected in/near country: ${context.militaryFlights}`);
  if (context?.militaryVessels != null) dataLines.push(`Military vessels detected in/near country: ${context.militaryVessels}`);
  if (context?.outages != null) dataLines.push(`Internet outages: ${context.outages}`);
  if (context?.earthquakes != null) dataLines.push(`Recent earthquakes: ${context.earthquakes}`);
  if (context?.stockIndex) dataLines.push(`Stock Market Index: ${context.stockIndex}`);
  if (context?.convergenceScore != null) {
    dataLines.push(`Signal convergence score: ${context.convergenceScore}/100 (multiple signal types detected: ${(context.signalTypes || []).join(', ')})`);
  }
  if (context?.regionalConvergence && context.regionalConvergence.length > 0) {
    dataLines.push(`\nRegional convergence alerts:`);
    context.regionalConvergence.forEach((r) => dataLines.push(`- ${r}`));
  }
  if (context?.headlines && context.headlines.length > 0) {
    dataLines.push(`\nRecent headlines mentioning ${country} (${context.headlines.length} found):`);
    context.headlines.slice(0, 15).forEach((h, i) => dataLines.push(`${i + 1}. ${h}`));
  }

  const dataSection = dataLines.length > 0
    ? `\nCURRENT SENSOR DATA:\n${dataLines.join('\n')}`
    : '\nNo real-time sensor data available for this country.';

  const dateStr = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are a senior intelligence analyst providing comprehensive country situation briefs. Current date: ${dateStr}. Donald Trump is the current US President (second term, inaugurated Jan 2025).

Write a thorough, data-driven intelligence brief for the requested country. Structure:

1. **Current Situation** — What is happening right now. Reference specific data: instability scores, protest counts, military presence, outages. Explain what the numbers mean in context.

2. **Military & Security Posture** — Analyze military activity in/near the country. What forces are present? What does the positioning suggest? What are foreign nations doing in this theater?

3. **Key Risk Factors** — What drives instability or stability. Connect the dots between different signals (protests + outages = potential crackdown? military buildup + diplomatic tensions = escalation risk?). Reference specific headlines.

4. **Regional Context** — How does this country's situation affect or relate to its neighbors and the broader region? Reference any convergence alerts.

5. **Outlook & Watch Items** — What to monitor in the near term. Be specific about indicators that would signal escalation or de-escalation.

Rules:
- Be specific and analytical. Reference the data provided (scores, counts, headlines, convergence).
- If data shows low activity, say so — don't manufacture threats.
- Connect signals: explain what combinations of data points suggest.
- 5-6 paragraphs, 300-400 words.
- No speculation beyond what the data supports.
- Use plain language, not jargon.
- If military assets are 0, don't speculate about military presence — say monitoring shows no current military activity.
- When referencing a specific headline from the numbered list, cite it as [N] where N is the headline number (e.g. "tensions escalated [3]"). Only cite headlines you directly reference.`;

  const userPrompt = `Country: ${country} (${code})${dataSection}`;

  try {
    const groqRes = await fetch(GROQ_API_URL, {
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
        temperature: 0.4,
        max_tokens: 900,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('[CountryIntel] Groq error:', groqRes.status, errText);
      return { error: 'AI service error', fallback: true };
    }

    const groqData = await groqRes.json();
    const brief = groqData.choices?.[0]?.message?.content || '';

    const result: CacheEntry = {
      brief,
      country,
      code,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    };

    if (brief) {
      setCache(cacheKey, result);
    }

    return result;
  } catch (err: any) {
    console.error('[CountryIntel] Error:', err);
    return { error: 'Internal error', fallback: true };
  }
}
