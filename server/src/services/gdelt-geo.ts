// GDELT Geo API proxy with security hardening

const ALLOWED_FORMATS = ['geojson', 'json', 'csv'];
const MAX_RECORDS = 500;
const MIN_RECORDS = 1;
const ALLOWED_TIMESPANS = ['1d', '7d', '14d', '30d', '60d', '90d'];

function validateMaxRecords(val: string | number | undefined): number {
  const num = parseInt(String(val), 10);
  if (isNaN(num)) return 250;
  return Math.max(MIN_RECORDS, Math.min(MAX_RECORDS, num));
}

function validateFormat(val: string | undefined): string {
  return val && ALLOWED_FORMATS.includes(val) ? val : 'geojson';
}

function validateTimespan(val: string | undefined): string {
  return val && ALLOWED_TIMESPANS.includes(val) ? val : '7d';
}

function sanitizeQuery(val: string | undefined): string {
  if (!val || typeof val !== 'string') return 'protest';
  return val.slice(0, 200).replace(/[<>"']/g, '');
}

interface GdeltGeoOptions {
  query?: string;
  format?: string;
  maxrecords?: string | number;
  timespan?: string;
}

export async function fetchGdeltGeo(
  options: GdeltGeoOptions = {},
): Promise<string> {
  const query = sanitizeQuery(options.query);
  const format = validateFormat(options.format);
  const maxrecords = validateMaxRecords(options.maxrecords);
  const timespan = validateTimespan(options.timespan);

  const response = await fetch(
    `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&format=${format}&maxrecords=${maxrecords}&timespan=${timespan}`,
  );

  if (!response.ok) {
    throw new Error('Upstream service unavailable');
  }

  const data = await response.text();
  return data;
}

export function getContentType(format?: string): string {
  return format === 'csv' ? 'text/csv' : 'application/json';
}
