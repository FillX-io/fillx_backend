import assert from "node:assert/strict";
import test from "node:test";
import type {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  buildPresignedAvatarPostOptions,
  createAvatarStorage,
  createAvatarStorageConfig,
  publicAvatarPutObjectInput,
} from "./avatar.storage.js";
import { apiError, IdentityApiError } from "./errors.js";

const TEST_STORAGE_CONFIG = {
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
  region: "us-east-1",
  incomingBucket: "incoming",
  publicBucket: "public",
  publicBaseUrl: "http://127.0.0.1:9000/public",
};

type S3Command = HeadObjectCommand | GetObjectCommand | PutObjectCommand;

function assertApiError(error: unknown, code: string): boolean {
  assert.ok(error instanceof IdentityApiError);
  assert.equal(error.code, code);
  return true;
}

test("createAvatarStorageConfig reads required MinIO-compatible config", () => {
  const config = createAvatarStorageConfig({
    AVATAR_S3_ENDPOINT: "http://127.0.0.1:9000",
    AVATAR_S3_FORCE_PATH_STYLE: "true",
    AVATAR_S3_REGION: "us-east-1",
    AVATAR_S3_INCOMING_BUCKET: "incoming",
    AVATAR_S3_PUBLIC_BUCKET: "public",
    AVATAR_PUBLIC_BASE_URL: "http://127.0.0.1:9000/public",
  });

  assert.deepEqual(config, {
    endpoint: "http://127.0.0.1:9000",
    forcePathStyle: true,
    region: "us-east-1",
    incomingBucket: "incoming",
    publicBucket: "public",
    publicBaseUrl: "http://127.0.0.1:9000/public",
  });
});

test("createAvatarStorageConfig rejects missing buckets and public base URL", () => {
  assert.throws(
    () =>
      createAvatarStorageConfig({
        AVATAR_S3_REGION: "us-east-1",
        AVATAR_S3_INCOMING_BUCKET: "",
        AVATAR_S3_PUBLIC_BUCKET: "public",
        AVATAR_PUBLIC_BASE_URL: "http://127.0.0.1:9000/public",
      }),
    /AVATAR_STORAGE_NOT_CONFIGURED/,
  );
  assert.throws(
    () =>
      createAvatarStorageConfig({
        AVATAR_S3_REGION: "us-east-1",
        AVATAR_S3_INCOMING_BUCKET: "incoming",
        AVATAR_S3_PUBLIC_BUCKET: "",
        AVATAR_PUBLIC_BASE_URL: "http://127.0.0.1:9000/public",
      }),
    /AVATAR_STORAGE_NOT_CONFIGURED/,
  );
  assert.throws(
    () =>
      createAvatarStorageConfig({
        AVATAR_S3_REGION: "us-east-1",
        AVATAR_S3_INCOMING_BUCKET: "incoming",
        AVATAR_S3_PUBLIC_BUCKET: "public",
        AVATAR_PUBLIC_BASE_URL: "",
      }),
    /AVATAR_STORAGE_NOT_CONFIGURED/,
  );
});

test("buildPresignedAvatarPostOptions constrains key, content type, size, and expiry", () => {
  assert.deepEqual(
    buildPresignedAvatarPostOptions({
      bucket: "incoming",
      key: "avatars/incoming/user/upload/random.png",
      contentType: "image/png",
      contentLength: 1234,
      expiresSeconds: 600,
    }),
    {
      Bucket: "incoming",
      Key: "avatars/incoming/user/upload/random.png",
      Fields: {
        key: "avatars/incoming/user/upload/random.png",
        "Content-Type": "image/png",
      },
      Conditions: [
        ["eq", "$key", "avatars/incoming/user/upload/random.png"],
        ["eq", "$Content-Type", "image/png"],
        ["content-length-range", 1234, 1234],
      ],
      Expires: 600,
    },
  );
});

test("publicAvatarPutObjectInput sets WebP content type and immutable cache header", () => {
  const body = Buffer.from("webp");
  assert.deepEqual(
    publicAvatarPutObjectInput({
      bucket: "public",
      key: "avatars/public/user/avatar.webp",
      body,
    }),
    {
      Bucket: "public",
      Key: "avatars/public/user/avatar.webp",
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    },
  );
});

test("readIncomingObject maps known S3 not-found responses to missing object", async () => {
  const notFound = Object.assign(new Error("not found"), { name: "NoSuchKey" });
  const storage = createAvatarStorage(TEST_STORAGE_CONFIG, {
    sender: {
      send: async () => {
        throw notFound;
      },
    },
  });

  await assert.rejects(
    storage.readIncomingObject({ key: "avatars/incoming/user/upload/random.png" }),
    (error) => assertApiError(error, "AVATAR_UPLOAD_MISSING_OBJECT"),
  );
});

test("readIncomingObject maps access denied and storage failures to upload failed", async () => {
  const accessDenied = Object.assign(new Error("access denied"), {
    name: "AccessDenied",
  });
  const storage = createAvatarStorage(TEST_STORAGE_CONFIG, {
    sender: {
      send: async () => {
        throw accessDenied;
      },
    },
  });

  await assert.rejects(
    storage.readIncomingObject({ key: "avatars/incoming/user/upload/random.png" }),
    (error) => assertApiError(error, "AVATAR_UPLOAD_FAILED"),
  );
});

test("readIncomingObject maps stream read failures to upload failed", async () => {
  async function* failingBody() {
    throw new Error("stream failed");
  }

  let calls = 0;
  const storage = createAvatarStorage(TEST_STORAGE_CONFIG, {
    sender: {
      send: async (_command: S3Command) => {
        calls += 1;
        if (calls === 1) {
          return { $metadata: {}, ContentType: "image/png", ContentLength: 12 };
        }
        return { $metadata: {}, Body: failingBody() };
      },
    },
  });

  await assert.rejects(
    storage.readIncomingObject({ key: "avatars/incoming/user/upload/random.png" }),
    (error) => assertApiError(error, "AVATAR_UPLOAD_FAILED"),
  );
});

test("readIncomingObject preserves existing identity errors from body reads", async () => {
  async function* failingBody() {
    throw apiError("AVATAR_UPLOAD_MISSING_OBJECT");
  }

  let calls = 0;
  const storage = createAvatarStorage(TEST_STORAGE_CONFIG, {
    sender: {
      send: async (_command: S3Command) => {
        calls += 1;
        if (calls === 1) {
          return { $metadata: {}, ContentType: "image/png", ContentLength: 12 };
        }
        return { $metadata: {}, Body: failingBody() };
      },
    },
  });

  await assert.rejects(
    storage.readIncomingObject({ key: "avatars/incoming/user/upload/random.png" }),
    (error) => assertApiError(error, "AVATAR_UPLOAD_MISSING_OBJECT"),
  );
});
