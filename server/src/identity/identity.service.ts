import type { FillxUser } from "../db/schema.js";
import { generateUsernameCandidate } from "./username.rules.js";

export type { FillxUser } from "../db/schema.js";

export type IdentityRepos = {
  users: {
    findById?: (id: string) => Promise<FillxUser | undefined>;
    findByUsername?: (username: string) => Promise<FillxUser | undefined>;
    createGeneratedUser?: (username: string) => Promise<FillxUser>;
    updateDisplayName: (input: {
      userId: string;
      displayName: string;
    }) => Promise<FillxUser>;
  };
  authIdentities?: {
    findByProviderUserId: (input: {
      provider: "privy";
      providerUserId: string;
    }) => Promise<{ user_id: string } | undefined>;
    linkPrivyIdentity: (input: {
      userId: string;
      privyUserId: string;
    }) => Promise<unknown>;
  };
};

export type CurrentUserAuth =
  | { type: "anonymous" }
  | { type: "fillx"; userId: string }
  | { type: "privy"; privyUserId: string };

export type CurrentUserResult = {
  user: FillxUser | null;
  guest: { isGuest: true } | null;
};

export function createIdentityService(
  repos: IdentityRepos,
  options: { randomInt?: () => number } = {},
) {
  const guestResponse: CurrentUserResult = {
    user: null,
    guest: { isGuest: true },
  };

  async function createGeneratedUser(): Promise<FillxUser> {
    if (!repos.users.createGeneratedUser || !repos.users.findByUsername) {
      throw new Error("IDENTITY_REPO_INCOMPLETE");
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateUsernameCandidate(options.randomInt);
      const existing = await repos.users.findByUsername(candidate);
      if (!existing) return repos.users.createGeneratedUser(candidate);
    }

    throw new Error("GENERATED_USERNAME_COLLISION");
  }

  return {
    async getCurrentUser(input: {
      auth: CurrentUserAuth;
    }): Promise<CurrentUserResult> {
      if (input.auth.type === "anonymous") {
        return guestResponse;
      }

      if (input.auth.type === "fillx") {
        const existing = await repos.users.findById?.(input.auth.userId);
        return existing ? { user: existing, guest: null } : guestResponse;
      }

      if (!repos.authIdentities || !repos.users.findById) {
        throw new Error("IDENTITY_REPO_INCOMPLETE");
      }

      const identity = await repos.authIdentities.findByProviderUserId({
        provider: "privy",
        providerUserId: input.auth.privyUserId,
      });
      if (identity) {
        const existing = await repos.users.findById(identity.user_id);
        if (existing) return { user: existing, guest: null };
      }

      const created = await createGeneratedUser();
      await repos.authIdentities.linkPrivyIdentity({
        userId: created.id,
        privyUserId: input.auth.privyUserId,
      });
      return { user: created, guest: null };
    },

    async updateDisplayName(input: {
      userId: string;
      displayName: string;
    }): Promise<FillxUser> {
      const displayName = input.displayName.trim();
      if (displayName.length === 0 || displayName.length > 50) {
        throw new Error("INVALID_DISPLAY_NAME");
      }
      return repos.users.updateDisplayName({ userId: input.userId, displayName });
    },
  };
}
