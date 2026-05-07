export type UsernameErrorCode = "INVALID_USERNAME" | "USERNAME_RESERVED";

export type UsernameValidationResult =
  | { ok: true; username: string }
  | { ok: false; code: UsernameErrorCode; reason: string };

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "support",
  "help",
  "mod",
  "moderator",
  "fillx",
  "orderly",
  "root",
  "api",
  "official",
  "security",
]);

const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

export function validateUsername(input: string): UsernameValidationResult {
  const username = input.trim();

  if (username !== username.toLowerCase()) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      reason: "Username must be lowercase.",
    };
  }

  if (username.length < 3 || username.length > 20) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      reason: "Username must be 3-20 characters.",
    };
  }

  if (!/^[a-z]/.test(username)) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      reason: "Username must start with a letter.",
    };
  }

  if (username.endsWith("_")) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      reason: "Username must not end with underscore.",
    };
  }

  if (username.includes("__")) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      reason: "Username must not contain consecutive underscores.",
    };
  }

  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      code: "INVALID_USERNAME",
      reason:
        "Username can only contain lowercase letters, numbers, and underscore.",
    };
  }

  if (RESERVED_USERNAMES.has(username)) {
    return {
      ok: false,
      code: "USERNAME_RESERVED",
      reason: "This username is reserved.",
    };
  }

  return { ok: true, username };
}

export function generateUsernameCandidate(
  randomInt = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
): string {
  const value = randomInt() % 0x10000;
  return `trader_${value.toString(16).padStart(4, "0")}`;
}
