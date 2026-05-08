import { createHash, randomBytes } from "node:crypto";
import { getCookie, setCookie } from "@orpc/server/helpers";

export const SECURE_FILLX_SESSION_COOKIE = "__Host-fillx_sid";
export const DEV_FILLX_SESSION_COOKIE = "fillx_sid";
export const LEGACY_FILLX_SESSION_COOKIE = "fillx-session";
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createOpaqueSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readFillxSessionCookie(headers: Headers): string | null {
  return (
    getCookie(headers, SECURE_FILLX_SESSION_COOKIE) ??
    getCookie(headers, DEV_FILLX_SESSION_COOKIE) ??
    getCookie(headers, LEGACY_FILLX_SESSION_COOKIE) ??
    null
  );
}

function cookieNameForOptions(options: { secure: boolean }): string {
  return options.secure ? SECURE_FILLX_SESSION_COOKIE : DEV_FILLX_SESSION_COOKIE;
}

export function setFillxSessionCookie(
  headers: Headers | undefined,
  token: string,
  options: { secure: boolean; maxAgeSeconds?: number },
): void {
  setCookie(headers, cookieNameForOptions(options), token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: "/",
    maxAge: options.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearFillxSessionCookies(
  headers: Headers | undefined,
  options: { secure: boolean },
): void {
  for (const name of [
    SECURE_FILLX_SESSION_COOKIE,
    DEV_FILLX_SESSION_COOKIE,
    LEGACY_FILLX_SESSION_COOKIE,
  ]) {
    setCookie(headers, name, "", {
      httpOnly: true,
      secure: options.secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
