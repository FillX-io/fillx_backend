export class CookieJar {
  private readonly cookies = new Map<string, string>();
  private lastSetCookies: string[] = [];

  storeFrom(headers: Headers): void {
    const withGetter = headers as Headers & { getSetCookie?: () => string[] };
    const setCookies =
      withGetter.getSetCookie?.() ??
      (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
    this.lastSetCookies = setCookies;

    for (const setCookie of setCookies) {
      const [pair] = setCookie.split(";");
      const index = pair.indexOf("=");
      if (index === -1) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  lastSetCookieHeader(): string | undefined {
    return this.lastSetCookies.length > 0 ? this.lastSetCookies.join("\n") : undefined;
  }
}
