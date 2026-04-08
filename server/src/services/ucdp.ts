// UCDP (Uppsala Conflict Data Program) proxy
// Returns conflict classification per country with intensity levels
// No auth required - public API

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (annual data)

let cache: { data: unknown; expires: number } | null = null;

interface UcdpConflictEntry {
  conflictId: number;
  conflictName: string;
  location: string;
  year: number;
  intensityLevel: number;
  typeOfConflict: number;
  startDate: string;
  startDate2: string;
  sideA: string;
  sideB: string;
  region: string;
}

interface UcdpResult {
  success: boolean;
  count: number;
  conflicts: UcdpConflictEntry[];
  cached_at: string;
}

export async function fetchUcdpConflicts(): Promise<UcdpResult> {
  const now = Date.now();

  if (cache && now < cache.expires) {
    return cache.data as UcdpResult;
  }

  // Fetch all pages of conflicts
  let allConflicts: Record<string, unknown>[] = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages) {
    const response = await fetch(
      `https://ucdpapi.pcr.uu.se/api/ucdpprioconflict/24.1?pagesize=100&page=${page}`,
      { headers: { Accept: 'application/json' } },
    );

    if (!response.ok) {
      throw new Error(`UCDP API error: ${response.status}`);
    }

    const rawData = await response.json();
    totalPages = rawData.TotalPages || 1;
    const conflicts = rawData.Result || [];
    allConflicts = allConflicts.concat(conflicts);
    page++;
  }

  // Keep most recent / highest intensity per location
  const countryConflicts: Record<string, UcdpConflictEntry> = {};
  for (const c of allConflicts) {
    const name = (c.location as string) || '';
    const year = parseInt(String(c.year), 10) || 0;
    const intensity = parseInt(String(c.intensity_level), 10) || 0;

    const entry: UcdpConflictEntry = {
      conflictId: parseInt(String(c.conflict_id), 10) || 0,
      conflictName: (c.side_b as string) || '',
      location: name,
      year,
      intensityLevel: intensity,
      typeOfConflict: parseInt(String(c.type_of_conflict), 10) || 0,
      startDate: c.start_date as string,
      startDate2: c.start_date2 as string,
      sideA: c.side_a as string,
      sideB: c.side_b as string,
      region: c.region as string,
    };

    if (
      !countryConflicts[name] ||
      year > countryConflicts[name].year ||
      (year === countryConflicts[name].year && intensity > countryConflicts[name].intensityLevel)
    ) {
      countryConflicts[name] = entry;
    }
  }

  const result: UcdpResult = {
    success: true,
    count: Object.keys(countryConflicts).length,
    conflicts: Object.values(countryConflicts),
    cached_at: new Date().toISOString(),
  };

  cache = { data: result, expires: now + CACHE_TTL_MS };

  return result;
}
