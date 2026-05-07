import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../server/src/db/client.js";
import { userWallets } from "../server/src/db/schema.js";
import { setupE2E } from "./helpers/harness.js";
import {
  evmWallet,
  secondEvmWallet,
  signEvmMessage,
  signSecondEvmMessage,
  signSolanaMessage,
  solanaWalletAddress,
} from "./helpers/wallets.js";

if (!process.env.E2E_DATABASE_ADMIN_URL) {
  throw new Error("E2E_DATABASE_ADMIN_URL is required for username E2E tests");
}

async function countFillxUsers(): Promise<number> {
  const result = await getDb().execute(
    sql<{ count: string }>`select count(*)::text as count from fillx_users`,
  );
  const rows = Array.isArray(result) ? result : result.rows;
  const count = rows[0]?.count;
  assert.ok(count, "expected fillx_users count row");
  return Number(count);
}

function assertFillxCookie(cookie: string | undefined): void {
  assert.ok(cookie, "expected Set-Cookie header");
  assert.match(cookie, /fillx-session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
}

async function assertRejects(
  promise: Promise<unknown>,
  pattern?: RegExp,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    if (pattern) {
      const text = String(
        error instanceof Error ? error.message : JSON.stringify(error),
      );
      assert.match(text, pattern);
    }
    return true;
  });
}

test("guest current-user is non-persistent and cannot claim without wallet proof", async (t) => {
  const { client } = await setupE2E(t);

  assert.deepEqual(await client.identity.getCurrentUser(), {
    user: null,
    guest: { isGuest: true },
  });
  assert.equal(await countFillxUsers(), 0);

  const challenge = await client.username.requestClaimChallenge({
    username: "guestproof",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });

  await assertRejects(
    client.username.claim({
      challengeId: challenge.challengeId,
      signature: "0xnot-wallet-proof",
    }),
  );
  assert.equal(await countFillxUsers(), 0);
});

test("EVM wallet-only claim issues a FillX session and supports uppercase wallet lookup", async (t) => {
  const { client, cookieJar } = await setupE2E(t);
  const challenge = await client.username.requestClaimChallenge({
    username: "evmclaim",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });

  const claimed = await client.username.claim({
    challengeId: challenge.challengeId,
    signature: await signEvmMessage(challenge.message),
  });

  assert.equal(claimed.user.username, "evmclaim");
  assert.equal(claimed.user.usernameStatus, "claimed");
  assertFillxCookie(cookieJar.lastSetCookieHeader());

  assert.deepEqual(await client.identity.getCurrentUser(), {
    user: claimed.user,
    guest: null,
  });

  const profile = await client.profile.getByWallets({
    walletAddresses: [evmWallet.address.toUpperCase()],
  });
  assert.equal(profile.profiles.length, 1);
  assert.equal(profile.profiles[0].username, "evmclaim");
});

test("Solana wallet-only claim preserves the original wallet address in profile lookup", async (t) => {
  const { client } = await setupE2E(t);
  const challenge = await client.username.requestClaimChallenge({
    username: "solclaim",
    walletAddress: solanaWalletAddress,
    chainType: "solana",
  });

  await client.username.claim({
    challengeId: challenge.challengeId,
    signature: signSolanaMessage(challenge.message),
  });

  const profile = await client.profile.getByWallets({
    walletAddresses: [solanaWalletAddress],
  });
  assert.equal(profile.profiles.length, 1);
  assert.equal(profile.profiles[0].username, "solclaim");
  assert.equal(profile.profiles[0].walletAddress, solanaWalletAddress);
});

test("FillX session cannot request a username claim for a different primary wallet", async (t) => {
  const { baseUrl, cookieJar, createClient, privy } = await setupE2E(t);
  const token = await privy.createAccessToken({
    privyUserId: "did:privy:primary-wallet",
  });
  const { client: privyClient } = createClient({
    baseUrl,
    cookieJar,
    headers: { authorization: `Bearer ${token}` },
  });
  const current = await privyClient.identity.getCurrentUser();
  assert.ok(current.user);
  assert.equal(current.user.usernameStatus, "generated");

  await getDb().insert(userWallets).values({
    user_id: current.user.id,
    chain_type: "evm",
    wallet_address: evmWallet.address.toLowerCase(),
    is_primary: true,
    verified_at: new Date(),
  });

  const { client: fillxSessionClient } = createClient({ baseUrl, cookieJar });

  await assertRejects(
    fillxSessionClient.username.requestClaimChallenge({
      username: "otherwallet",
      walletAddress: secondEvmWallet.address,
      chainType: "evm",
      chainId: 1,
    }),
  );
  assert.equal(await countFillxUsers(), 1);
});

test("Privy access token maps the same DID to the same FillX user", async (t) => {
  const { baseUrl, createClient, privy } = await setupE2E(t);
  const token = await privy.createAccessToken({ privyUserId: "did:privy:same" });
  const { client } = createClient({
    baseUrl,
    headers: { authorization: `Bearer ${token}` },
  });

  const first = await client.identity.getCurrentUser();
  const second = await client.identity.getCurrentUser();

  assert.ok(first.user);
  assert.ok(second.user);
  assert.equal(first.user.id, second.user.id);
  assert.equal(await countFillxUsers(), 1);
});

test("Privy bearer claim uses the Privy-linked FillX user after fresh wallet proof", async (t) => {
  const { baseUrl, createClient, privy } = await setupE2E(t);
  const token = await privy.createAccessToken({
    privyUserId: "did:privy:claim",
  });
  const { client } = createClient({
    baseUrl,
    headers: { authorization: `Bearer ${token}` },
  });

  const current = await client.identity.getCurrentUser();
  assert.ok(current.user);

  const challenge = await client.username.requestClaimChallenge({
    username: "privyclaim",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const claimed = await client.username.claim({
    challengeId: challenge.challengeId,
    signature: await signEvmMessage(challenge.message),
  });

  assert.equal(claimed.user.id, current.user.id);
  assert.equal(claimed.user.username, "privyclaim");
  assert.equal(await countFillxUsers(), 1);
});

test("Privy token does not resolve to an already claimed wallet-backed profile", async (t) => {
  const { baseUrl, client, cookieJar, createClient, privy } = await setupE2E(t);
  const walletChallenge = await client.username.requestClaimChallenge({
    username: "walletonly",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const walletUser = await client.username.claim({
    challengeId: walletChallenge.challengeId,
    signature: await signEvmMessage(walletChallenge.message),
  });

  const token = await privy.createAccessToken({
    privyUserId: "did:privy:isolated",
  });
  const { client: privyClient } = createClient({
    baseUrl,
    cookieJar,
    headers: { authorization: `Bearer ${token}` },
  });

  const privyCurrent = await privyClient.identity.getCurrentUser();
  assert.ok(privyCurrent.user);
  assert.notEqual(privyCurrent.user.id, walletUser.user.id);

  const updated = await privyClient.identity.updateDisplayName({
    displayName: "Privy Display",
  });
  assert.equal(updated.user.id, privyCurrent.user.id);
  assert.equal(updated.user.displayName, "Privy Display");

  const profile = await client.profile.getByWallets({
    walletAddresses: [evmWallet.address],
  });
  assert.equal(profile.profiles.length, 1);
  assert.equal(profile.profiles[0].userId, walletUser.user.id);
  assert.equal(profile.profiles[0].username, "walletonly");
  assert.equal(profile.profiles[0].displayName, null);
  assert.equal(await countFillxUsers(), 2);
});

test("sequential username contention rejects the second wallet claim", async (t) => {
  const { client } = await setupE2E(t);
  const first = await client.username.requestClaimChallenge({
    username: "raceclaim",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const second = await client.username.requestClaimChallenge({
    username: "raceclaim",
    walletAddress: secondEvmWallet.address,
    chainType: "evm",
    chainId: 1,
  });

  await client.username.claim({
    challengeId: first.challengeId,
    signature: await signEvmMessage(first.message),
  });
  await assertRejects(
    client.username.claim({
      challengeId: second.challengeId,
      signature: await signSecondEvmMessage(second.message),
    }),
  );
  assert.equal(await countFillxUsers(), 1);
});

test("concurrent replay of the same challenge succeeds exactly once", async (t) => {
  const { client } = await setupE2E(t);
  const challenge = await client.username.requestClaimChallenge({
    username: "singleuse",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const signature = await signEvmMessage(challenge.message);

  const results = await Promise.allSettled([
    client.username.claim({
      challengeId: challenge.challengeId,
      signature,
    }),
    client.username.claim({
      challengeId: challenge.challengeId,
      signature,
    }),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal(await countFillxUsers(), 1);
});

test("orderly account identifiers cannot satisfy wallet proof and create no users", async (t) => {
  const { client } = await setupE2E(t);

  await assertRejects(
    client.username.requestClaimChallenge({
      username: "orderlyid",
      walletAddress: "orderly-account-123",
      chainType: "evm",
      chainId: 1,
    }),
  );
  await assertRejects(
    client.username.requestClaimChallenge({
      username: "accountid",
      walletAddress: "account_identifier_123",
      chainType: "solana",
    }),
  );

  const challenge = await client.username.requestClaimChallenge({
    username: "wrongproof",
    walletAddress: secondEvmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  await assertRejects(
    client.username.claim({
      challengeId: challenge.challengeId,
      signature: await signEvmMessage(challenge.message),
    }),
  );
  assert.equal(await countFillxUsers(), 0);
});
