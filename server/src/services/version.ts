/**
 * Version Check Service
 * Fetches latest release info from GitHub.
 */

const RELEASES_URL = 'https://api.github.com/repos/pacifica-fi/global-intel/releases/latest';

interface VersionResult {
  version: string;
  tag: string;
  url: string;
  prerelease: boolean;
}

interface VersionError {
  error: string;
}

export async function getLatestVersion(): Promise<VersionResult | VersionError> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'GlobalIntel-Version-Check',
      },
    });

    if (!res.ok) {
      return { error: 'upstream' };
    }

    const release = await res.json();
    const tag = release.tag_name ?? '';
    const version = tag.replace(/^v/, '');

    return {
      version,
      tag,
      url: release.html_url,
      prerelease: release.prerelease ?? false,
    };
  } catch {
    return { error: 'fetch_failed' };
  }
}
