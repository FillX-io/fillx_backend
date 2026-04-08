/**
 * NGA Maritime Warnings Service
 * Fetches active broadcast warnings from NGA (National Geospatial-Intelligence Agency).
 */

export async function getNgaWarnings(): Promise<any> {
  try {
    const response = await fetch(
      'https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A'
    );
    const data = await response.text();
    return JSON.parse(data);
  } catch (error: any) {
    throw new Error(error.message);
  }
}
