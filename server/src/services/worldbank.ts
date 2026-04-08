/**
 * World Bank API Service
 * Proxies requests to World Bank data API for tech/economic indicators.
 */

const TECH_INDICATORS: Record<string, string> = {
  'IT.NET.USER.ZS': 'Internet Users (% of population)',
  'IT.CEL.SETS.P2': 'Mobile Subscriptions (per 100 people)',
  'IT.NET.BBND.P2': 'Fixed Broadband Subscriptions (per 100 people)',
  'IT.NET.SECR.P6': 'Secure Internet Servers (per million people)',
  'GB.XPD.RSDV.GD.ZS': 'R&D Expenditure (% of GDP)',
  'IP.PAT.RESD': 'Patent Applications (residents)',
  'IP.PAT.NRES': 'Patent Applications (non-residents)',
  'IP.TMK.TOTL': 'Trademark Applications',
  'TX.VAL.TECH.MF.ZS': 'High-Tech Exports (% of manufactured exports)',
  'BX.GSR.CCIS.ZS': 'ICT Service Exports (% of service exports)',
  'TM.VAL.ICTG.ZS.UN': 'ICT Goods Imports (% of total goods imports)',
  'SE.TER.ENRR': 'Tertiary Education Enrollment (%)',
  'SE.XPD.TOTL.GD.ZS': 'Education Expenditure (% of GDP)',
  'NY.GDP.MKTP.KD.ZG': 'GDP Growth (annual %)',
  'NY.GDP.PCAP.CD': 'GDP per Capita (current US$)',
  'NE.EXP.GNFS.ZS': 'Exports of Goods & Services (% of GDP)',
};

const TECH_COUNTRIES = [
  'USA', 'CHN', 'JPN', 'DEU', 'KOR', 'GBR', 'IND', 'ISR', 'SGP', 'TWN',
  'FRA', 'CAN', 'SWE', 'NLD', 'CHE', 'FIN', 'IRL', 'AUS', 'BRA', 'IDN',
  'ARE', 'SAU', 'QAT', 'BHR', 'EGY', 'TUR',
  'MYS', 'THA', 'VNM', 'PHL',
  'ESP', 'ITA', 'POL', 'CZE', 'DNK', 'NOR', 'AUT', 'BEL', 'PRT', 'EST',
  'MEX', 'ARG', 'CHL', 'COL',
  'ZAF', 'NGA', 'KEN',
];

interface WorldBankParams {
  indicator?: string;
  country?: string;
  countries?: string;
  years?: string;
  action?: string;
}

interface CountryData {
  code: string;
  name: string;
  values: { year: string; value: number }[];
}

interface WorldBankResult {
  indicator?: string;
  indicatorName?: string;
  indicators?: Record<string, string>;
  defaultCountries?: string[];
  metadata?: { page: number; pages: number; total: number };
  byCountry?: Record<string, CountryData>;
  latestByCountry?: Record<string, { code: string; name: string; year: string; value: number }>;
  timeSeries?: { countryCode: string; countryName: string; year: string; value: number }[];
  error?: string;
  availableIndicators?: string[];
}

export async function getWorldBankData(params: WorldBankParams): Promise<WorldBankResult> {
  const { indicator, country, countries, years = '5', action } = params;

  if (action === 'indicators') {
    return { indicators: TECH_INDICATORS, defaultCountries: TECH_COUNTRIES };
  }

  if (!indicator) {
    return { error: 'Missing indicator parameter', availableIndicators: Object.keys(TECH_INDICATORS) };
  }

  try {
    let countryList = country || countries || TECH_COUNTRIES.join(';');
    if (countries) {
      countryList = countries.split(',').join(';');
    }

    const currentYear = new Date().getFullYear();
    const startYear = currentYear - parseInt(years);

    const wbUrl = `https://api.worldbank.org/v2/country/${countryList}/indicator/${indicator}?format=json&date=${startYear}:${currentYear}&per_page=1000`;

    const response = await fetch(wbUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; GlobalIntel/1.0; +https://app.pacifica.fi)',
      },
    });

    if (!response.ok) {
      throw new Error(`World Bank API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data) || data.length < 2 || !data[1]) {
      return {
        indicator,
        indicatorName: TECH_INDICATORS[indicator] || indicator,
        metadata: { page: 1, pages: 1, total: 0 },
        byCountry: {},
        latestByCountry: {},
        timeSeries: [],
      };
    }

    const [metadata, records] = data;

    const transformed: WorldBankResult = {
      indicator,
      indicatorName: TECH_INDICATORS[indicator] || (records[0]?.indicator?.value || indicator),
      metadata: { page: metadata.page, pages: metadata.pages, total: metadata.total },
      byCountry: {},
      latestByCountry: {},
      timeSeries: [],
    };

    for (const record of records || []) {
      const countryCode = record.countryiso3code || record.country?.id;
      const countryName = record.country?.value;
      const year = record.date;
      const value = record.value;

      if (!countryCode || value === null) continue;

      if (!transformed.byCountry![countryCode]) {
        transformed.byCountry![countryCode] = { code: countryCode, name: countryName, values: [] };
      }
      transformed.byCountry![countryCode].values.push({ year, value });

      if (!transformed.latestByCountry![countryCode] || year > transformed.latestByCountry![countryCode].year) {
        transformed.latestByCountry![countryCode] = { code: countryCode, name: countryName, year, value };
      }

      transformed.timeSeries!.push({ countryCode, countryName, year, value });
    }

    for (const c of Object.values(transformed.byCountry!)) {
      c.values.sort((a, b) => a.year.localeCompare(b.year));
    }

    transformed.timeSeries!.sort((a, b) => b.year.localeCompare(a.year) || a.countryCode.localeCompare(b.countryCode));

    return transformed;
  } catch (error: any) {
    return { error: error.message, indicator };
  }
}
