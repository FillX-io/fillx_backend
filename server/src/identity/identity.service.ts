import type { FillxUser } from "../db/schema.js";

export type { FillxUser } from "../db/schema.js";

export type IdentityRepos = {
  users: {
    findById?: (id: string) => Promise<FillxUser | undefined>;
    createUser?: () => Promise<FillxUser>;
    updateProfile: (input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
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

function normalizeDisplayName(input: string | null): string | null {
  if (input === null) return null;

  const displayName = input.trim();
  if (displayName.length > 50) {
    throw new Error("INVALID_DISPLAY_NAME");
  }
  return displayName.length > 0 ? displayName : null;
}

function normalizeNationality(input: string | null): string | null {
  if (input === null) return null;

  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  if (!/^[A-Za-z]{2}$/.test(trimmed)) {
    throw new Error("INVALID_NATIONALITY");
  }

  return trimmed.toUpperCase();
}

export function createIdentityService(
  repos: IdentityRepos,
  options: { randomInt?: () => number } = {},
) {
  const guestResponse: CurrentUserResult = {
    user: null,
    guest: { isGuest: true },
  };

  async function createUser(): Promise<FillxUser> {
    if (!repos.users.createUser) {
      throw new Error("IDENTITY_REPO_INCOMPLETE");
    }

    return repos.users.createUser();
  }

  return {
    async createUserFromWalletProof(): Promise<FillxUser> {
      return createUser();
    },

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

      const created = await createUser();
      await repos.authIdentities.linkPrivyIdentity({
        userId: created.id,
        privyUserId: input.auth.privyUserId,
      });
      return { user: created, guest: null };
    },

    async updateProfile(input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
    }): Promise<FillxUser> {
      const update: {
        userId: string;
        displayName?: string | null;
        nationality?: string | null;
      } = { userId: input.userId };

      if (input.displayName !== undefined) {
        update.displayName = normalizeDisplayName(input.displayName);
      }
      if (input.nationality !== undefined) {
        update.nationality = normalizeNationality(input.nationality);
      }
      if (
        update.displayName === undefined &&
        update.nationality === undefined
      ) {
        throw new Error("PROFILE_UPDATE_EMPTY");
      }

      return repos.users.updateProfile(update);
    },
  };
}
