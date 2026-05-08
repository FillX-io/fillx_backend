import { getCookie } from "@orpc/server/helpers";
import { importSPKI, jwtVerify } from "jose";
import type { Db } from "../db/client.js";
import { createIdentityRepos } from "./repositories.js";
import { readFillxSessionCookie } from "./session.js";
import {
  createWalletSessionService,
  parseActiveWalletSelector,
  type VerifiedFillxWalletSession,
} from "./wallet-session.service.js";

export type VerifiedPrivyAuth = {
  privyUserId: string;
  sessionId: string | null;
};

export type RequestAuth =
  | { type: "privy"; privy: VerifiedPrivyAuth }
  | { type: "fillx"; session: VerifiedFillxWalletSession }
  | { type: "anonymous" };

export type IdentityEnv = {
  privyAppId: string | null;
  privyJwtVerificationKey: string | null;
  nodeEnv: string;
};

export function getIdentityEnv(): IdentityEnv {
  return {
    privyAppId: process.env.PRIVY_APP_ID ?? null,
    privyJwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY ?? null,
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
  db: Db | null,
): Promise<RequestAuth | null> {
  if (!db) return null;
  const token = readFillxSessionCookie(headers);
  const activeWalletKey = getActiveWalletKey(headers);
  if (!token || !activeWalletKey) return null;

  const service = createWalletSessionService(createIdentityRepos(db));
  const session = await service.resolveVerifiedSession({
    sessionToken: token,
    activeWalletKey,
  });
  if (!session) return null;

  return { type: "fillx", session };
}

export function getActiveWalletKey(headers: Headers): string | null {
  return parseActiveWalletSelector(headers.get("x-fillx-active-wallet"));
}

export async function getRequestAuth(
  headers: Headers,
  env = getIdentityEnv(),
  db: Db | null = null,
): Promise<RequestAuth> {
  const bearerPrivy = await getPrivyAuthFromToken(getBearerToken(headers), env);
  if (bearerPrivy) return bearerPrivy;

  const fillx = await getFillxAuthFromCookie(headers, db);
  if (fillx) return fillx;

  const cookiePrivy = await getPrivyAuthFromToken(
    getPrivyTokenFromCookie(headers),
    env,
  );
  if (cookiePrivy) return cookiePrivy;

  return { type: "anonymous" };
}
