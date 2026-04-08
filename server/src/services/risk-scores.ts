// Risk Scores API - Cached CII and Strategic Risk computation
// Eliminates 15-minute "learning mode" for users by pre-computing scores
// Uses in-memory cache (10-minute TTL)

const CACHE_TTL_MS = 600 * 1000; // 10 minutes
const STALE_CACHE_TTL_MS = 3600 * 1000; // 1 hour

let cache: { data: unknown; expires: number } | null = null;
let staleCache: { data: unknown; expires: number } | null = null;

// Tier 1 countries for CII
const TIER1_COUNTRIES: Record<string, string> = {
  US: 'United States', RU: 'Russia', CN: 'China', UA: 'Ukraine', IR: 'Iran',
  IL: 'Israel', TW: 'Taiwan', KP: 'North Korea', SA: 'Saudi Arabia', TR: 'Turkey',
  PL: 'Poland', DE: 'Germany', FR: 'France', GB: 'United Kingdom', IN: 'India',
  PK: 'Pakistan', SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
};

// Baseline geopolitical risk (0-50)
const BASELINE_RISK: Record<string, number> = {
  US: 5, RU: 35, CN: 25, UA: 50, IR: 40, IL: 45, TW: 30, KP: 45,
  SA: 20, TR: 25, PL: 10, DE: 5, FR: 10, GB: 5, IN: 20, PK: 35,
  SY: 50, YE: 50, MM: 45, VE: 40,
};

// Event significance multipliers
const EVENT_MULTIPLIER: Record<string, number> = {
  US: 0.3, RU: 2.0, CN: 2.5, UA: 0.8, IR: 2.0, IL: 0.7, TW: 1.5, KP: 3.0,
  SA: 2.0, TR: 1.2, PL: 0.8, DE: 0.5, FR: 0.6, GB: 0.5, IN: 0.8, PK: 1.5,
  SY: 0.7, YE: 0.7, MM: 1.8, VE: 1.8,
};

// Country keywords for matching
const COUNTRY_KEYWORDS: Record<string, string[]> = {
  US: ['united states', 'usa', 'america', 'washington', 'biden', 'trump', 'pentagon'],
  RU: ['russia', 'moscow', 'kremlin', 'putin'],
  CN: ['china', 'beijing', 'xi jinping', 'prc'],
  UA: ['ukraine', 'kyiv', 'zelensky', 'donbas'],
  IR: ['iran', 'tehran', 'khamenei', 'irgc'],
  IL: ['israel', 'tel aviv', 'netanyahu', 'idf', 'gaza'],
  TW: ['taiwan', 'taipei'],
  KP: ['north korea', 'pyongyang', 'kim jong'],
  SA: ['saudi arabia', 'riyadh'],
  TR: ['turkey', 'ankara', 'erdogan'],
  PL: ['poland', 'warsaw'],
  DE: ['germany', 'berlin'],
  FR: ['france', 'paris', 'macron'],
  GB: ['britain', 'uk', 'london'],
  IN: ['india', 'delhi', 'modi'],
  PK: ['pakistan', 'islamabad'],
  SY: ['syria', 'damascus'],
  YE: ['yemen', 'sanaa', 'houthi'],
  MM: ['myanmar', 'burma'],
  VE: ['venezuela', 'caracas', 'maduro'],
};

interface CiiScore {
  code: string;
  name: string;
  score: number;
  level: string;
  trend: string;
  change24h: number;
  components: { unrest: number; security: number; information: number };
  lastUpdated: string;
}

interface StrategicRisk {
  score: number;
  level: string;
  trend: string;
  lastUpdated: string;
  contributors: { country: string; code: string; score: number; level: string }[];
}

interface RiskScoresResult {
  cii: CiiScore[];
  strategicRisk: StrategicRisk;
  protestCount: number;
  computedAt: string;
  cached?: boolean;
  stale?: boolean;
  baseline?: boolean;
  error?: string;
}

function normalizeCountryName(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [code, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return code;
  }
  return null;
}

function getScoreLevel(score: number): string {
  if (score >= 70) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 40) return 'elevated';
  if (score >= 25) return 'normal';
  return 'low';
}

async function fetchACLEDProtests(): Promise<Record<string, unknown>[]> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const token = process.env.ACLED_ACCESS_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(
      `https://acleddata.com/api/acled/read?_format=json&event_type=Protests&event_type=Riots&event_date=${startDate}|${endDate}&event_date_where=BETWEEN&limit=500`,
      { headers, signal: controller.signal },
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('ACLED API requires valid authentication token');
      }
      throw new Error(`ACLED API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.message) throw new Error(data.message);
    if (data.error || data.success === false) throw new Error(data.error || 'ACLED API error');

    return data.data || [];
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function computeCIIScores(protests: Record<string, unknown>[]): CiiScore[] {
  const countryEvents = new Map<string, { protests: number; riots: number }>();

  for (const event of protests) {
    const country = event.country as string;
    const code = normalizeCountryName(country);
    if (code && TIER1_COUNTRIES[code]) {
      const count = countryEvents.get(code) || { protests: 0, riots: 0 };
      if (event.event_type === 'Riots') {
        count.riots++;
      } else {
        count.protests++;
      }
      countryEvents.set(code, count);
    }
  }

  const scores: CiiScore[] = [];
  const now = new Date();

  for (const [code, name] of Object.entries(TIER1_COUNTRIES)) {
    const events = countryEvents.get(code) || { protests: 0, riots: 0 };
    const baseline = BASELINE_RISK[code] || 20;
    const multiplier = EVENT_MULTIPLIER[code] || 1.0;

    // Unrest component: protests + riots (riots weighted 2x)
    const unrestRaw = (events.protests + events.riots * 2) * multiplier;
    const unrest = Math.min(100, Math.round(unrestRaw * 2));

    // Security component: baseline + riot contribution
    const security = Math.min(100, baseline + events.riots * multiplier * 5);

    // Information component: based on event count (proxy for news coverage)
    const totalEvents = events.protests + events.riots;
    const information = Math.min(100, totalEvents * multiplier * 3);

    // Composite score: weighted average + baseline
    const composite = Math.min(100, Math.round(
      baseline +
      (unrest * 0.4 + security * 0.35 + information * 0.25) * 0.5,
    ));

    scores.push({
      code,
      name,
      score: composite,
      level: getScoreLevel(composite),
      trend: 'stable',
      change24h: 0,
      components: { unrest, security, information },
      lastUpdated: now.toISOString(),
    });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function computeStrategicRisk(ciiScores: CiiScore[]): StrategicRisk {
  const top5 = ciiScores.slice(0, 5);
  const weights = top5.map((_, i) => 1 - (i * 0.15));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const weightedSum = top5.reduce((sum, s, i) => sum + s.score * weights[i], 0);
  const ciiComponent = weightedSum / totalWeight;

  const overallScore = Math.round(ciiComponent * 0.7 + 15);

  return {
    score: Math.min(100, overallScore),
    level: getScoreLevel(overallScore),
    trend: 'stable',
    lastUpdated: new Date().toISOString(),
    contributors: top5.map(s => ({
      country: s.name,
      code: s.code,
      score: s.score,
      level: s.level,
    })),
  };
}

export async function fetchRiskScores(): Promise<RiskScoresResult> {
  const now = Date.now();

  if (!process.env.ACLED_ACCESS_TOKEN) {
    const baselineScores = computeCIIScores([]);
    const baselineStrategic = computeStrategicRisk(baselineScores);
    return {
      cii: baselineScores,
      strategicRisk: baselineStrategic,
      protestCount: 0,
      computedAt: new Date().toISOString(),
      baseline: true,
      error: 'ACLED token not configured - showing baseline risk assessments',
    };
  }

  // Check cache
  if (cache && now < cache.expires) {
    return { ...(cache.data as RiskScoresResult), cached: true };
  }

  try {
    const protests = await fetchACLEDProtests();
    const ciiScores = computeCIIScores(protests);
    const strategicRisk = computeStrategicRisk(ciiScores);

    const result: RiskScoresResult = {
      cii: ciiScores,
      strategicRisk,
      protestCount: protests.length,
      computedAt: new Date().toISOString(),
    };

    cache = { data: result, expires: now + CACHE_TTL_MS };
    staleCache = { data: result, expires: now + STALE_CACHE_TTL_MS };

    return { ...result, cached: false };
  } catch {
    // Try stale cache
    if (staleCache && now < staleCache.expires) {
      return {
        ...(staleCache.data as RiskScoresResult),
        cached: true,
        stale: true,
        error: 'Using cached data - ACLED temporarily unavailable',
      };
    }

    // Final fallback: baseline scores
    const baselineScores = computeCIIScores([]);
    const baselineStrategic = computeStrategicRisk(baselineScores);
    return {
      cii: baselineScores,
      strategicRisk: baselineStrategic,
      protestCount: 0,
      computedAt: new Date().toISOString(),
      baseline: true,
      error: 'ACLED unavailable - showing baseline risk assessments',
    };
  }
}
