/**
 * Climate Anomalies Service
 * Fetches weather data from Open-Meteo for monitored zones and computes anomalies.
 * In-memory cache with 6h TTL.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface ZoneConfig {
  name: string;
  lat: number;
  lon: number;
}

interface Anomaly {
  zone: string;
  lat: number;
  lon: number;
  tempDelta: number;
  precipDelta: number;
  severity: string;
  type: string;
  period: string;
}

interface ClimateResult {
  success: boolean;
  anomalies: Anomaly[];
  timestamp: string;
}

let fallbackCache: { data: ClimateResult | null; timestamp: number } = { data: null, timestamp: 0 };

const MONITORED_ZONES: ZoneConfig[] = [
  { name: 'Ukraine', lat: 48.4, lon: 31.2 },
  { name: 'Middle East', lat: 33.0, lon: 44.0 },
  { name: 'Sahel', lat: 14.0, lon: 0.0 },
  { name: 'Horn of Africa', lat: 8.0, lon: 42.0 },
  { name: 'South Asia', lat: 25.0, lon: 78.0 },
  { name: 'California', lat: 36.8, lon: -119.4 },
  { name: 'Amazon', lat: -3.4, lon: -60.0 },
  { name: 'Australia', lat: -25.0, lon: 134.0 },
  { name: 'Mediterranean', lat: 38.0, lon: 20.0 },
  { name: 'Taiwan Strait', lat: 24.0, lon: 120.0 },
  { name: 'Myanmar', lat: 19.8, lon: 96.7 },
  { name: 'Central Africa', lat: 4.0, lon: 22.0 },
  { name: 'Southern Africa', lat: -25.0, lon: 28.0 },
  { name: 'Central Asia', lat: 42.0, lon: 65.0 },
  { name: 'Caribbean', lat: 19.0, lon: -72.0 },
];

function classifySeverity(tempDelta: number, precipDelta: number): string {
  const absTemp = Math.abs(tempDelta);
  const absPrecip = Math.abs(precipDelta);
  if (absTemp >= 5 || absPrecip >= 80) return 'extreme';
  if (absTemp >= 3 || absPrecip >= 40) return 'moderate';
  return 'normal';
}

function classifyType(tempDelta: number, precipDelta: number): string {
  const absTemp = Math.abs(tempDelta);
  const absPrecip = Math.abs(precipDelta);
  if (absTemp >= absPrecip / 20) {
    if (tempDelta > 0 && precipDelta < -20) return 'mixed';
    if (tempDelta > 3) return 'warm';
    if (tempDelta < -3) return 'cold';
  }
  if (precipDelta > 40) return 'wet';
  if (precipDelta < -40) return 'dry';
  if (tempDelta > 0) return 'warm';
  return 'cold';
}

function isValidResult(data: any): data is ClimateResult {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.anomalies));
}

export async function getClimateAnomalies(): Promise<ClimateResult> {
  const now = Date.now();

  // Check memory cache
  if (isValidResult(fallbackCache.data) && now - fallbackCache.timestamp < CACHE_TTL_MS) {
    return fallbackCache.data;
  }

  try {
    const endDate = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];

    const fetchZone = async (zone: ZoneConfig): Promise<Anomaly | null> => {
      try {
        const params = new URLSearchParams({
          latitude: String(zone.lat),
          longitude: String(zone.lon),
          start_date: start,
          end_date: end,
          daily: 'temperature_2m_mean,precipitation_sum',
          timezone: 'UTC',
        });

        const resp = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`, {
          headers: { Accept: 'application/json' },
        });

        if (!resp.ok) return null;
        const data = await resp.json();
        const temps: (number | null)[] = data.daily?.temperature_2m_mean || [];
        const precips: (number | null)[] = data.daily?.precipitation_sum || [];

        if (temps.length < 14) return null;

        const validTemps = temps.filter((t): t is number => t !== null);
        const validPrecips = precips.filter((p): p is number => p !== null);

        const last7Temps = validTemps.slice(-7);
        const baseline30Temps = validTemps.slice(0, -7);
        const last7Precips = validPrecips.slice(-7);
        const baseline30Precips = validPrecips.slice(0, -7);

        const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

        const tempDelta = avg(last7Temps) - avg(baseline30Temps);
        const precipDelta = avg(last7Precips) - avg(baseline30Precips);
        const severity = classifySeverity(tempDelta, precipDelta);

        return {
          zone: zone.name,
          lat: zone.lat,
          lon: zone.lon,
          tempDelta: Math.round(tempDelta * 10) / 10,
          precipDelta: Math.round(precipDelta * 10) / 10,
          severity,
          type: classifyType(tempDelta, precipDelta),
          period: `${start} to ${end}`,
        };
      } catch {
        return null;
      }
    };

    const results = await Promise.allSettled(MONITORED_ZONES.map(fetchZone));
    const anomalies = results
      .filter((r): r is PromiseFulfilledResult<Anomaly | null> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value!);

    const result: ClimateResult = {
      success: true,
      anomalies,
      timestamp: new Date().toISOString(),
    };

    fallbackCache = { data: result, timestamp: now };

    return result;
  } catch (error) {
    if (isValidResult(fallbackCache.data)) {
      return fallbackCache.data;
    }

    const errMsg = error instanceof Error ? error.message : String(error || 'unknown error');
    return { success: false, anomalies: [], timestamp: new Date().toISOString() };
  }
}
