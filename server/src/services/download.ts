/**
 * Download Redirect Service
 * Returns a download URL for the specified platform from the latest GitHub release.
 */

const RELEASES_URL = 'https://api.github.com/repos/pacifica-fi/global-intel/releases/latest';
const RELEASES_PAGE = 'https://github.com/pacifica-fi/global-intel/releases/latest';

const PLATFORM_PATTERNS: Record<string, (name: string) => boolean> = {
  'windows-exe': (name) => name.endsWith('_x64-setup.exe'),
  'windows-msi': (name) => name.endsWith('_x64_en-US.msi'),
  'macos-arm64': (name) => name.endsWith('_aarch64.dmg'),
  'macos-x64': (name) => name.endsWith('_x64.dmg') && !name.includes('setup'),
  'linux-appimage': (name) => name.endsWith('_amd64.AppImage'),
};

interface DownloadResult {
  redirectUrl: string;
}

export async function getDownloadUrl(params?: {
  platform?: string;
}): Promise<DownloadResult> {
  const platform = params?.platform;

  if (!platform || !PLATFORM_PATTERNS[platform]) {
    return { redirectUrl: RELEASES_PAGE };
  }

  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'GlobalIntel-Download-Redirect',
      },
    });

    if (!res.ok) {
      return { redirectUrl: RELEASES_PAGE };
    }

    const release = await res.json();
    const matcher = PLATFORM_PATTERNS[platform];
    const asset = release.assets?.find((a: any) => matcher(a.name));

    if (!asset) {
      return { redirectUrl: RELEASES_PAGE };
    }

    return { redirectUrl: asset.browser_download_url };
  } catch {
    return { redirectUrl: RELEASES_PAGE };
  }
}
