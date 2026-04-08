/**
 * ArXiv Service
 * Fetches AI/ML papers from ArXiv API.
 * Returns raw XML for client-side parsing.
 */

interface ArxivParams {
  category?: string;
  max_results?: string;
  sortBy?: string;
}

interface ArxivResult {
  data: string;
  contentType: string;
}

export async function getArxivPapers(params?: ArxivParams): Promise<ArxivResult> {
  const category = params?.category || 'cs.AI';
  const maxResults = params?.max_results || '50';
  const sortBy = params?.sortBy || 'submittedDate';

  const query = `cat:${category}`;
  const apiUrl = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'GlobalIntel/1.0 (AI Research Tracker)',
      },
    });

    if (!response.ok) {
      throw new Error(`ArXiv API returned ${response.status}`);
    }

    const xmlData = await response.text();
    return { data: xmlData, contentType: 'application/xml' };
  } catch (error: any) {
    throw new Error(`Failed to fetch ArXiv data: ${error.message}`);
  }
}
