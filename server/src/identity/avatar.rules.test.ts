import assert from "node:assert/strict";
import test from "node:test";
import {
  AVATAR_MAX_SOURCE_BYTES,
  assertAvatarUploadRequest,
  buildAvatarPublicUrl,
  buildIncomingAvatarKey,
  buildPublicAvatarKey,
} from "./avatar.rules.js";

test("assertAvatarUploadRequest accepts JPEG, PNG, and WebP up to 5 MB", () => {
  assert.deepEqual(
    assertAvatarUploadRequest({
      contentType: "image/jpeg",
      contentLength: AVATAR_MAX_SOURCE_BYTES,
    }),
    { contentType: "image/jpeg", contentLength: AVATAR_MAX_SOURCE_BYTES, extension: "jpg" },
  );
  assert.equal(
    assertAvatarUploadRequest({
      contentType: "image/png",
      contentLength: 1,
    }).extension,
    "png",
  );
  assert.equal(
    assertAvatarUploadRequest({
      contentType: "image/webp",
      contentLength: 512,
    }).extension,
    "webp",
  );
});

test("assertAvatarUploadRequest rejects unsupported content types", () => {
  assert.throws(
    () =>
      assertAvatarUploadRequest({
        contentType: "image/gif",
        contentLength: 1024,
      }),
    /AVATAR_INVALID_CONTENT_TYPE/,
  );
  assert.throws(
    () =>
      assertAvatarUploadRequest({
        contentType: "",
        contentLength: 1024,
      }),
    /AVATAR_INVALID_CONTENT_TYPE/,
  );
});

test("assertAvatarUploadRequest rejects missing, zero, negative, and over-limit sizes", () => {
  for (const contentLength of [undefined, 0, -1, AVATAR_MAX_SOURCE_BYTES + 1]) {
    assert.throws(
      () =>
        assertAvatarUploadRequest({
          contentType: "image/png",
          contentLength,
        }),
      /AVATAR_INVALID_CONTENT_LENGTH/,
    );
  }
});

test("avatar key builders produce deterministic server-owned keys", () => {
  assert.equal(
    buildIncomingAvatarKey({
      userId: "user-1",
      uploadId: "upload-1",
      randomId: "random-1",
      extension: "png",
    }),
    "avatars/incoming/user-1/upload-1/random-1.png",
  );
  assert.equal(
    buildPublicAvatarKey({ userId: "user-1", avatarId: "avatar-1" }),
    "avatars/public/user-1/avatar-1.webp",
  );
});

test("buildAvatarPublicUrl joins a configured delivery base URL and object key", () => {
  assert.equal(
    buildAvatarPublicUrl({
      publicBaseUrl: "https://cdn.example.com/avatars/",
      avatarKey: "avatars/public/user-1/avatar-1.webp",
    }),
    "https://cdn.example.com/avatars/avatars/public/user-1/avatar-1.webp",
  );
  assert.equal(
    buildAvatarPublicUrl({
      publicBaseUrl: "https://cdn.example.com/avatars",
      avatarKey: null,
    }),
    null,
  );
});
