import { randomUUID } from "node:crypto";
import type { FillxAvatarUpload, FillxUser } from "../db/schema.js";
import {
  AVATAR_UPLOAD_EXPIRES_MS,
  assertAvatarUploadRequest,
  buildIncomingAvatarKey,
  buildPublicAvatarKey,
} from "./avatar.rules.js";
import type { AvatarStorage } from "./avatar.storage.js";
import { apiError, type ApiErrorCode, IdentityApiError } from "./errors.js";

export type AvatarServiceRepos = {
  users: {
    updateAvatar: (input: {
      userId: string;
      avatarKey: string | null;
      avatarUpdatedAt: Date | null;
      now: Date;
    }) => Promise<FillxUser>;
  };
  avatarUploads: {
    createPending: (input: {
      uploadId: string;
      userId: string;
      incomingBucket: string;
      incomingKey: string;
      sourceContentType: string;
      sourceContentLength: number;
      now: Date;
      expiresAt: Date;
    }) => Promise<FillxAvatarUpload>;
    findByIdForUpdate: (uploadId: string) => Promise<FillxAvatarUpload | undefined>;
    markFinalized: (input: {
      uploadId: string;
      publicBucket: string;
      publicKey: string;
      now: Date;
    }) => Promise<FillxAvatarUpload | undefined>;
    markFailed: (input: {
      uploadId: string;
      errorCode: string;
    }) => Promise<boolean>;
    markExpired: (input: { uploadId: string }) => Promise<boolean>;
  };
  runTransaction: <T>(fn: (repos: AvatarServiceRepos) => Promise<T>) => Promise<T>;
};

export type AvatarImageProcessor = (source: Buffer) => Promise<Buffer>;

function errorCode(error: unknown): ApiErrorCode {
  return error instanceof IdentityApiError ? error.code : "AVATAR_UPLOAD_FAILED";
}

function assertPendingUpload(input: {
  upload: FillxAvatarUpload | undefined;
  uploadId: string;
  userId: string;
  now: Date;
  expireUpload: (uploadId: string) => void;
}): FillxAvatarUpload {
  if (!input.upload || input.upload.user_id !== input.userId) {
    throw apiError("AVATAR_UPLOAD_NOT_FOUND");
  }
  if (input.upload.status === "expired") {
    throw apiError("AVATAR_UPLOAD_EXPIRED");
  }
  if (input.upload.status === "finalized") {
    throw apiError("AVATAR_UPLOAD_ALREADY_FINALIZED");
  }
  if (input.upload.status === "failed") {
    throw apiError("AVATAR_UPLOAD_FAILED");
  }
  if (input.upload.expires_at.getTime() <= input.now.getTime()) {
    input.expireUpload(input.uploadId);
    throw apiError("AVATAR_UPLOAD_EXPIRED");
  }
  return input.upload;
}

function assertIncomingObjectMatches(input: {
  upload: FillxAvatarUpload;
  contentType: string | null;
  contentLength: number | null;
}): void {
  if (
    input.contentType !== input.upload.source_content_type ||
    input.contentLength !== input.upload.source_content_length
  ) {
    throw apiError("AVATAR_UPLOAD_OBJECT_MISMATCH");
  }
}

export function createAvatarService(
  repos: AvatarServiceRepos,
  storage: Pick<
    AvatarStorage,
    "config" | "createPresignedUpload" | "readIncomingObject" | "putPublicAvatar"
  >,
  processImage: AvatarImageProcessor,
  options: {
    now?: () => Date;
    uuid?: () => string;
    randomId?: () => string;
  } = {},
) {
  const now = options.now === undefined ? () => new Date() : options.now;
  const uuid =
    options.uuid === undefined ? () => randomUUID() : options.uuid;
  const randomId =
    options.randomId === undefined
      ? () => randomUUID().replaceAll("-", "")
      : options.randomId;

  return {
    async requestAvatarUpload(input: {
      userId: string;
      contentType: string;
      contentLength: number;
    }): Promise<{
      uploadId: string;
      uploadUrl: string;
      fields: Record<string, string>;
      expiresAt: string;
    }> {
      const request = assertAvatarUploadRequest(input);
      const currentTime = now();
      const uploadId = uuid();
      const expiresAt = new Date(currentTime.getTime() + AVATAR_UPLOAD_EXPIRES_MS);
      const incomingKey = buildIncomingAvatarKey({
        userId: input.userId,
        uploadId,
        randomId: randomId(),
        extension: request.extension,
      });
      await repos.avatarUploads.createPending({
        uploadId,
        userId: input.userId,
        incomingBucket: storage.config.incomingBucket,
        incomingKey,
        sourceContentType: request.contentType,
        sourceContentLength: request.contentLength,
        now: currentTime,
        expiresAt,
      });
      const presigned = await storage.createPresignedUpload({
        key: incomingKey,
        contentType: request.contentType,
        contentLength: request.contentLength,
        expiresSeconds: Math.floor(AVATAR_UPLOAD_EXPIRES_MS / 1000),
      });
      return {
        uploadId,
        uploadUrl: presigned.uploadUrl,
        fields: presigned.fields,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async finalizeAvatarUpload(input: {
      userId: string;
      uploadId: string;
    }): Promise<FillxUser> {
      const failedUpload: {
        current: { uploadId: string; errorCode: ApiErrorCode } | null;
      } = { current: null };
      const expiredUpload: { current: { uploadId: string } | null } = {
        current: null,
      };

      try {
        return await repos.runTransaction(async (tx) => {
          const currentTime = now();
          const upload = assertPendingUpload({
            upload: await tx.avatarUploads.findByIdForUpdate(input.uploadId),
            uploadId: input.uploadId,
            userId: input.userId,
            now: currentTime,
            expireUpload: (uploadId) => {
              expiredUpload.current = { uploadId };
            },
          });

          try {
            const incoming = await storage.readIncomingObject({
              key: upload.incoming_key,
            });
            assertIncomingObjectMatches({
              upload,
              contentType: incoming.contentType,
              contentLength: incoming.contentLength,
            });
            const publicKey = buildPublicAvatarKey({
              userId: input.userId,
              avatarId: uuid(),
            });
            const processed = await processImage(incoming.body);
            await storage.putPublicAvatar({
              key: publicKey,
              body: processed,
            });
            const updated = await tx.users.updateAvatar({
              userId: input.userId,
              avatarKey: publicKey,
              avatarUpdatedAt: currentTime,
              now: currentTime,
            });
            const finalized = await tx.avatarUploads.markFinalized({
              uploadId: input.uploadId,
              publicBucket: storage.config.publicBucket,
              publicKey,
              now: currentTime,
            });
            if (!finalized) throw apiError("AVATAR_UPLOAD_ALREADY_FINALIZED");
            return updated;
          } catch (error) {
            failedUpload.current = {
              uploadId: input.uploadId,
              errorCode: errorCode(error),
            };
            throw error;
          }
        });
      } catch (error) {
        if (expiredUpload.current !== null) {
          await repos.avatarUploads.markExpired({
            uploadId: expiredUpload.current.uploadId,
          });
        }
        if (failedUpload.current !== null) {
          await repos.avatarUploads.markFailed({
            uploadId: failedUpload.current.uploadId,
            errorCode: failedUpload.current.errorCode,
          });
        }
        throw error;
      }
    },

    async removeAvatar(input: { userId: string }): Promise<FillxUser> {
      return repos.users.updateAvatar({
        userId: input.userId,
        avatarKey: null,
        avatarUpdatedAt: null,
        now: now(),
      });
    },
  };
}
