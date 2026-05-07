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
  wallets?: {
    findByWallet: (input: {
      chainType: "evm" | "solana";
      walletAddress: string;
    }) => Promise<{ user_id: string } | undefined>;
  };
};

export type CurrentUserInput = {
  privyUserId?: string;
  wallet?: { chainType: "evm" | "solana"; walletAddress: string };
};

export function createIdentityService(
  repos: IdentityRepos,
  options: { randomInt?: () => number } = {},
) {
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
    async getOrCreateCurrentUser(input: CurrentUserInput): Promise<FillxUser> {
      if (
        input.privyUserId &&
        repos.authIdentities?.findByProviderUserId &&
        repos.users.findById
      ) {
        const identity = await repos.authIdentities.findByProviderUserId({
          provider: "privy",
          providerUserId: input.privyUserId,
        });
        if (identity) {
          const existing = await repos.users.findById(identity.user_id);
          if (existing) return existing;
        }
      }

      if (input.wallet && repos.wallets?.findByWallet && repos.users.findById) {
        const wallet = await repos.wallets.findByWallet(input.wallet);
        if (wallet) {
          const existing = await repos.users.findById(wallet.user_id);
          if (existing) return existing;
        }
      }

      const created = await createGeneratedUser();
      if (input.privyUserId && repos.authIdentities?.linkPrivyIdentity) {
        await repos.authIdentities.linkPrivyIdentity({
          userId: created.id,
          privyUserId: input.privyUserId,
        });
      }
      return created;
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
