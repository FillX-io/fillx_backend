// UNHCR Population API proxy
// Returns displacement data aggregated by country (origin + asylum)

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cache: { data: unknown; expires: number } | null = null;

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AFG: [33.9, 67.7], SYR: [35.0, 38.0], UKR: [48.4, 31.2], SDN: [15.5, 32.5],
  SSD: [6.9, 31.3], SOM: [5.2, 46.2], COD: [-4.0, 21.8], MMR: [19.8, 96.7],
  YEM: [15.6, 48.5], ETH: [9.1, 40.5], VEN: [6.4, -66.6], IRQ: [33.2, 43.7],
  COL: [4.6, -74.1], NGA: [9.1, 7.5], PSE: [31.9, 35.2], TUR: [39.9, 32.9],
  DEU: [51.2, 10.4], PAK: [30.4, 69.3], UGA: [1.4, 32.3], BGD: [23.7, 90.4],
  KEN: [0.0, 38.0], TCD: [15.5, 19.0], JOR: [31.0, 36.0], LBN: [33.9, 35.5],
  EGY: [26.8, 30.8], IRN: [32.4, 53.7], TZA: [-6.4, 34.9], RWA: [-1.9, 29.9],
  CMR: [7.4, 12.4], MLI: [17.6, -4.0], BFA: [12.3, -1.6], NER: [17.6, 8.1],
  CAF: [6.6, 20.9], MOZ: [-18.7, 35.5], USA: [37.1, -95.7], FRA: [46.2, 2.2],
  GBR: [55.4, -3.4], IND: [20.6, 79.0], CHN: [35.9, 104.2], RUS: [61.5, 105.3],
};

interface UnhcrCountryEntry {
  code: string;
  name: string;
  refugees: number;
  asylumSeekers: number;
  idps: number;
  stateless: number;
  totalDisplaced: number;
  hostRefugees: number;
  hostAsylumSeekers: number;
  hostTotal: number;
  lat?: number;
  lon?: number;
}

interface UnhcrFlow {
  originCode: string;
  originName: string;
  asylumCode: string;
  asylumName: string;
  refugees: number;
  originLat?: number;
  originLon?: number;
  asylumLat?: number;
  asylumLon?: number;
}

interface UnhcrResult {
  success: boolean;
  year: number;
  globalTotals: {
    refugees: number;
    asylumSeekers: number;
    idps: number;
    stateless: number;
    total: number;
  };
  countries: UnhcrCountryEntry[];
  topFlows: UnhcrFlow[];
  cached_at: string;
}

async function fetchUnhcrYearItems(year: number): Promise<Record<string, unknown>[] | null> {
  const limit = 10000;
  const maxPageGuard = 25;
  const items: Record<string, unknown>[] = [];

  for (let page = 1; page <= maxPageGuard; page++) {
    const response = await fetch(
      `https://api.unhcr.org/population/v1/population/?year=${year}&limit=${limit}&page=${page}`,
      { headers: { Accept: 'application/json' } },
    );

    if (!response.ok) return null;

    const data = await response.json();
    const pageItems = Array.isArray(data.items) ? data.items : [];
    if (pageItems.length === 0) break;
    items.push(...pageItems);

    const maxPages = Number(data.maxPages);
    if (Number.isFinite(maxPages) && maxPages > 0) {
      if (page >= maxPages) break;
      continue;
    }

    if (pageItems.length < limit) break;
  }

  return items;
}

export async function fetchUnhcrPopulation(): Promise<UnhcrResult> {
  const now = Date.now();

  if (cache && now < cache.expires) {
    return cache.data as UnhcrResult;
  }

  const currentYear = new Date().getFullYear();
  let rawItems: Record<string, unknown>[] = [];
  let dataYearUsed: number | null = null;

  for (let year = currentYear; year >= currentYear - 2; year--) {
    const yearItems = await fetchUnhcrYearItems(year);
    if (!yearItems) continue;
    rawItems = yearItems;
    if (rawItems.length > 0) {
      dataYearUsed = year;
      break;
    }
  }

  const byOrigin: Record<string, { refugees: number; asylumSeekers: number; idps: number; stateless: number; name: string }> = {};
  const byAsylum: Record<string, { refugees: number; asylumSeekers: number; idps: number; stateless: number; name: string }> = {};
  const flowMap: Record<string, { originCode: string; originName: string; asylumCode: string; asylumName: string; refugees: number }> = {};
  let totalRefugees = 0, totalAsylumSeekers = 0, totalIdps = 0, totalStateless = 0;

  for (const item of rawItems) {
    const originCode = (item.coo_iso as string) || '';
    const asylumCode = (item.coa_iso as string) || '';
    const refugees = Number(item.refugees) || 0;
    const asylumSeekers = Number(item.asylum_seekers) || 0;
    const idps = Number(item.idps) || 0;
    const stateless = Number(item.stateless) || 0;

    totalRefugees += refugees;
    totalAsylumSeekers += asylumSeekers;
    totalIdps += idps;
    totalStateless += stateless;

    if (originCode) {
      if (!byOrigin[originCode]) byOrigin[originCode] = { refugees: 0, asylumSeekers: 0, idps: 0, stateless: 0, name: (item.coo_name as string) || originCode };
      byOrigin[originCode].refugees += refugees;
      byOrigin[originCode].asylumSeekers += asylumSeekers;
      byOrigin[originCode].idps += idps;
      byOrigin[originCode].stateless += stateless;
    }

    if (asylumCode) {
      if (!byAsylum[asylumCode]) byAsylum[asylumCode] = { refugees: 0, asylumSeekers: 0, idps: 0, stateless: 0, name: (item.coa_name as string) || asylumCode };
      byAsylum[asylumCode].refugees += refugees;
      byAsylum[asylumCode].asylumSeekers += asylumSeekers;
    }

    if (originCode && asylumCode && refugees > 0) {
      const flowKey = `${originCode}->${asylumCode}`;
      if (!flowMap[flowKey]) {
        flowMap[flowKey] = {
          originCode, originName: (item.coo_name as string) || originCode,
          asylumCode, asylumName: (item.coa_name as string) || asylumCode,
          refugees: 0,
        };
      }
      flowMap[flowKey].refugees += refugees;
    }
  }

  const countries: Record<string, UnhcrCountryEntry> = {};
  for (const [code, data] of Object.entries(byOrigin)) {
    const centroid = COUNTRY_CENTROIDS[code];
    countries[code] = {
      code, name: data.name,
      refugees: data.refugees, asylumSeekers: data.asylumSeekers,
      idps: data.idps, stateless: data.stateless,
      totalDisplaced: data.refugees + data.asylumSeekers + data.idps + data.stateless,
      hostRefugees: 0,
      hostAsylumSeekers: 0,
      hostTotal: 0,
      lat: centroid?.[0], lon: centroid?.[1],
    };
  }
  for (const [code, data] of Object.entries(byAsylum)) {
    const hostRefugees = data.refugees;
    const hostAsylumSeekers = data.asylumSeekers;
    const hostTotal = hostRefugees + hostAsylumSeekers;
    if (!countries[code]) {
      const centroid = COUNTRY_CENTROIDS[code];
      countries[code] = {
        code, name: data.name,
        refugees: 0, asylumSeekers: 0, idps: 0, stateless: 0, totalDisplaced: 0,
        hostRefugees,
        hostAsylumSeekers,
        hostTotal,
        lat: centroid?.[0], lon: centroid?.[1],
      };
    } else {
      countries[code].hostRefugees = hostRefugees;
      countries[code].hostAsylumSeekers = hostAsylumSeekers;
      countries[code].hostTotal = hostTotal;
    }
  }

  const topFlows: UnhcrFlow[] = Object.values(flowMap)
    .sort((a, b) => b.refugees - a.refugees)
    .slice(0, 50)
    .map((f) => {
      const oC = COUNTRY_CENTROIDS[f.originCode];
      const aC = COUNTRY_CENTROIDS[f.asylumCode];
      return {
        ...f,
        originLat: oC?.[0], originLon: oC?.[1],
        asylumLat: aC?.[0], asylumLon: aC?.[1],
      };
    });

  const result: UnhcrResult = {
    success: true,
    year: dataYearUsed ?? currentYear,
    globalTotals: {
      refugees: totalRefugees,
      asylumSeekers: totalAsylumSeekers,
      idps: totalIdps,
      stateless: totalStateless,
      total: totalRefugees + totalAsylumSeekers + totalIdps + totalStateless,
    },
    countries: Object.values(countries).sort((a, b) => {
      const aSize = Math.max(a.totalDisplaced || 0, a.hostTotal || 0);
      const bSize = Math.max(b.totalDisplaced || 0, b.hostTotal || 0);
      return bSize - aSize;
    }),
    topFlows,
    cached_at: new Date().toISOString(),
  };

  cache = { data: result, expires: now + CACHE_TTL_MS };

  return result;
}
