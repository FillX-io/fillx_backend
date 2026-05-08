import assert from "node:assert/strict";
import test from "node:test";
import type { FillxAvatarUpload, FillxUser } from "../db/schema.js";
import { createAvatarService, type AvatarServiceRepos } from "./avatar.service.js";

const NOW = new Date("2026-05-08T12:00:00.000Z");
const EXPIRES = new Date("2026-05-08T12:10:00.000Z");

function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  return {
    id: input.id === undefined ? "user-1" : input.id,
    username: input.username === undefined ? "alice" : input.username,
    username_status:
      input.username_status === undefined ? "claimed" : input.username_status,
    display_name: input.display_name === undefined ? null : input.display_name,
    avatar_key: input.avatar_key === undefined ? null : input.avatar_key,
    avatar_updated_at:
      input.avatar_updated_at === undefined ? null : input.avatar_updated_at,
    nationality: input.nationality === undefined ? null : input.nationality,
    created_at: input.created_at === undefined ? NOW : input.created_at,
    updated_at: input.updated_at === undefined ? NOW : input.updated_at,
  };
}

function makeUpload(input: Partial<FillxAvatarUpload> = {}): FillxAvatarUpload {
  return {
    id: input.id === undefined ? "upload-1" : input.id,
    user_id: input.user_id === undefined ? "user-1" : input.user_id,
    incoming_bucket:
      input.incoming_bucket === undefined ? "incoming" : input.incoming_bucket,
    incoming_key:
      input.incoming_key === undefined
        ? "avatars/incoming/user-1/upload-1/random-1.png"
        : input.incoming_key,
    source_content_type:
      input.source_content_type === undefined
        ? "image/png"
        : input.source_content_type,
    source_content_length:
      input.source_content_length === undefined
        ? 12
        : input.source_content_length,
    status: input.status === undefined ? "pending" : input.status,
    public_bucket: input.public_bucket === undefined ? null : input.public_bucket,
    public_key: input.public_key === undefined ? null : input.public_key,
    error_code: input.error_code === undefined ? null : input.error_code,
    created_at: input.created_at === undefined ? NOW : input.created_at,
    expires_at: input.expires_at === undefined ? EXPIRES : input.expires_at,
    finalized_at:
      input.finalized_at === undefined ? null : input.finalized_at,
  };
}

function makeRepos(initialUser = makeUser()) {
  let user = initialUser;
  const uploads = new Map<string, FillxAvatarUpload>();
  const created: FillxAvatarUpload[] = [];
  const failures: Array<{ uploadId: string; errorCode: string }> = [];

  const repos: AvatarServiceRepos = {
    users: {
      updateAvatar: async ({ userId, avatarKey, avatarUpdatedAt, now }) => {
        assert.equal(userId, user.id);
        user = {
          ...user,
          avatar_key: avatarKey,
          avatar_updated_at: avatarUpdatedAt,
          updated_at: now,
        };
        return user;
      },
    },
    avatarUploads: {
      createPending: async (input) => {
        const upload = makeUpload({
          id: input.uploadId,
          user_id: input.userId,
          incoming_bucket: input.incomingBucket,
          incoming_key: input.incomingKey,
          source_content_type: input.sourceContentType,
          source_content_length: input.sourceContentLength,
          created_at: input.now,
          expires_at: input.expiresAt,
        });
        uploads.set(upload.id, upload);
        created.push(upload);
        return upload;
      },
      findByIdForUpdate: async (uploadId) => uploads.get(uploadId),
      markFinalized: async (input) => {
        const existing = uploads.get(input.uploadId);
        assert.ok(existing);
        if (existing.status !== "pending") return undefined;
        const finalized = {
          ...existing,
          status: "finalized" as const,
          public_bucket: input.publicBucket,
          public_key: input.publicKey,
          finalized_at: input.now,
        };
        uploads.set(finalized.id, finalized);
        return finalized;
      },
      markFailed: async (input) => {
        const existing = uploads.get(input.uploadId);
        if (!existing || existing.status !== "pending") return false;
        failures.push(input);
        uploads.set(existing.id, {
          ...existing,
          status: "failed",
          error_code: input.errorCode,
        });
        return true;
      },
      markExpired: async ({ uploadId }) => {
        const existing = uploads.get(uploadId);
        if (!existing || existing.status !== "pending") return false;
        uploads.set(existing.id, { ...existing, status: "expired" });
        return true;
      },
    },
    runTransaction: async (fn) => fn(repos),
  };

  return { repos, uploads, created, failures, getUser: () => user };
}

test("failure marking does not overwrite an upload finalized after rollback", async () => {
  const { repos, uploads, failures } = makeRepos(
    makeUser({ avatar_key: "avatars/public/user-1/old.webp" }),
  );
  uploads.set("upload-1", makeUpload());
  const racingRepos: AvatarServiceRepos = {
    ...repos,
    runTransaction: async (fn) => {
      try {
        return await fn(racingRepos);
      } catch (error) {
        const existing = uploads.get("upload-1");
        if (existing) {
          uploads.set(existing.id, {
            ...existing,
            status: "finalized",
            public_bucket: "public",
            public_key: "avatars/public/user-1/race.webp",
            finalized_at: NOW,
          });
        }
        throw error;
      }
    },
  };
  const service = createAvatarService(
    racingRepos,
    {
      config: {
        incomingBucket: "incoming",
        publicBucket: "public",
        publicBaseUrl: "http://127.0.0.1:9000/public",
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        region: "us-east-1",
      },
      createPresignedUpload: async () => ({ uploadUrl: "", fields: {} }),
      readIncomingObject: async () => ({
        body: Buffer.from("source"),
        contentType: "image/jpeg",
        contentLength: 12,
      }),
      putPublicAvatar: async () => undefined,
    },
    async () => Buffer.from("webp"),
    { now: () => NOW, uuid: () => "avatar-1", randomId: () => "random-1" },
  );

  await assert.rejects(
    service.finalizeAvatarUpload({ userId: "user-1", uploadId: "upload-1" }),
    /AVATAR_UPLOAD_OBJECT_MISMATCH/,
  );

  assert.equal(uploads.get("upload-1")?.status, "finalized");
  assert.equal(uploads.get("upload-1")?.error_code, null);
  assert.deepEqual(failures, []);
});

test("requestAvatarUpload creates a pending intent and presigned POST", async () => {
  const { repos, created } = makeRepos();
  const presignedRequests: unknown[] = [];
  const service = createAvatarService(
    repos,
    {
      config: {
        incomingBucket: "incoming",
        publicBucket: "public",
        publicBaseUrl: "http://127.0.0.1:9000/public",
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        region: "us-east-1",
      },
      createPresignedUpload: async (input) => {
        presignedRequests.push(input);
        return { uploadUrl: "http://upload", fields: { key: input.key } };
      },
      readIncomingObject: async () => {
        throw new Error("not used");
      },
      putPublicAvatar: async () => {
        throw new Error("not used");
      },
    },
    async () => Buffer.from("webp"),
    {
      now: () => NOW,
      uuid: () => "upload-1",
      randomId: () => "random-1",
    },
  );

  const result = await service.requestAvatarUpload({
    userId: "user-1",
    contentType: "image/png",
    contentLength: 12,
  });

  assert.equal(result.uploadId, "upload-1");
  assert.equal(result.uploadUrl, "http://upload");
  assert.equal(result.expiresAt, EXPIRES.toISOString());
  assert.equal(created[0].incoming_key, "avatars/incoming/user-1/upload-1/random-1.png");
  assert.deepEqual(presignedRequests, [
    {
      key: "avatars/incoming/user-1/upload-1/random-1.png",
      contentType: "image/png",
      contentLength: 12,
      expiresSeconds: 600,
    },
  ]);
});

test("finalizeAvatarUpload processes the incoming object and updates the user avatar key", async () => {
  const { repos, uploads, getUser } = makeRepos(
    makeUser({ avatar_key: "avatars/public/user-1/old.webp" }),
  );
  uploads.set("upload-1", makeUpload());
  const publicWrites: Array<{ key: string; body: Buffer }> = [];
  const service = createAvatarService(
    repos,
    {
      config: {
        incomingBucket: "incoming",
        publicBucket: "public",
        publicBaseUrl: "http://127.0.0.1:9000/public",
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        region: "us-east-1",
      },
      createPresignedUpload: async () => {
        throw new Error("not used");
      },
      readIncomingObject: async () => ({
        body: Buffer.from("source"),
        contentType: "image/png",
        contentLength: 12,
      }),
      putPublicAvatar: async (input) => {
        publicWrites.push(input);
      },
    },
    async (source) => Buffer.from(`webp:${source.toString("utf8")}`),
    {
      now: () => NOW,
      uuid: () => "avatar-1",
      randomId: () => "random-1",
    },
  );

  const user = await service.finalizeAvatarUpload({
    userId: "user-1",
    uploadId: "upload-1",
  });

  assert.equal(user.avatar_key, "avatars/public/user-1/avatar-1.webp");
  assert.equal(getUser().avatar_key, "avatars/public/user-1/avatar-1.webp");
  assert.deepEqual(publicWrites, [
    {
      key: "avatars/public/user-1/avatar-1.webp",
      body: Buffer.from("webp:source"),
    },
  ]);
  assert.equal(uploads.get("upload-1")?.status, "finalized");
});

test("finalizeAvatarUpload rejects wrong user and terminal intents with accurate errors", async () => {
  const { repos, uploads } = makeRepos();
  uploads.set("wrong-user", makeUpload({ id: "wrong-user", user_id: "user-2" }));
  uploads.set(
    "expired",
    makeUpload({ id: "expired", expires_at: new Date("2026-05-08T11:59:59.999Z") }),
  );
  uploads.set(
    "already-expired",
    makeUpload({ id: "already-expired", status: "expired" }),
  );
  uploads.set("finalized", makeUpload({ id: "finalized", status: "finalized" }));
  uploads.set("failed", makeUpload({ id: "failed", status: "failed" }));
  const service = createAvatarService(
    repos,
    {
      config: {
        incomingBucket: "incoming",
        publicBucket: "public",
        publicBaseUrl: "http://127.0.0.1:9000/public",
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        region: "us-east-1",
      },
      createPresignedUpload: async () => ({ uploadUrl: "", fields: {} }),
      readIncomingObject: async () => ({ body: Buffer.alloc(0), contentType: null, contentLength: null }),
      putPublicAvatar: async () => undefined,
    },
    async () => Buffer.from("webp"),
    { now: () => NOW, uuid: () => "avatar-1", randomId: () => "random-1" },
  );

  await assert.rejects(
    service.finalizeAvatarUpload({ userId: "user-1", uploadId: "missing" }),
    /AVATAR_UPLOAD_NOT_FOUND/,
  );
  await assert.rejects(
    service.finalizeAvatarUpload({ userId: "user-1", uploadId: "wrong-user" }),
    /AVATAR_UPLOAD_NOT_FOUND/,
  );
  await assert.rejects(
    service.finalizeAvatarUpload({ userId: "user-1", uploadId: "expired" }),
    /AVATAR_UPLOAD_EXPIRED/,
  );
  assert.equal(uploads.get("expired")?.status, "expired");
  await assert.rejects(
    service.finalizeAvatarUpload({
      userId: "user-1",
      uploadId: "already-expired",
    }),
    /AVATAR_UPLOAD_EXPIRED/,
  );
  await assert.rejects(
    service.finalizeAvatarUpload({ userId: "user-1", uploadId: "finalized" }),
    /AVATAR_UPLOAD_ALREADY_FINALIZED/,
  );
  await assert.rejects(
    service.finalizeAvatarUpload({ userId: "user-1", uploadId: "failed" }),
    /AVATAR_UPLOAD_FAILED/,
  );
});

test("finalizeAvatarUpload keeps previous avatar active when object metadata mismatches", async () => {
  const { repos, uploads, getUser, failures } = makeRepos(
    makeUser({ avatar_key: "avatars/public/user-1/old.webp" }),
  );
  uploads.set("upload-1", makeUpload());
  const service = createAvatarService(
    repos,
    {
      config: {
        incomingBucket: "incoming",
        publicBucket: "public",
        publicBaseUrl: "http://127.0.0.1:9000/public",
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        region: "us-east-1",
      },
      createPresignedUpload: async () => ({ uploadUrl: "", fields: {} }),
      readIncomingObject: async () => ({
        body: Buffer.from("source"),
        contentType: "image/jpeg",
        contentLength: 12,
      }),
      putPublicAvatar: async () => undefined,
    },
    async () => Buffer.from("webp"),
    { now: () => NOW, uuid: () => "avatar-1", randomId: () => "random-1" },
  );

  await assert.rejects(
    service.finalizeAvatarUpload({ userId: "user-1", uploadId: "upload-1" }),
    /AVATAR_UPLOAD_OBJECT_MISMATCH/,
  );
  assert.equal(getUser().avatar_key, "avatars/public/user-1/old.webp");
  assert.deepEqual(failures, [
    { uploadId: "upload-1", errorCode: "AVATAR_UPLOAD_OBJECT_MISMATCH" },
  ]);
});

test("removeAvatar clears avatar key and avatar timestamp", async () => {
  const { repos } = makeRepos(
    makeUser({ avatar_key: "avatars/public/user-1/avatar.webp" }),
  );
  const service = createAvatarService(
    repos,
    {
      config: {
        incomingBucket: "incoming",
        publicBucket: "public",
        publicBaseUrl: "http://127.0.0.1:9000/public",
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
        region: "us-east-1",
      },
      createPresignedUpload: async () => ({ uploadUrl: "", fields: {} }),
      readIncomingObject: async () => ({ body: Buffer.alloc(0), contentType: null, contentLength: null }),
      putPublicAvatar: async () => undefined,
    },
    async () => Buffer.from("webp"),
    { now: () => NOW, uuid: () => "avatar-1", randomId: () => "random-1" },
  );

  const user = await service.removeAvatar({ userId: "user-1" });

  assert.equal(user.avatar_key, null);
  assert.equal(user.avatar_updated_at, null);
});
