import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  createPresignedPost,
  type PresignedPostOptions,
} from "@aws-sdk/s3-presigned-post";
import { apiError, IdentityApiError } from "./errors.js";
import type { AvatarSourceContentType } from "./avatar.rules.js";

export type AvatarStorageConfig = {
  endpoint: string | undefined;
  forcePathStyle: boolean;
  region: string;
  incomingBucket: string;
  publicBucket: string;
  publicBaseUrl: string;
};

type EnvLike = Record<string, string | undefined>;
type AvatarStorageSenderOutput =
  | GetObjectCommandOutput
  | HeadObjectCommandOutput
  | PutObjectCommandOutput;
type AvatarStorageSender = {
  send(
    command: HeadObjectCommand | GetObjectCommand | PutObjectCommand,
  ): Promise<AvatarStorageSenderOutput>;
};

function requiredEnv(env: EnvLike, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw apiError(
      "AVATAR_STORAGE_NOT_CONFIGURED",
      `AVATAR_STORAGE_NOT_CONFIGURED: ${key} is required`,
    );
  }
  return value;
}

export function createAvatarStorageConfig(
  env: EnvLike = process.env,
): AvatarStorageConfig {
  return {
    endpoint: env.AVATAR_S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE === "true",
    region: requiredEnv(env, "AVATAR_S3_REGION"),
    incomingBucket: requiredEnv(env, "AVATAR_S3_INCOMING_BUCKET"),
    publicBucket: requiredEnv(env, "AVATAR_S3_PUBLIC_BUCKET"),
    publicBaseUrl: requiredEnv(env, "AVATAR_PUBLIC_BASE_URL"),
  };
}

export function buildPresignedAvatarPostOptions(input: {
  bucket: string;
  key: string;
  contentType: AvatarSourceContentType;
  contentLength: number;
  expiresSeconds: number;
}): PresignedPostOptions {
  return {
    Bucket: input.bucket,
    Key: input.key,
    Fields: {
      key: input.key,
      "Content-Type": input.contentType,
    },
    Conditions: [
      ["eq", "$key", input.key],
      ["eq", "$Content-Type", input.contentType],
      ["content-length-range", input.contentLength, input.contentLength],
    ],
    Expires: input.expiresSeconds,
  };
}

export function publicAvatarPutObjectInput(input: {
  bucket: string;
  key: string;
  body: Buffer;
}) {
  return {
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: "image/webp",
    CacheControl: "public, max-age=31536000, immutable",
  } as const;
}

async function bodyToBuffer(body: GetObjectCommandOutput["Body"]): Promise<Buffer> {
  if (!body) throw apiError("AVATAR_UPLOAD_MISSING_OBJECT");
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isS3NotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return (
    error.name === "NoSuchKey" ||
    error.name === "NotFound" ||
    metadata?.httpStatusCode === 404
  );
}

function mapAvatarStorageReadError(error: unknown): IdentityApiError {
  if (error instanceof IdentityApiError) return error;
  if (isS3NotFoundError(error)) {
    return apiError(
      "AVATAR_UPLOAD_MISSING_OBJECT",
      error instanceof Error ? error.message : "AVATAR_UPLOAD_MISSING_OBJECT",
    );
  }
  return apiError(
    "AVATAR_UPLOAD_FAILED",
    error instanceof Error ? error.message : "AVATAR_UPLOAD_FAILED",
  );
}

export function createAvatarStorage(
  config = createAvatarStorageConfig(),
  deps: { sender?: AvatarStorageSender } = {},
) {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  });
  const sender = deps.sender ?? client;

  return {
    config,

    async createPresignedUpload(input: {
      key: string;
      contentType: AvatarSourceContentType;
      contentLength: number;
      expiresSeconds: number;
    }): Promise<{ uploadUrl: string; fields: Record<string, string> }> {
      const post = await createPresignedPost(
        client,
        buildPresignedAvatarPostOptions({
          bucket: config.incomingBucket,
          key: input.key,
          contentType: input.contentType,
          contentLength: input.contentLength,
          expiresSeconds: input.expiresSeconds,
        }),
      );
      return { uploadUrl: post.url, fields: post.fields };
    },

    async readIncomingObject(input: {
      key: string;
    }): Promise<{ body: Buffer; contentType: string | null; contentLength: number | null }> {
      try {
        const head = (await sender.send(
          new HeadObjectCommand({
            Bucket: config.incomingBucket,
            Key: input.key,
          }),
        )) as HeadObjectCommandOutput;
        const object = (await sender.send(
          new GetObjectCommand({
            Bucket: config.incomingBucket,
            Key: input.key,
          }),
        )) as GetObjectCommandOutput;
        return {
          body: await bodyToBuffer(object.Body),
          contentType:
            head.ContentType === undefined
              ? object.ContentType === undefined
                ? null
                : object.ContentType
              : head.ContentType,
          contentLength:
            typeof head.ContentLength === "number"
              ? head.ContentLength
              : typeof object.ContentLength === "number"
                ? object.ContentLength
                : null,
        };
      } catch (error) {
        throw mapAvatarStorageReadError(error);
      }
    },

    async putPublicAvatar(input: { key: string; body: Buffer }): Promise<void> {
      await sender.send(
        new PutObjectCommand(
          publicAvatarPutObjectInput({
            bucket: config.publicBucket,
            key: input.key,
            body: input.body,
          }),
        ),
      );
    },
  };
}

export type AvatarStorage = ReturnType<typeof createAvatarStorage>;
