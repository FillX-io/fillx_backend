import { importSPKI, jwtVerify } from "jose";

export type VerifiedPrivyAuth = {
  privyUserId: string;
  sessionId: string | null;
};

export type RequestAuth =
  | { type: "privy"; privy: VerifiedPrivyAuth }
  | { type: "anonymous" };

export type IdentityEnv = {
  privyAppId: string | null;
  privyJwtVerificationKey: string | null;
};

export function getIdentityEnv(): IdentityEnv {
  return {
    privyAppId: process.env.PRIVY_APP_ID ?? null,
    privyJwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY ?? null,
  };
}

export function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export function getPrivyTokenFromCookie(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === "privy-token") {
      return rawValue.join("=") || null;
    }
  }

  return null;
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

export async function getRequestAuth(
  headers: Headers,
  env = getIdentityEnv(),
): Promise<RequestAuth> {
  const token = getBearerToken(headers) ?? getPrivyTokenFromCookie(headers);
  if (!token || !env.privyAppId || !env.privyJwtVerificationKey) {
    return { type: "anonymous" };
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
