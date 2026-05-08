import assert from "node:assert/strict";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "../../shared/src/contract.js";
import { evmWallet, signEvmMessage } from "./wallets.js";

export function evmWalletKey(address: string): string {
  return `evm:${address.toLowerCase()}`;
}

export function activeWalletHeaders(walletKey: string): Record<string, string> {
  return { "x-fillx-active-wallet": walletKey };
}

export async function claimAvatarE2EUser(
  client: ContractRouterClient<Contract>,
): Promise<{ userId: string; walletKey: string }> {
  const challenge = await client.username.requestClaimChallenge({
    username: "avataruser",
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  const claimed = await client.username.claim({
    challengeId: challenge.challengeId,
    signature: await signEvmMessage(challenge.message),
  });
  return {
    userId: claimed.user.id,
    walletKey: evmWalletKey(evmWallet.address),
  };
}

export async function postPresignedAvatarUpload(input: {
  uploadUrl: string;
  fields: Record<string, string>;
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(input.fields)) {
    form.append(key, value);
  }
  form.append(
    "file",
    new Blob([input.bytes as BlobPart], { type: input.contentType }),
    input.filename,
  );

  const response = await fetch(input.uploadUrl, {
    method: "POST",
    body: form,
  });
  assert.ok(
    response.status === 201 || response.status === 204,
    `expected S3 upload success, got ${response.status}: ${await response.text()}`,
  );
}

export async function assertPublicWebp(url: string): Promise<void> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /image\/webp/);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(body.subarray(8, 12).toString("ascii"), "WEBP");
}

export async function assertAuthRequired(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.equal((error as { code?: unknown }).code, "AUTH_REQUIRED");
    assert.equal((error as { status?: unknown }).status, 401);
    return true;
  });
}

export const tinyPngAvatar = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
