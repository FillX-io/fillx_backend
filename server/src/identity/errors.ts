export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_NOT_CONFIGURED"
  | "USER_NOT_AUTHENTICATED"
  | "USER_NOT_FOUND"
  | "INVALID_USERNAME"
  | "USERNAME_RESERVED"
  | "USERNAME_TAKEN"
  | "USERNAME_ALREADY_CLAIMED"
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

export class IdentityApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "IdentityApiError";
  }
}

export function apiError(
  code: ApiErrorCode,
  message: string = code,
): IdentityApiError {
  return new IdentityApiError(code, message);
}
