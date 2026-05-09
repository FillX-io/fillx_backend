# Remove Username From FillX Identity

Date: 2026-05-09

## Goal

Remove `username` as a FillX identity concept everywhere: database, backend domain model, shared oRPC contract, frontend UI, tests, and identity documentation. FillX user profiles should expose only editable display metadata plus wallet identity. The public display fallback is `displayName || shortened wallet address`.

## Non-Goals

- Do not replace usernames with another unique handle.
- Do not make `displayName` unique.
- Do not make `displayName` required.
- Do not add profile search by display name.
- Do not keep username columns or routes as compatibility shims.

## Approved Approach

Delete the username model entirely and keep `display_name` nullable on `fillx_users`.

This avoids recreating username under a softer label. Wallet-backed identity already has a stable public identifier: the verified wallet binding. If a profile has no display name, the UI uses the shortened primary wallet address. Anonymous or unauthenticated states continue to use existing guest/no-profile UI states.

Rejected approaches:

- Hide username only in the UI. This leaves the old model active and does not satisfy “remove everywhere.”
- Rename username to display name and keep uniqueness/claiming. This preserves the same complexity under a new label.
- Keep database columns temporarily. This is safer for staged migrations but leaves stale identity state that future code can keep depending on.

## Architecture

`fillx_users` becomes the profile metadata record for a verified identity. It no longer owns a username or username status. Wallet ownership and authentication stay in existing wallet/session tables.

The profile shape becomes:

- `id`
- `displayName: string | null`
- `avatarUrl: string | null`
- `nationality: string | null`
- `primaryWallet: FillxPrimaryWallet | null`

Public wallet profile lookup returns wallet-bound profile metadata without username fields:

- `walletAddress`
- `userId`
- `displayName`
- `avatarUrl`
- `nationality`

Backend modules that currently handle username ownership, username validation, claim challenges, and claim audit records are removed or replaced by wallet-session/profile-update behavior. Wallet proof remains required for wallet-session creation and wallet-bound profile ownership. Normal profile edits remain authenticated by the current FillX wallet session.

## Database

Add a migration that removes username persistence:

1. Drop username-related foreign keys, indexes, and checks.
2. Drop `username_claims`.
3. Drop `username_claim_challenges`.
4. Drop `fillx_users.username`.
5. Drop `fillx_users.username_status`.

The migration intentionally does not backfill `display_name` from old usernames. Existing users who never set a display name will display as their shortened primary wallet address.

The schema keeps:

- `fillx_users.display_name` nullable, max 50 characters.
- `fillx_users.nationality` nullable ISO alpha-2 uppercase code.
- `user_wallets` as the public wallet-to-profile binding.
- wallet session and avatar upload tables unchanged except where type references need to compile.

## API Contract

Remove the `username` router from the oRPC contract:

- `username.checkAvailable`
- `username.requestClaimChallenge`
- `username.claim`

Remove these fields from all profile DTOs:

- `username`
- `usernameStatus`
- `hasClaimedUsername`

Keep `identity.updateDisplayName` for this change and treat it as the profile metadata update endpoint. The route name does not expose username state, and keeping it avoids unrelated generated-client churn. Its public contract updates only `displayName` and `nationality`.

## Backend Behavior

Anonymous current-user reads continue to return a guest response and do not create `fillx_users`.

Verified wallet session creation creates or resolves a FillX user profile without generating a username. If a wallet has no profile, the backend creates a profile row with nullable display metadata and creates the primary wallet binding.

Privy-authenticated current-user behavior continues to resolve or create a FillX user for the Privy identity, but the created profile no longer needs generated username data.

Public wallet lookup returns only profiles with primary wallet bindings. A profile with `displayName: null` is still a valid public profile because wallet identity supplies the stable fallback label.

## Frontend Behavior

Remove username claim UI and any “claim username” calls. For a connected wallet with no profile, the user should be prompted to verify/create the FillX profile through the existing wallet-session flow, then edit display metadata if desired.

Profile surfaces render:

- Primary label: trimmed `displayName`, else shortened wallet address.
- Secondary label: wallet address when a profile exists and the wallet is not already the primary label.
- Avatar: unchanged.
- Nationality: unchanged.

For an authenticated current user without a primary wallet and without a display name, the private current-user UI uses `FillX profile` as the fallback label. Public wallet profile surfaces always have a wallet fallback because public lookup is wallet-based.

The profile editor removes the read-only username field. It keeps display name, nationality, and avatar controls. The display name placeholder is the shortened primary wallet address when available, otherwise empty.

Leaderboard and competition identity cells stop rendering `@username`. They render display name plus wallet address.

## Error Handling

Username-specific errors are removed from reachable API behavior:

- `USERNAME_TAKEN`
- `USERNAME_ALREADY_CLAIMED`
- username validation errors
- username challenge errors that only apply to claim routes

Wallet-session errors remain unchanged:

- missing auth/session
- invalid wallet signature
- expired or already-used wallet challenge
- primary-wallet mismatch

Profile update validation remains:

- display name trims to null when blank
- display name over 50 chars is rejected
- invalid nationality is rejected
- empty profile update is rejected

## Testing

Backend tests should cover:

- Schema migration removes username tables and columns.
- Current-user creation no longer requires or emits username fields.
- Wallet-session creation creates a user profile without generated username data.
- Public wallet lookup returns profiles without username fields.
- Profile update still validates display name and nationality.
- Removed username routes are absent from the contract and generated clients.

Frontend tests should cover:

- Profile summary falls back from missing display name to shortened wallet address.
- Profile editor no longer renders username.
- Leaderboard identity display no longer includes username labels.
- Public profile card no longer opens username claim UI.
- Type checks prove generated contract consumers no longer expect username fields.

E2E coverage should be updated by removing username claim scenarios and keeping wallet-session/profile-read scenarios that prove profile creation and display metadata still work through the HTTP API.

## Rollout

This change is destructive for local and deployed databases because old claimed usernames are dropped. Before applying it outside local development, export any historical username data that might be needed for audit or customer support. The product behavior after migration does not expose or depend on that data.

Implementation should happen as one coordinated backend/frontend change because the shared contract removal will break frontend compilation until consumers are updated.

## Documentation Updates

Update identity docs and ADRs so they no longer say a user profile owns a username. The replacement language:

- A User Profile owns editable display metadata and verified wallet bindings.
- A verified wallet binding is the stable public identity fallback.
- Display names are user-entered presentation metadata, not ownership identifiers.
