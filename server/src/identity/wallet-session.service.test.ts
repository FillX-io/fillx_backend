import assert from "node:assert/strict";
import test from "node:test";
import type {
  FillxSessionFamily,
  FillxUser,
  FillxWalletSession,
  UserWallet,
  WalletSignInChallenge,
} from "../db/schema.js";
import {
  createWalletSessionService,
  fillxWalletKeyFromParts,
  parseActiveWalletSelector,
  type WalletSessionServiceRepos,
} from "./wallet-session.service.js";

const NOW = new Date("2026-05-07T12:00:00.000Z");
const EXPIRES = new Date("2026-06-06T12:00:00.000Z");
const EVM_ADDRESS = "0x0000000000000000000000000000000000000001";
const SECOND_EVM_ADDRESS = "0x0000000000000000000000000000000000000002";

function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  return {
    id: input.id ?? "user-1",
    username: input.username ?? "alice",
    username_status: input.username_status ?? "claimed",
    display_name: input.display_name ?? null,
    avatar_url: input.avatar_url ?? null,
    created_at: input.created_at ?? NOW,
    updated_at: input.updated_at ?? NOW,
  };
}

function makeWallet(input: Partial<UserWallet> = {}): UserWallet {
  return {
    id: input.id ?? "wallet-1",
    user_id: input.user_id ?? "user-1",
    chain_type: input.chain_type ?? "evm",
    wallet_address: input.wallet_address ?? EVM_ADDRESS,
    is_primary: input.is_primary ?? true,
    verified_at: input.verified_at ?? NOW,
    created_at: input.created_at ?? NOW,
  };
}

function makeFamily(
  input: Partial<FillxSessionFamily> = {},
): FillxSessionFamily {
  return {
    id: input.id ?? "family-1",
    token_hash: input.token_hash ?? "hash-1",
    created_at: input.created_at ?? NOW,
    last_seen_at: input.last_seen_at ?? NOW,
    absolute_expires_at: input.absolute_expires_at ?? EXPIRES,
    revoked_at: input.revoked_at ?? null,
    revoke_reason: input.revoke_reason ?? null,
  };
}

function makeWalletSession(
  input: Partial<FillxWalletSession> = {},
): FillxWalletSession {
  return {
    id: input.id ?? "wallet-session-1",
    family_id: input.family_id ?? "family-1",
    wallet_key: input.wallet_key ?? `evm:${EVM_ADDRESS}`,
    wallet_address: input.wallet_address ?? EVM_ADDRESS,
    wallet_namespace: input.wallet_namespace ?? "evm",
    signature_scheme: input.signature_scheme ?? "eip191",
    last_signed_chain: input.last_signed_chain ?? "eip155:1",
    signed_at: input.signed_at ?? NOW,
    profile_user_id: input.profile_user_id ?? "user-1",
    last_used_at: input.last_used_at ?? NOW,
    expires_at: input.expires_at ?? EXPIRES,
    revoked_at: input.revoked_at ?? null,
    revoke_reason: input.revoke_reason ?? null,
  };
}

function makeChallenge(
  input: Partial<WalletSignInChallenge> = {},
): WalletSignInChallenge {
  return {
    id: input.id ?? "challenge-1",
    wallet_key: input.wallet_key ?? `evm:${EVM_ADDRESS}`,
    wallet_address: input.wallet_address ?? EVM_ADDRESS,
    chain_type: input.chain_type ?? "evm",
    chain_id: input.chain_id ?? 1,
    nonce: input.nonce ?? "nonce-1",
    message: input.message ?? "message",
    expires_at: input.expires_at ?? new Date("2026-05-07T12:10:00.000Z"),
    consumed_at: input.consumed_at ?? null,
    created_at: input.created_at ?? NOW,
  };
}

function makeRepos(): {
  repos: WalletSessionServiceRepos;
  users: Map<string, FillxUser>;
  wallets: UserWallet[];
  families: Map<string, FillxSessionFamily>;
  walletSessions: FillxWalletSession[];
  challenges: Map<string, WalletSignInChallenge>;
  createdTokens: string[];
} {
  const users = new Map<string, FillxUser>();
  const wallets: UserWallet[] = [];
  const families = new Map<string, FillxSessionFamily>();
  const walletSessions: FillxWalletSession[] = [];
  const challenges = new Map<string, WalletSignInChallenge>();
  const createdTokens: string[] = [];

  const repos: WalletSessionServiceRepos = {
    users: {
      findById: async (id) => users.get(id),
    },
    wallets: {
      findByWallet: async ({ chainType, walletAddress }) =>
        wallets.find(
          (wallet) =>
            wallet.chain_type === chainType &&
            wallet.wallet_address === walletAddress,
        ),
    },
    sessionFamilies: {
      findActiveByTokenHash: async ({ tokenHash, now }) => {
        const family = families.get(tokenHash);
        if (!family || family.revoked_at) return undefined;
        return family.absolute_expires_at > now ? family : undefined;
      },
      create: async ({ tokenHash, expiresAt, now }) => {
        const family = makeFamily({
          id: `family-${families.size + 1}`,
          token_hash: tokenHash,
          created_at: now,
          last_seen_at: now,
          absolute_expires_at: expiresAt,
        });
        families.set(tokenHash, family);
        createdTokens.push(tokenHash);
        return family;
      },
      rotateToken: async ({ familyId, tokenHash, expiresAt, now }) => {
        const existing = Array.from(families.values()).find(
          (family) => family.id === familyId,
        );
        if (!existing) throw new Error("missing family");
        families.delete(existing.token_hash);
        const updated = {
          ...existing,
          token_hash: tokenHash,
          last_seen_at: now,
          absolute_expires_at: expiresAt,
        };
        families.set(tokenHash, updated);
        createdTokens.push(tokenHash);
        return updated;
      },
      touch: async ({ familyId, now }) => {
        const existing = Array.from(families.values()).find(
          (family) => family.id === familyId,
        );
        if (!existing) throw new Error("missing family");
        const updated = { ...existing, last_seen_at: now };
        families.set(updated.token_hash, updated);
        return updated;
      },
      revoke: async ({ familyId, now, reason }) => {
        const existing = Array.from(families.values()).find(
          (family) => family.id === familyId,
        );
        if (!existing) return;
        families.set(existing.token_hash, {
          ...existing,
          revoked_at: now,
          revoke_reason: reason,
        });
      },
    },
    walletSessions: {
      findActive: async ({ familyId, walletKey, now }) =>
        walletSessions.find(
          (session) =>
            session.family_id === familyId &&
            session.wallet_key === walletKey &&
            !session.revoked_at &&
            session.expires_at > now,
        ),
      upsert: async (input) => {
        const existing = walletSessions.find(
          (session) =>
            session.family_id === input.familyId &&
            session.wallet_key === input.walletKey &&
            !session.revoked_at,
        );
        if (existing) {
          Object.assign(existing, {
            wallet_address: input.walletAddress,
            wallet_namespace: input.walletNamespace,
            signature_scheme: input.signatureScheme,
            last_signed_chain: input.lastSignedChain,
            signed_at: input.signedAt,
            profile_user_id: input.profileUserId,
            last_used_at: input.now,
            expires_at: input.expiresAt,
          });
          return existing;
        }
        const created = makeWalletSession({
          id: `wallet-session-${walletSessions.length + 1}`,
          family_id: input.familyId,
          wallet_key: input.walletKey,
          wallet_address: input.walletAddress,
          wallet_namespace: input.walletNamespace,
          signature_scheme: input.signatureScheme,
          last_signed_chain: input.lastSignedChain,
          signed_at: input.signedAt,
          profile_user_id: input.profileUserId,
          last_used_at: input.now,
          expires_at: input.expiresAt,
        });
        walletSessions.push(created);
        return created;
      },
      touch: async ({ walletSessionId, now }) => {
        const existing = walletSessions.find(
          (session) => session.id === walletSessionId,
        );
        if (existing) existing.last_used_at = now;
      },
      revokeByFamily: async ({ familyId, now, reason }) => {
        for (const session of walletSessions) {
          if (session.family_id === familyId && !session.revoked_at) {
            session.revoked_at = now;
            session.revoke_reason = reason;
          }
        }
      },
    },
    walletSignInChallenges: {
      create: async (input) => {
        const challenge = makeChallenge({
          id: `challenge-${challenges.size + 1}`,
          wallet_key: input.walletKey,
          wallet_address: input.walletAddress,
          chain_type: input.chainType,
          chain_id: input.chainId,
          nonce: input.nonce,
          message: input.message,
          expires_at: input.expiresAt,
          created_at: input.now,
        });
        challenges.set(challenge.id, challenge);
        return challenge;
      },
      findByIdForUpdate: async (id) => challenges.get(id),
      consumeIfUnused: async (id) => {
        const challenge = challenges.get(id);
        if (!challenge || challenge.consumed_at) return undefined;
        const consumed = { ...challenge, consumed_at: NOW };
        challenges.set(id, consumed);
        return consumed;
      },
    },
  };

  return {
    repos,
    users,
    wallets,
    families,
    walletSessions,
    challenges,
    createdTokens,
  };
}

test("fillxWalletKeyFromParts maps one EVM address to the same key across chains", () => {
  assert.equal(
    fillxWalletKeyFromParts({
      chainType: "evm",
      walletAddress: "0x0000000000000000000000000000000000000001",
    }),
    `evm:${EVM_ADDRESS}`,
  );
  assert.equal(
    fillxWalletKeyFromParts({
      chainType: "evm",
      walletAddress: "0X0000000000000000000000000000000000000001",
    }),
    `evm:${EVM_ADDRESS}`,
  );
});

test("parseActiveWalletSelector rejects missing and invalid selectors", () => {
  assert.equal(parseActiveWalletSelector(null), null);
  assert.equal(parseActiveWalletSelector(""), null);
  assert.equal(parseActiveWalletSelector("eip155:1:0xabc"), null);
  assert.equal(parseActiveWalletSelector("evm:not-an-address"), null);
});

test("resolveCurrentUser returns no active wallet without a selector", async () => {
  const { repos } = makeRepos();
  const service = createWalletSessionService(repos, { now: () => NOW });

  assert.deepEqual(
    await service.resolveCurrentUser({
      sessionToken: "token",
      activeWalletKey: null,
    }),
    { state: "no_active_wallet", user: null, guest: { isGuest: true } },
  );
});

test("resolveCurrentUser never returns wallet A for wallet B selector", async () => {
  const { repos, users, families, walletSessions } = makeRepos();
  users.set("user-1", makeUser({ username: "alice" }));
  users.set("user-2", makeUser({ id: "user-2", username: "bob" }));
  const tokenHash = "token-hash";
  families.set(tokenHash, makeFamily({ token_hash: tokenHash }));
  walletSessions.push(
    makeWalletSession({
      wallet_key: `evm:${EVM_ADDRESS}`,
      profile_user_id: "user-1",
    }),
  );
  walletSessions.push(
    makeWalletSession({
      id: "wallet-session-2",
      wallet_key: `evm:${SECOND_EVM_ADDRESS}`,
      wallet_address: SECOND_EVM_ADDRESS,
      profile_user_id: "user-2",
    }),
  );
  const service = createWalletSessionService(repos, {
    now: () => NOW,
    hashToken: () => tokenHash,
  });

  const current = await service.resolveCurrentUser({
    sessionToken: "token",
    activeWalletKey: `evm:${SECOND_EVM_ADDRESS}`,
  });

  assert.equal(current.state, "authenticated");
  assert.equal(current.walletKey, `evm:${SECOND_EVM_ADDRESS}`);
  assert.equal(current.user?.username, "bob");
});

test("resolveCurrentUser returns public profile requiring signature when wallet is claimed but not remembered", async () => {
  const { repos, users, wallets, families } = makeRepos();
  users.set("user-1", makeUser({ username: "alice" }));
  wallets.push(makeWallet());
  const tokenHash = "token-hash";
  families.set(tokenHash, makeFamily({ token_hash: tokenHash }));
  const service = createWalletSessionService(repos, {
    now: () => NOW,
    hashToken: () => tokenHash,
  });

  const current = await service.resolveCurrentUser({
    sessionToken: "token",
    activeWalletKey: `evm:${EVM_ADDRESS}`,
  });

  assert.deepEqual(current, {
    state: "public_profile_requires_signature",
    walletKey: `evm:${EVM_ADDRESS}`,
    user: null,
    guest: null,
    profile: {
      userId: "user-1",
      username: "alice",
      usernameStatus: "claimed",
      displayName: null,
      avatarUrl: null,
      primaryWallet: {
        chainType: "evm",
        walletAddress: EVM_ADDRESS,
        walletKey: `evm:${EVM_ADDRESS}`,
      },
    },
  });
});

test("resolveCurrentUser ignores expired and revoked wallet sessions", async () => {
  const { repos, users, wallets, families, walletSessions } = makeRepos();
  users.set("user-1", makeUser({ username: "alice" }));
  wallets.push(makeWallet());
  const tokenHash = "token-hash";
  families.set(tokenHash, makeFamily({ token_hash: tokenHash }));
  walletSessions.push(
    makeWalletSession({
      expires_at: new Date("2026-05-07T11:59:59.999Z"),
    }),
  );
  const service = createWalletSessionService(repos, {
    now: () => NOW,
    hashToken: () => tokenHash,
  });

  const current = await service.resolveCurrentUser({
    sessionToken: "token",
    activeWalletKey: `evm:${EVM_ADDRESS}`,
  });

  assert.equal(current.state, "public_profile_requires_signature");
  assert.equal(current.user, null);
});

test("createWalletSession consumes a valid challenge and returns a rotated opaque token", async () => {
  const { repos, users, wallets, challenges, createdTokens } = makeRepos();
  users.set("user-1", makeUser({ username: "alice" }));
  wallets.push(makeWallet());
  const challenge = makeChallenge({ message: "sign in message" });
  challenges.set(challenge.id, challenge);
  const service = createWalletSessionService(repos, {
    now: () => NOW,
    hashToken: (token) => `hash:${token}`,
    createToken: () => "new-token",
    verifySignature: async () => true,
  });

  const result = await service.createWalletSession({
    sessionToken: null,
    challengeId: challenge.id,
    signature: "0xsigned",
  });

  assert.equal(result.sessionToken, "new-token");
  assert.equal(result.current.state, "authenticated");
  assert.equal(result.current.user?.username, "alice");
  assert.deepEqual(createdTokens, ["hash:new-token"]);
  assert.ok(challenges.get(challenge.id)?.consumed_at);
});

test("createWalletSession rejects replayed, expired, and invalid-signature challenges", async () => {
  const { repos, challenges } = makeRepos();
  challenges.set(
    "used",
    makeChallenge({ id: "used", consumed_at: new Date("2026-05-07T12:01:00Z") }),
  );
  challenges.set(
    "expired",
    makeChallenge({
      id: "expired",
      expires_at: new Date("2026-05-07T11:59:59.999Z"),
    }),
  );
  challenges.set("invalid-signature", makeChallenge({ id: "invalid-signature" }));
  const service = createWalletSessionService(repos, {
    now: () => NOW,
    verifySignature: async () => false,
  });

  await assert.rejects(
    service.createWalletSession({
      sessionToken: null,
      challengeId: "used",
      signature: "0xsigned",
    }),
    /CHALLENGE_ALREADY_USED/,
  );
  await assert.rejects(
    service.createWalletSession({
      sessionToken: null,
      challengeId: "expired",
      signature: "0xsigned",
    }),
    /CHALLENGE_EXPIRED/,
  );
  await assert.rejects(
    service.createWalletSession({
      sessionToken: null,
      challengeId: "invalid-signature",
      signature: "0xbad",
    }),
    /SIGNATURE_INVALID/,
  );
});
