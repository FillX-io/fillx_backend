import { setCookie } from "@orpc/server/helpers";
import { SignJWT, jwtVerify } from "jose";

export const FILLX_SESSION_COOKIE = "fillx-session";
const SESSION_TYPE = "fillx-session";
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type VerifiedFillxSession = {
  userId: string;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signFillxSession(input: {
  userId: string;
  secret: string;
  now?: Date;
  maxAgeSeconds?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const maxAgeSeconds = input.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  return new SignJWT({ typ: SESSION_TYPE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + maxAgeSeconds)
    .sign(secretKey(input.secret));
}

export async function verifyFillxSessionToken(input: {
  token: string;
  secret: string;
}): Promise<VerifiedFillxSession | null> {
  try {
    const verified = await jwtVerify(input.token, secretKey(input.secret), {
      algorithms: ["HS256"],
    });
    if (verified.payload.typ !== SESSION_TYPE) return null;
    if (!verified.payload.sub) return null;
    return { userId: verified.payload.sub };
  } catch {
    return null;
  }
}

export function setFillxSessionCookie(
  headers: Headers | undefined,
  token: string,
  options: { secure: boolean; maxAgeSeconds?: number },
): void {
  setCookie(headers, FILLX_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: "/",
    maxAge: options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
  });
}
