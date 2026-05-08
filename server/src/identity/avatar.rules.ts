import { apiError } from "./errors.js";

export const AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const AVATAR_UPLOAD_EXPIRES_MS = 10 * 60 * 1000;
export const AVATAR_OUTPUT_SIZE_PX = 512;

export type AvatarSourceContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export type AvatarSourceExtension = "jpg" | "png" | "webp";

const EXTENSION_BY_CONTENT_TYPE: Record<
  AvatarSourceContentType,
  AvatarSourceExtension
> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function assertAvatarUploadRequest(input: {
  contentType: string;
  contentLength: number | undefined;
}): {
  contentType: AvatarSourceContentType;
  contentLength: number;
  extension: AvatarSourceExtension;
} {
  const contentType = input.contentType.trim().toLowerCase();
  if (
    contentType !== "image/jpeg" &&
    contentType !== "image/png" &&
    contentType !== "image/webp"
  ) {
    throw apiError("AVATAR_INVALID_CONTENT_TYPE");
  }

  if (
    input.contentLength === undefined ||
    !Number.isInteger(input.contentLength) ||
    input.contentLength <= 0 ||
    input.contentLength > AVATAR_MAX_SOURCE_BYTES
  ) {
    throw apiError("AVATAR_INVALID_CONTENT_LENGTH");
  }

  return {
    contentType,
    contentLength: input.contentLength,
    extension: EXTENSION_BY_CONTENT_TYPE[contentType],
  };
}

export function buildIncomingAvatarKey(input: {
  userId: string;
  uploadId: string;
  randomId: string;
  extension: AvatarSourceExtension;
}): string {
  return [
    "avatars",
    "incoming",
    input.userId,
    input.uploadId,
    `${input.randomId}.${input.extension}`,
  ].join("/");
}

export function buildPublicAvatarKey(input: {
  userId: string;
  avatarId: string;
}): string {
  return ["avatars", "public", input.userId, `${input.avatarId}.webp`].join("/");
}

export function buildAvatarPublicUrl(input: {
  publicBaseUrl: string;
  avatarKey: string | null;
}): string | null {
  if (!input.avatarKey) return null;
  const publicBaseUrl = input.publicBaseUrl.trim().replace(/\/+$/, "");
  if (!publicBaseUrl) throw apiError("AVATAR_STORAGE_NOT_CONFIGURED");
  return `${publicBaseUrl}/${input.avatarKey}`;
}
