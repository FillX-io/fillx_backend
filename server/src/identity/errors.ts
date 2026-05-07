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
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_ALREADY_USED"
  | "SIGNATURE_INVALID"
  | "RATE_LIMITED";

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
