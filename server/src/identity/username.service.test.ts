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
    id: input.id === undefined ? "user-1" : input.id,
    username: input.username === undefined ? "trader_0001" : input.username,
    username_status:
      input.username_status === undefined ? "generated" : input.username_status,
    display_name: input.display_name === undefined ? null : input.display_name,
    avatar_url: input.avatar_url === undefined ? null : input.avatar_url,
    nationality: input.nationality === undefined ? null : input.nationality,
    created_at: input.created_at === undefined ? now : input.created_at,
    updated_at: input.updated_at === undefined ? now : input.updated_at,
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
      createClaimedUser: async (username) => {
        const user = makeUser({
          id: `user-${users.size + 1}`,
          username,
          username_status: "claimed",
        });
        users.set(user.id, user);
        return user;
      },
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
      findByWallet: async ({ chainType, walletAddress }) =>
        wallets.find(
          (wallet) =>
            wallet.chain_type === chainType &&
            wallet.wallet_address === walletAddress,
        ),
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
      findChallengeByIdForUpdate: async (id) => challenges.get(id),
      consumeChallengeIfUnused: async (id) => {
        const challenge = challenges.get(id);
        if (!challenge || challenge.consumed_at) return undefined;
        const consumed = {
          ...challenge,
          consumed_at: new Date("2026-05-07T00:01:00.000Z"),
        };
        challenges.set(id, consumed);
        return consumed;
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
    authenticatedUserId: "user-1",
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

test("requestClaimChallenge does not require a pre-existing user", async () => {
  const { repos } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
  });

  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  assert.equal(challenge.challengeId, "challenge-1");
  assert.match(challenge.message, /Username: alice_1/);
  assert.match(
    challenge.message,
    /Wallet: 0x0000000000000000000000000000000000000001/,
  );
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
    authenticatedUserId: "user-1",
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  const user = await service.claimUsername({
    challengeId: challenge.challengeId,
    signature: "0xsigned",
  });

  assert.equal(user.username, "alice_1");
  assert.equal(user.username_status, "claimed");
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].wallet_address, "0x0000000000000000000000000000000000000001");
  assert.equal(audits.length, 1);
});

test("claimUsername creates a claimed wallet-backed user after valid wallet proof", async () => {
  const { repos, users, wallets } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  const user = await service.claimUsername({
    challengeId: challenge.challengeId,
    signature: "0xsigned",
  });

  assert.equal(user.username, "alice_1");
  assert.equal(user.username_status, "claimed");
  assert.equal(users.size, 1);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].user_id, user.id);
});

test("claimUsername rejects a replayed challenge", async () => {
  const { repos } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  await service.claimUsername({
    challengeId: challenge.challengeId,
    signature: "0xsigned",
  });

  await assert.rejects(
    service.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xsigned",
    }),
    /CHALLENGE_ALREADY_USED/,
  );
});

test("claimUsername rejects an expired challenge without creating a user", async () => {
  const { repos, users } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });
  const expiredService = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:10:00.000Z"),
    verifySignature: async () => true,
  });

  await assert.rejects(
    expiredService.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xsigned",
    }),
    /CHALLENGE_EXPIRED/,
  );
  assert.equal(users.size, 0);
});

test("claimUsername rejects invalid signatures without consuming the challenge", async () => {
  const { repos, challenges } = makeRepos();
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => false,
  });
  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  await assert.rejects(
    service.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xbad",
    }),
    /SIGNATURE_INVALID/,
  );
  assert.equal(challenges.get(challenge.challengeId)?.consumed_at, null);
});

test("claimUsername consumes the challenge atomically in the claim transaction", async () => {
  const { repos, users, wallets, challenges } = makeRepos();
  let consumeAttempts = 0;
  repos.usernameClaims.consumeChallengeIfUnused = async (id) => {
    consumeAttempts += 1;
    const challenge = challenges.get(id);
    if (!challenge || challenge.consumed_at) return undefined;
    const consumed = {
      ...challenge,
      consumed_at: new Date("2026-05-07T00:01:00.000Z"),
    };
    challenges.set(id, consumed);
    return consumed;
  };
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  await service.claimUsername({
    challengeId: challenge.challengeId,
    signature: "0xsigned",
  });
  await assert.rejects(
    service.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xsigned",
    }),
    /CHALLENGE_ALREADY_USED/,
  );

  assert.equal(consumeAttempts, 1);
  assert.equal(users.size, 1);
  assert.equal(wallets.length, 1);
});

test("claimUsername translates createClaimedUser contention to USERNAME_TAKEN", async () => {
  const { repos } = makeRepos();
  repos.users.createClaimedUser = async () => {
    throw new Error("DATABASE_RETURNING_EMPTY");
  };
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  await assert.rejects(
    service.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xsigned",
    }),
    /USERNAME_TAKEN/,
  );
});

test("claimUsername translates createPrimaryWallet contention and skips audit", async () => {
  const { repos, audits } = makeRepos();
  repos.wallets.createPrimaryWallet = async () => {
    throw new Error("DATABASE_RETURNING_EMPTY");
  };
  const service = createUsernameService(repos, {
    now: () => new Date("2026-05-07T00:00:00.000Z"),
    nonce: () => "nonce-1",
    verifySignature: async () => true,
  });
  const challenge = await service.requestClaimChallenge({
    authenticatedUserId: null,
    username: "alice_1",
    walletAddress: "0x0000000000000000000000000000000000000001",
    chainType: "evm",
    chainId: 1,
  });

  await assert.rejects(
    service.claimUsername({
      challengeId: challenge.challengeId,
      signature: "0xsigned",
    }),
    /PRIMARY_WALLET_ALREADY_SET/,
  );
  assert.equal(audits.length, 0);
});
