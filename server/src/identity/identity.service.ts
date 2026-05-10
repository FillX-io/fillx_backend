import type { FillxUser } from "../db/schema.js";

export type { FillxUser } from "../db/schema.js";

export type IdentityRepos = {
  users: {
    findById?: (id: string) => Promise<FillxUser | undefined>;
    findByDisplayNameCaseInsensitive?: (
      displayName: string,
    ) => Promise<FillxUser | undefined>;
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

const displayNamePattern = /^[A-Za-z0-9_]{3,25}$/;
const displayNameUniqueIndex = "fillx_users_display_name_lower_unique_idx";

function hasValidDisplayName(input: string | null): input is string {
  return input !== null && displayNamePattern.test(input);
}

function normalizeDisplayName(input: string | null): string {
  if (input === null) throw new Error("USERNAME_REQUIRED");

  const displayName = input.trim();
  if (displayName.length === 0) {
    throw new Error("USERNAME_REQUIRED");
  }
  if (!hasValidDisplayName(displayName)) {
    throw new Error("INVALID_DISPLAY_NAME");
  }
  return displayName;
}

function isDisplayNameUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const maybeError = error as {
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
  };
  return (
    maybeError.code === "23505" &&
    (maybeError.constraint === displayNameUniqueIndex ||
      maybeError.constraint_name === displayNameUniqueIndex)
  );
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

export function createIdentityService(repos: IdentityRepos) {
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
      if (!repos.users.findById || !repos.users.findByDisplayNameCaseInsensitive) {
        throw new Error("IDENTITY_REPO_INCOMPLETE");
      }

      const existing = await repos.users.findById(input.userId);
      if (!existing) throw new Error("USER_NOT_FOUND");

      const update: {
        userId: string;
        displayName?: string | null;
        nationality?: string | null;
      } = { userId: input.userId };

      if (input.displayName !== undefined) {
        update.displayName = normalizeDisplayName(input.displayName);
        const duplicate = await repos.users.findByDisplayNameCaseInsensitive(
          update.displayName,
        );
        if (duplicate && duplicate.id !== input.userId) {
          throw new Error("DISPLAY_NAME_TAKEN");
        }
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

      const nextDisplayName =
        update.displayName === undefined ? existing.display_name : update.displayName;
      if (nextDisplayName === null) throw new Error("USERNAME_REQUIRED");
      if (!hasValidDisplayName(nextDisplayName)) {
        throw new Error("INVALID_DISPLAY_NAME");
      }

      try {
        return await repos.users.updateProfile(update);
      } catch (error) {
        if (isDisplayNameUniqueViolation(error)) {
          throw new Error("DISPLAY_NAME_TAKEN");
        }
        throw error;
      }
    },
  };
}
