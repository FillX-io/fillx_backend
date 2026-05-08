import { implement } from "@orpc/server";
import { contract } from "@fillx/shared";
import type { FillxUser } from "../db/schema.js";
import type { AppContext, UserIdentity } from "../identity/context.js";
import { apiError } from "../identity/errors.js";
import { createIdentityService } from "../identity/identity.service.js";
import { createIdentityRepos } from "../identity/repositories.js";
import {
  clearFillxSessionCookies,
  setFillxSessionCookie,
} from "../identity/session.js";
import { createWalletSessionService } from "../identity/wallet-session.service.js";

export const pub = implement(contract).$context<AppContext>();

export type FillxUserIdentity = Extract<UserIdentity, { type: "fillx" }>;
export type ProtectedAppContext = AppContext & {
  userIdentity: FillxUserIdentity;
};

export function isSecureCookieEnv(context: AppContext): boolean {
  return context.env.nodeEnv !== "development" && context.env.nodeEnv !== "test";
}

export function setBrowserSessionCookie(
  context: AppContext,
  token: string,
): void {
  setFillxSessionCookie(context.resHeaders, token, {
    secure: isSecureCookieEnv(context),
  });
}

export function clearBrowserSessionCookies(context: AppContext): void {
  clearFillxSessionCookies(context.resHeaders, {
    secure: isSecureCookieEnv(context),
  });
}

export function currentUserAuthFromContext(context: AppContext) {
  if (context.auth.type === "privy") {
    return {
      type: "privy" as const,
      privyUserId: context.auth.privy.privyUserId,
    };
  }

  if (context.userIdentity.type === "fillx") {
    return {
      type: "fillx" as const,
      userId: context.userIdentity.userId,
    };
  }

  return { type: "anonymous" as const };
}

export async function resolveProtectedUser(
  context: AppContext,
): Promise<FillxUser> {
  const repos = createIdentityRepos(context.db);

  if (context.userIdentity.type === "fillx") {
    const user = await repos.users.findById(context.userIdentity.userId);
    if (!user) throw apiError("AUTH_REQUIRED");
    return user;
  }

  if (context.auth.type === "privy") {
    const service = createIdentityService({
      users: repos.users,
      authIdentities: repos.authIdentities,
    });
    const current = await service.getCurrentUser({
      auth: {
        type: "privy",
        privyUserId: context.auth.privy.privyUserId,
      },
    });
    if (!current.user) throw apiError("AUTH_REQUIRED");
    context.userIdentity = { type: "fillx", userId: current.user.id };
    return current.user;
  }

  throw apiError("AUTH_REQUIRED");
}

export async function protectedProcedure<T>(
  context: AppContext,
  handler: (input: {
    context: ProtectedAppContext;
    user: FillxUser;
  }) => Promise<T>,
): Promise<T> {
  const user = await resolveProtectedUser(context);
  return handler({ context: context as ProtectedAppContext, user });
}

export async function resolveActiveWalletSessionUser(
  context: AppContext,
): Promise<FillxUser> {
  const repos = createIdentityRepos(context.db);
  const service = createWalletSessionService(repos);
  const session = await service.resolveVerifiedSession({
    sessionToken: context.fillxSessionToken,
    activeWalletKey: context.activeWalletKey,
  });
  if (!session) throw apiError("AUTH_REQUIRED");

  const user = await repos.users.findById(session.userId);
  if (!user) throw apiError("AUTH_REQUIRED");

  context.userIdentity = { type: "fillx", userId: user.id };
  return user;
}

export async function walletSessionProcedure<T>(
  context: AppContext,
  handler: (input: {
    context: ProtectedAppContext;
    user: FillxUser;
  }) => Promise<T>,
): Promise<T> {
  const user = await resolveActiveWalletSessionUser(context);
  return handler({ context: context as ProtectedAppContext, user });
}
