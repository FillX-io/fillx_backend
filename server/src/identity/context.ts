import type { IncomingMessage } from "node:http";
import { getDb, type Db } from "../db/client.js";
import {
  getActiveWalletKey,
  getIdentityEnv,
  getRequestAuth,
  type IdentityEnv,
  type RequestAuth,
} from "./auth.js";
import { readFillxSessionCookie } from "./session.js";

export type UserIdentity =
  | { type: "anonymous" }
  | { type: "fillx"; userId: string };

export type AppContext = {
  db: Db;
  env: IdentityEnv;
  auth: RequestAuth;
  userIdentity: UserIdentity;
  activeWalletKey: string | null;
  fillxSessionToken: string | null;
  requestId: string;
  ipAddress: string;
  reqHeaders?: Headers;
  resHeaders?: Headers;
};

export function userIdentityFromAuth(auth: RequestAuth): UserIdentity {
  if (auth.type === "fillx") {
    return { type: "fillx", userId: auth.session.userId };
  }

  return { type: "anonymous" };
}

function headersFromIncomingMessage(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function createContext(req: IncomingMessage): Promise<AppContext> {
  const headers = headersFromIncomingMessage(req);
  const env = getIdentityEnv();
  const activeWalletKey = getActiveWalletKey(headers);
  const fillxSessionToken = readFillxSessionCookie(headers);
  const authDb = activeWalletKey && fillxSessionToken ? getDb() : null;
  const auth = await getRequestAuth(headers, env, authDb);
  const context = {
    env,
    auth,
    userIdentity: userIdentityFromAuth(auth),
    activeWalletKey,
    fillxSessionToken,
    requestId: crypto.randomUUID(),
    ipAddress:
      headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    reqHeaders: headers,
  } as AppContext;

  Object.defineProperty(context, "db", {
    enumerable: true,
    get: () => getDb(),
  });

  return context;
}
