import { implement } from "@orpc/server";
import { contract } from "@fillx/shared";
import type { FillxUser } from "../db/schema.js";
import type { AppContext, UserIdentity } from "../identity/context.js";
import { apiError } from "../identity/errors.js";
import { createIdentityService } from "../identity/identity.service.js";
import { createIdentityRepos } from "../identity/repositories.js";
import { setFillxSessionCookie, signFillxSession } from "../identity/session.js";

export const pub = implement(contract).$context<AppContext>();

export type FillxUserIdentity = Extract<UserIdentity, { type: "fillx" }>;
export type ProtectedAppContext = AppContext & {
  userIdentity: FillxUserIdentity;
};

function isSecureCookieEnv(context: AppContext): boolean {
  return context.env.nodeEnv !== "development" && context.env.nodeEnv !== "test";
}

export function requireFillxSessionSecret(context: AppContext): string {
  if (!context.env.fillxJwtSecret) throw apiError("SESSION_NOT_CONFIGURED");
  return context.env.fillxJwtSecret;
}

export async function issueFillxSession(
  context: AppContext,
  userId: string,
): Promise<void> {
  const token = await signFillxSession({
    userId,
    secret: requireFillxSessionSecret(context),
  });
  setFillxSessionCookie(context.resHeaders, token, {
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
    requireFillxSessionSecret(context);
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
    await issueFillxSession(context, current.user.id);
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
