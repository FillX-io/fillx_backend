# DisplayName-Backed Username Validation Design

## Summary

FillX will keep `displayName` / `display_name` as the internal API and database field, but the user-facing identity label becomes "Username". The value now behaves like a username: required when creating one, unique across users, 3 to 25 characters, and limited to letters, numbers, and underscores.

This avoids reintroducing a separate username column after the username-removal work while giving users a clear, unique handle.

## User Experience

The FillX profile dialog title depends on whether the current user already has a username:

- No current `displayName`: show `Create Username`.
- Existing `displayName`: show `Edit Username`.

The input label is `Username`. It includes the existing transfer `TooltipIcon` and an Orderly tooltip with this copy:

> Username must be unique and between 3 and 25 characters. Can only contain letters, numbers, and underscores.

The input shows a live character counter as `current/25`, uses `maxLength={25}`, and validates the trimmed value before enabling Save. If a user has no username yet, Save requires a valid username even when other profile fields change. Existing usernames cannot be cleared to empty.

## Backend Rules

The public contract keeps the `identity.updateDisplayName` endpoint and `displayName` input name, but the accepted value is now a strict username string when present:

- Trim surrounding whitespace.
- Preserve the user's typed case.
- Require 3 to 25 characters after trimming.
- Allow only ASCII letters, numbers, and underscores.
- Reject empty strings and `null`.
- Enforce uniqueness case-insensitively.

The service returns stable error codes for frontend mapping:

- `USERNAME_REQUIRED`
- `INVALID_DISPLAY_NAME`
- `DISPLAY_NAME_TAKEN`

Nationality-only updates are allowed only for users who already have a valid stored `display_name`. A user with `display_name = null` must create a username before saving other profile fields through the profile update path.

## Database Migration

The `fillx_users.display_name` column remains nullable so legacy users can exist without a username until they create one.

Before adding constraints, the migration clears legacy values that cannot satisfy the username rules:

- Invalid length or invalid characters.
- Case-insensitive duplicates, keeping the earliest `created_at`, then `id` as a deterministic tie-breaker.

After cleanup, database constraints enforce:

- Non-null `display_name` values match `^[A-Za-z0-9_]{3,25}$`.
- `lower(display_name)` is unique for non-null values.

## Testing

Frontend tests cover:

- Trimming and preserving case for valid usernames.
- Rejecting blank, too-short, too-long, spaced, dashed, and non-ASCII usernames.
- Requiring a username before saving nationality for a user who does not have one.
- Keeping existing profile summary wallet/address behavior unchanged.

Backend tests cover:

- Trimming and preserving case.
- Rejecting `null`, blank, invalid length, invalid characters, and non-ASCII values.
- Rejecting case-insensitive duplicates.
- Allowing a user to keep their own username unchanged.
- Rejecting nationality-only updates while `display_name` is null.

Verification commands:

- `cd fillx_backend && yarn workspace @fillx/server test`
- `cd fillx_backend && yarn check`
- `cd eolive && npx tsx --test app/components/profile/fillxPortfolioProfileModel.test.ts`
- `cd eolive && yarn sync:fillx-contract --source ../fillx_backend/shared/src/contract.ts`
- `cd eolive && yarn typecheck`

## Assumptions

- No `username` API field or database column will be reintroduced.
- Existing public profile response shapes remain unchanged.
- User-facing copy may say "Username" while code continues to use `displayName`.
- Pre-existing unrelated worktree changes must be preserved.
