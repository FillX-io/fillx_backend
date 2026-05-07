import assert from "node:assert/strict";
import test from "node:test";
import {
  createUsernameService,
  type FillxUser,
  type UserWallet,
  type UsernameClaimChallenge,
  type UsernameServiceRepos,
} from "./username.service.js";

function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  const now = new Date("2026-05-07T00:00:00.000Z");
  return {
    id: input.id ?? "user-1",
    username: input.username ?? "trader_0001",
    username_status: input.username_status ?? "generated",
    display_name: input.display_name ?? null,
    avatar_url: input.avatar_url ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  };
}

function makeRepos(): {
  repos: UsernameServiceRepos;
  users: Map<string, FillxUser>;
  wallets: UserWallet[];
  challenges: Map<string, UsernameClaimChallenge>;
  audits: unknown[];
} {
  const users = new Map<string, FillxUser>();
  const wallets: UserWallet[] = [];
  const challenges = new Map<string, UsernameClaimChallenge>();
  const audits: unknown[] = [];

  const repos: UsernameServiceRepos = {
    users: {
      findById: async (id) => users.get(id),
      findByUsername: async (username) =>
        Array.from(users.values()).find((user) => user.username === username),
      markUsernameClaimed: async ({ userId, username }) => {
        const user = users.get(userId);
        if (!user) throw new Error("missing user");
        const updated = {
          ...user,
          username,
          username_status: "claimed" as const,
          updated_at: new Date("2026-05-07T00:01:00.000Z"),
        };
        users.set(userId, updated);
        return updated;
      },
    },
    wallets: {
      findPrimaryByUserId: async (userId) =>
        wallets.find((wallet) => wallet.user_id === userId && wallet.is_primary),
      createPrimaryWallet: async ({ userId, chainType, walletAddress }) => {
        const wallet: UserWallet = {
          id: `wallet-${wallets.length + 1}`,
          user_id: userId,
          chain_type: chainType,
          wallet_address: walletAddress,
          is_primary: true,
          verified_at: new Date("2026-05-07T00:00:00.000Z"),
          created_at: new Date("2026-05-07T00:00:00.000Z"),
        };
        wallets.push(wallet);
        return wallet;
      },
    },
    usernameClaims: {
      createChallenge: async (input) => {
        const challenge: UsernameClaimChallenge = {
          id: "challenge-1",
          user_id: input.userId,
          username: input.username,
          wallet_address: input.walletAddress,
          chain_type: input.chainType,
          chain_id: input.chainId,
          nonce: input.nonce,
          message: input.message,
          expires_at: input.expiresAt,
          consumed_at: null,
          created_at: new Date("2026-05-07T00:00:00.000Z"),
        };
        challenges.set(challenge.id, challenge);
        return challenge;
      },
      findChallengeById: async (id) => challenges.get(id),
      consumeChallenge: async (id) => {
        const challenge = challenges.get(id);
        if (challenge) {
          challenges.set(id, {
            ...challenge,
            consumed_at: new Date("2026-05-07T00:01:00.000Z"),
          });
        }
      },
      insertClaimAudit: async (input) => {
        audits.push(input);
        return input;
      },
    },
    runTransaction: async (fn) => fn(repos),
  };

  return { repos, users, wallets, challenges, audits };
}

test("checkAvailable normalizes and reports an available username", async () => {
  const { repos } = makeRepos();
  const service = createUsernameService(repos);

  assert.deepEqual(await service.checkAvailable("alice_1"), {
    available: true,
    normalizedUsername: "alice_1",
  });
});

test("requestClaimChallenge stores a signed username claim message", async () => {
  const { repos, users } = makeRepos();
  users.set("user-1", makeUser());
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
  });

  const challenge = await service.requestClaimChallenge({
    userId: "user-1",
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  assert.equal(challenge.challengeId, "challenge-1");
  assert.equal(challenge.expiresAt, "2026-05-07T00:10:00.000Z");
  assert.match(challenge.message, /Username: alice_1/);
  assert.match(challenge.message, /Nonce: nonce-1/);
});

test("claimUsername verifies the challenge, creates the primary wallet, and marks the username claimed", async () => {
  const { repos, users, wallets, audits } = makeRepos();
  users.set("user-1", makeUser());
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    userId: "user-1",
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  const user = await service.claimUsername({
    userId: "user-1",
    challengeId: challenge.challengeId,
    signature: "0xsigned",
  });

  assert.equal(user.username, "alice_1");
  assert.equal(user.username_status, "claimed");
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].wallet_address, "0x0000000000000000000000000000000000000001");
  assert.equal(audits.length, 1);
});
