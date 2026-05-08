import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setupE2E } from "./helpers/harness.js";
import {
  activeWalletHeaders,
  assertAuthRequired,
  assertPublicWebp,
  claimAvatarE2EUser,
  postPresignedAvatarUpload,
  tinyPngAvatar,
} from "./helpers/avatar.js";

if (!process.env.E2E_DATABASE_ADMIN_URL) {
  throw new Error("E2E_DATABASE_ADMIN_URL is required for avatar E2E tests");
}

test("wallet user uploads, publishes, fetches, and removes an avatar through MinIO", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);
  assert.equal(process.env.AVATAR_S3_ENDPOINT, "http://127.0.0.1:9000");
  assert.equal(
    process.env.AVATAR_PUBLIC_BASE_URL,
    "http://127.0.0.1:9000/fillx-e2e-public",
  );
  const { userId, walletKey } = await claimAvatarE2EUser(client);
  const { client: activeClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(walletKey),
  });

  const current = await activeClient.identity.getCurrentUser();
  assert.equal(current.state, "authenticated");
  assert.equal(current.user?.id, userId);
  assert.equal(current.user.avatarUrl, null);

  const upload = await activeClient.identity.requestAvatarUpload({
    contentType: "image/png",
    contentLength: tinyPngAvatar.byteLength,
  });
  assert.ok(upload.uploadId);
  assert.ok(upload.uploadUrl);
  assert.ok(upload.fields.key);

  await postPresignedAvatarUpload({
    uploadUrl: upload.uploadUrl,
    fields: upload.fields,
    bytes: tinyPngAvatar,
    contentType: "image/png",
    filename: "avatar.png",
  });

  const finalized = await activeClient.identity.finalizeAvatarUpload({
    uploadId: upload.uploadId,
  });
  assert.equal(finalized.user.id, userId);
  assert.ok(finalized.user.avatarUrl);
  assert.match(finalized.user.avatarUrl, /\/avatars\/public\/.+\.webp$/);
  await assertPublicWebp(finalized.user.avatarUrl);

  const refreshed = await activeClient.identity.getCurrentUser();
  assert.equal(refreshed.user?.avatarUrl, finalized.user.avatarUrl);

  const removed = await activeClient.identity.removeAvatar();
  assert.equal(removed.user.avatarUrl, null);

  const afterRemove = await activeClient.identity.getCurrentUser();
  assert.equal(afterRemove.user?.avatarUrl, null);
});

test("avatar upload endpoints require an authenticated active FillX wallet", async (t) => {
  const { baseUrl, client, createClient } = await setupE2E(t);

  await assertAuthRequired(
    client.identity.requestAvatarUpload({
      contentType: "image/png",
      contentLength: tinyPngAvatar.byteLength,
    }),
  );
  await assertAuthRequired(
    client.identity.finalizeAvatarUpload({ uploadId: randomUUID() }),
  );
  await assertAuthRequired(
    client.identity.removeAvatar(),
  );

  const { walletKey } = await claimAvatarE2EUser(client);

  await assertAuthRequired(
    client.identity.requestAvatarUpload({
      contentType: "image/png",
      contentLength: tinyPngAvatar.byteLength,
    }),
  );
  await assertAuthRequired(
    client.identity.finalizeAvatarUpload({ uploadId: randomUUID() }),
  );
  await assertAuthRequired(client.identity.removeAvatar());

  const { client: spoofedActiveWalletClient } = createClient({
    baseUrl,
    headers: activeWalletHeaders(walletKey),
  });

  await assertAuthRequired(
    spoofedActiveWalletClient.identity.requestAvatarUpload({
      contentType: "image/png",
      contentLength: tinyPngAvatar.byteLength,
    }),
  );
  await assertAuthRequired(
    spoofedActiveWalletClient.identity.finalizeAvatarUpload({
      uploadId: randomUUID(),
    }),
  );
  await assertAuthRequired(spoofedActiveWalletClient.identity.removeAvatar());
});
