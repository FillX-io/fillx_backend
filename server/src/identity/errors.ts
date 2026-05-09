import { ORPCError } from "@orpc/server";

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_NOT_CONFIGURED"
  | "USER_NOT_AUTHENTICATED"
  | "USER_NOT_FOUND"
  | "PRIMARY_WALLET_ALREADY_SET"
  | "WALLET_PROFILE_NOT_FOUND"
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_ALREADY_USED"
  | "SIGNATURE_INVALID"
  | "RATE_LIMITED"
  | "AVATAR_STORAGE_NOT_CONFIGURED"
  | "AVATAR_INVALID_CONTENT_TYPE"
  | "AVATAR_INVALID_CONTENT_LENGTH"
  | "AVATAR_UPLOAD_NOT_FOUND"
  | "AVATAR_UPLOAD_EXPIRED"
  | "AVATAR_UPLOAD_ALREADY_FINALIZED"
  | "AVATAR_UPLOAD_MISSING_OBJECT"
  | "AVATAR_UPLOAD_OBJECT_MISMATCH"
  | "AVATAR_PROCESSING_FAILED"
  | "AVATAR_UPLOAD_FAILED";

function statusForApiError(code: ApiErrorCode): number {
  switch (code) {
    case "AUTH_REQUIRED":
    case "SESSION_NOT_CONFIGURED":
    case "USER_NOT_AUTHENTICATED":
      return 401;
    case "USER_NOT_FOUND":
    case "WALLET_PROFILE_NOT_FOUND":
    case "CHALLENGE_NOT_FOUND":
    case "AVATAR_UPLOAD_NOT_FOUND":
    case "AVATAR_UPLOAD_MISSING_OBJECT":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "PRIMARY_WALLET_ALREADY_SET":
    case "CHALLENGE_ALREADY_USED":
    case "AVATAR_UPLOAD_ALREADY_FINALIZED":
      return 409;
    case "AVATAR_INVALID_CONTENT_LENGTH":
      return 413;
    case "AVATAR_INVALID_CONTENT_TYPE":
      return 415;
    case "CHALLENGE_EXPIRED":
    case "SIGNATURE_INVALID":
    case "AVATAR_UPLOAD_EXPIRED":
    case "AVATAR_UPLOAD_OBJECT_MISMATCH":
      return 400;
    case "AVATAR_STORAGE_NOT_CONFIGURED":
    case "AVATAR_PROCESSING_FAILED":
    case "AVATAR_UPLOAD_FAILED":
      return 500;
  }
}

export class IdentityApiError extends ORPCError<ApiErrorCode, undefined> {
  readonly internalMessage: string;

  constructor(
    code: ApiErrorCode,
    message: string = code,
  ) {
    const status = statusForApiError(code);
    super(
      code,
      status >= 500
        ? { message: code, status, cause: new Error(message) }
        : { message, status },
    );
    this.internalMessage = message;
    this.name = "IdentityApiError";
  }
}

export function apiError(
  code: ApiErrorCode,
  message: string = code,
): IdentityApiError {
  return new IdentityApiError(code, message);
}
