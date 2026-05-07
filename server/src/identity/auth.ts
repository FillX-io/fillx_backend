import { getCookie } from "@orpc/server/helpers";
import { importSPKI, jwtVerify } from "jose";
import {
  FILLX_SESSION_COOKIE,
  verifyFillxSessionToken,
  type VerifiedFillxSession,
} from "./session.js";

export type VerifiedPrivyAuth = {
  privyUserId: string;
  sessionId: string | null;
};

export type RequestAuth =
  | { type: "privy"; privy: VerifiedPrivyAuth }
  | { type: "fillx"; session: VerifiedFillxSession }
  | { type: "anonymous" };

export type IdentityEnv = {
  privyAppId: string | null;
  privyJwtVerificationKey: string | null;
  fillxJwtSecret: string | null;
  nodeEnv: string;
};

export function getIdentityEnv(): IdentityEnv {
  return {
    privyAppId: process.env.PRIVY_APP_ID ?? null,
    privyJwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY ?? null,
    fillxJwtSecret: process.env.FILLX_JWT_SECRET ?? null,
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}

export function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export function getPrivyTokenFromCookie(headers: Headers): string | null {
  return getCookie(headers, "privy-token") ?? null;
}

export async function verifyPrivyAccessToken(input: {
  token: string;
  appId: string;
  verificationKey: string;
}): Promise<VerifiedPrivyAuth> {
  const key = await importSPKI(input.verificationKey, "ES256");
  const verified = await jwtVerify(input.token, key, {
    issuer: "privy.io",
    audience: input.appId,
  });

  const privyUserId = verified.payload.sub;
  if (!privyUserId) {
    throw new Error("Privy token is missing sub claim");
  }

  return {
    privyUserId,
    sessionId:
      typeof verified.payload.sid === "string" ? verified.payload.sid : null,
  };
}

async function getPrivyAuthFromToken(
  token: string | null,
  env: IdentityEnv,
): Promise<RequestAuth | null> {
  if (!token || !env.privyAppId || !env.privyJwtVerificationKey) {
    return null;
  }

  return {
    type: "privy",
    privy: await verifyPrivyAccessToken({
      token,
      appId: env.privyAppId,
      verificationKey: env.privyJwtVerificationKey,
    }),
  };
}

async function getFillxAuthFromCookie(
  headers: Headers,
  env: IdentityEnv,
): Promise<RequestAuth | null> {
  const token = getCookie(headers, FILLX_SESSION_COOKIE);
  if (!token || !env.fillxJwtSecret) return null;

  const session = await verifyFillxSessionToken({
    token,
    secret: env.fillxJwtSecret,
  });
  if (!session) return null;

  return { type: "fillx", session };
}

export async function getRequestAuth(
  headers: Headers,
  env = getIdentityEnv(),
): Promise<RequestAuth> {
  const bearerPrivy = await getPrivyAuthFromToken(getBearerToken(headers), env);
  if (bearerPrivy) return bearerPrivy;

  const fillx = await getFillxAuthFromCookie(headers, env);
  if (fillx) return fillx;

  const cookiePrivy = await getPrivyAuthFromToken(
    getPrivyTokenFromCookie(headers),
    env,
  );
  if (cookiePrivy) return cookiePrivy;

  return { type: "anonymous" };
}
