/**
 * FAA Status Service
 * Proxies FAA airport status information.
 * Returns raw XML data.
 */

interface FaaResult {
  data: string;
  contentType: string;
  status: number;
}

export async function getFaaStatus(): Promise<FaaResult> {
  try {
    const response = await fetch('https://nasstatus.faa.gov/api/airport-status-information', {
      headers: { 'Accept': 'application/xml' },
    });
    const data = await response.text();
    return {
      data,
      contentType: 'application/xml',
      status: response.status,
    };
  } catch (error: any) {
    return {
      data: `<error>${error.message}</error>`,
      contentType: 'application/xml',
      status: 500,
    };
  }
}
