// Temporal Baseline Anomaly Detection service
// Stores and queries activity baselines using Welford's online algorithm
// Uses in-memory cache for persistence

const BASELINE_TTL_MS = 7776000 * 1000; // 90 days
const MIN_SAMPLES = 10;
const Z_THRESHOLD_LOW = 1.5;
const Z_THRESHOLD_MEDIUM = 2.0;
const Z_THRESHOLD_HIGH = 3.0;

const VALID_TYPES = ['military_flights', 'vessels', 'protests', 'news', 'ais_gaps', 'satellite_fires'];

interface BaselineEntry {
  mean: number;
  m2: number;
  sampleCount: number;
  lastUpdated: string;
}

interface AnomalyResult {
  zScore: number;
  severity: string;
  multiplier: number;
}

interface CheckResult {
  anomaly: AnomalyResult | null;
  baseline?: {
    mean: number;
    stdDev: number;
    sampleCount: number;
  };
  learning: boolean;
  sampleCount?: number;
  samplesNeeded?: number;
}

interface UpdateItem {
  type: string;
  region?: string;
  count: number;
}

// In-memory store for baselines
const baselineStore = new Map<string, { data: BaselineEntry; expires: number }>();

function makeKey(type: string, region: string, weekday: number, month: number): string {
  return `baseline:${type}:${region}:${weekday}:${month}`;
}

function getSeverity(zScore: number): string {
  if (zScore >= Z_THRESHOLD_HIGH) return 'critical';
  if (zScore >= Z_THRESHOLD_MEDIUM) return 'high';
  if (zScore >= Z_THRESHOLD_LOW) return 'medium';
  return 'normal';
}

function getBaseline(key: string): BaselineEntry | null {
  const entry = baselineStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    baselineStore.delete(key);
    return null;
  }
  return entry.data;
}

function setBaseline(key: string, data: BaselineEntry): void {
  baselineStore.set(key, { data, expires: Date.now() + BASELINE_TTL_MS });
}

export async function checkAnomaly(
  type: string,
  count: number,
  region = 'global',
): Promise<CheckResult> {
  if (!type || !VALID_TYPES.includes(type) || isNaN(count)) {
    throw new Error('Missing or invalid params: type, count required');
  }

  const now = new Date();
  const weekday = now.getUTCDay();
  const month = now.getUTCMonth() + 1;
  const key = makeKey(type, region, weekday, month);

  const baseline = getBaseline(key);

  if (!baseline || baseline.sampleCount < MIN_SAMPLES) {
    return {
      anomaly: null,
      learning: true,
      sampleCount: baseline?.sampleCount || 0,
      samplesNeeded: MIN_SAMPLES,
    };
  }

  const variance = Math.max(0, baseline.m2 / (baseline.sampleCount - 1));
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev > 0 ? Math.abs((count - baseline.mean) / stdDev) : 0;
  const severity = getSeverity(zScore);
  const multiplier = baseline.mean > 0
    ? Math.round((count / baseline.mean) * 100) / 100
    : count > 0 ? 999 : 1;

  return {
    anomaly: zScore >= Z_THRESHOLD_LOW ? {
      zScore: Math.round(zScore * 100) / 100,
      severity,
      multiplier,
    } : null,
    baseline: {
      mean: Math.round(baseline.mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      sampleCount: baseline.sampleCount,
    },
    learning: false,
  };
}

export async function updateBaselines(
  updates: UpdateItem[],
): Promise<{ updated: number }> {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('Body must have updates array');
  }

  const batch = updates.slice(0, 20);
  const now = new Date();
  const weekday = now.getUTCDay();
  const month = now.getUTCMonth() + 1;

  let writeCount = 0;

  for (const { type, region = 'global', count } of batch) {
    if (!VALID_TYPES.includes(type) || typeof count !== 'number' || isNaN(count)) continue;

    const key = makeKey(type, region, weekday, month);
    const prev = getBaseline(key) || { mean: 0, m2: 0, sampleCount: 0, lastUpdated: '' };

    const n = prev.sampleCount + 1;
    const delta = count - prev.mean;
    const newMean = prev.mean + delta / n;
    const delta2 = count - newMean;
    const newM2 = prev.m2 + delta * delta2;

    setBaseline(key, {
      mean: newMean,
      m2: newM2,
      sampleCount: n,
      lastUpdated: now.toISOString(),
    });

    writeCount++;
  }

  return { updated: writeCount };
}
