# S3 Avatar Upload Design

Date: 2026-05-08

## Goal

Replace FillX avatar URL editing with upload-only, FillX-owned avatar storage. Users upload image files directly from the browser to S3 using backend-issued presigned POSTs. The backend treats the browser upload as untrusted, processes the image with `sharp`, publishes a normalized WebP avatar, and stores only an avatar object key on the FillX profile.

The user-facing API continues to expose `avatarUrl: string | null`, but that URL is derived from server configuration and the stored `avatar_key`.

## Non-Goals

- Do not keep arbitrary external avatar URL editing.
- Do not preserve or migrate existing external `avatar_url` values; this design assumes greenfield avatar data.
- Do not add a cropper UI in the first pass.
- Do not require CloudFront for the MVP because the account is currently blocked by a distribution quota/account limit.
- Do not use real AWS S3 in the default E2E suite.
- Do not add frontend component testing infrastructure in the first pass.
- Do not add image moderation or malware scanning in the first pass.

## Decisions

- Upload method: browser direct to S3 with backend-issued presigned POST.
- Serving method for MVP: public S3 REST URL from a dedicated processed-avatar bucket.
- Future serving method: CloudFront in front of S3, ideally with private S3 and Origin Access Control, once the CloudFront limit is resolved.
- Incoming uploads: private bucket.
- Published avatars: separate public processed bucket for MVP.
- Profile storage: `avatar_key`, not durable public URL.
- Existing `avatar_url`: drop and replace with `avatar_key` plus `avatar_updated_at`.
- Source formats: JPEG, PNG, WebP.
- Max source size: 5 MB.
- Published format: WebP.
- Published dimensions: square `512x512`.
- Image processing: backend `sharp`.
- Remove avatar: supported; old objects are not deleted synchronously.

## Architecture

The avatar system has four boundaries.

1. **Avatar rules**
   - Validates source MIME type and byte length.
   - Builds incoming and public object keys.
   - Builds derived public avatar URLs from `AVATAR_PUBLIC_BASE_URL`.

2. **Avatar storage**
   - Wraps S3-compatible operations.
   - Creates presigned POSTs for private incoming uploads.
   - Reads incoming object metadata and bytes.
   - Writes processed public avatar objects.
   - Uses MinIO in normal E2E and AWS S3 in deployed environments.

3. **Avatar image processor**
   - Decodes user-uploaded source bytes with `sharp`.
   - Rejects invalid or unsupported images.
   - Resizes/crops to a square `512x512` avatar.
   - Encodes WebP.

4. **Avatar application service**
   - Authorizes all operations through the current FillX user.
   - Creates upload intents.
   - Finalizes pending uploads exactly once.
   - Updates the FillX profile only after successful processed-object write.
   - Clears avatar state for remove operations.

The frontend uses the existing profile dialog, but avatar editing becomes an upload action rather than a URL input. The dialog captures the active wallet key and current user ID when opened. All FillX identity RPCs in the avatar flow use that captured wallet key instead of relying on the module-global active wallet selector.

## Storage Layout

Private incoming bucket:

```text
avatars/incoming/{userId}/{uploadId}/{random}.{ext}
```

Public processed bucket:

```text
avatars/public/{userId}/{avatarId}.webp
```

The public object key is immutable/versioned. Replacing an avatar writes a new key and updates the profile. Old processed objects are left for lifecycle policy or later background cleanup.

## Environment

Backend runtime configuration:

```text
AVATAR_S3_ENDPOINT
AVATAR_S3_FORCE_PATH_STYLE
AVATAR_S3_REGION
AVATAR_S3_INCOMING_BUCKET
AVATAR_S3_PUBLIC_BUCKET
AVATAR_PUBLIC_BASE_URL
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

For AWS, `AVATAR_S3_ENDPOINT` is optional and `AVATAR_S3_FORCE_PATH_STYLE` should be false or omitted. For MinIO E2E, both are required.

The public profile serializer derives:

```text
avatarUrl = avatar_key == null
  ? null
  : AVATAR_PUBLIC_BASE_URL + "/" + avatar_key
```

This keeps the later CloudFront migration to a delivery-base-url change.

## Database

`fillx_users` changes:

```sql
drop column avatar_url;

add column avatar_key text null;
add column avatar_updated_at timestamptz null;
```

New table:

```sql
create table fillx_avatar_uploads (
  id uuid primary key,
  user_id uuid not null references fillx_users(id),

  incoming_bucket text not null,
  incoming_key text not null,
  source_content_type text not null,
  source_content_length integer not null,

  status text not null, -- pending | finalized | failed | expired
  public_bucket text null,
  public_key text null,
  error_code text null,

  created_at timestamptz not null,
  expires_at timestamptz not null,
  finalized_at timestamptz null
);
```

Indexes:

```sql
create index fillx_avatar_uploads_user_status_idx
  on fillx_avatar_uploads(user_id, status);

create index fillx_avatar_uploads_expiry_idx
  on fillx_avatar_uploads(expires_at);
```

Implementation may use a partial index for pending uploads if the finalize path needs stronger contention protection. The service must still enforce one successful finalize per upload intent transactionally.

## API

Add identity routes:

```ts
identity.requestAvatarUpload({
  contentType: "image/jpeg" | "image/png" | "image/webp",
  contentLength: number
}) -> {
  uploadId: string,
  uploadUrl: string,
  fields: Record<string, string>,
  expiresAt: string
}
```

```ts
identity.finalizeAvatarUpload({
  uploadId: string
}) -> {
  user: FillxUserProfile
}
```

```ts
identity.removeAvatar() -> {
  user: FillxUserProfile
}
```

`FillxUserProfile` keeps:

```ts
avatarUrl: string | null
```

`identity.updateDisplayName` should no longer accept `avatarUrl`; display name and nationality remain normal profile fields.

## Upload Flow

1. User opens the profile dialog while authenticated as a FillX user for the active wallet selector.
2. Frontend captures `walletKey` and `userId`.
3. User chooses a JPEG, PNG, or WebP file up to 5 MB.
4. Frontend validates file type and size locally.
5. Frontend calls `identity.requestAvatarUpload` using the captured wallet key.
6. Backend validates request, creates a pending upload intent, generates a private incoming key, and returns a short-lived presigned POST.
7. Frontend posts the file directly to S3 using `FormData`.
8. Frontend calls `identity.finalizeAvatarUpload` using the same captured wallet key.
9. Backend verifies the upload intent and incoming S3 object, processes the image with `sharp`, writes the public WebP object, and updates `fillx_users.avatar_key`.
10. Frontend refreshes the profile only if the current wallet key still matches the captured wallet key.

The S3 POST is not an oRPC call. It should not include FillX cookies, JSON headers, or FillX identity headers.

## Remove Flow

1. User clicks remove avatar in the profile dialog.
2. Frontend calls `identity.removeAvatar` using the captured wallet key.
3. Backend clears `avatar_key` and updates `avatar_updated_at`.
4. Frontend refreshes only if the current wallet key still matches the captured wallet key.

The old S3 objects are left in place. S3 lifecycle policy or a later cleanup worker can remove unused objects.

## Security And Error Handling

- Upload intent expiry is 10 minutes.
- Presigned POST policy must constrain the exact incoming key, source content type, content length range, and expiry.
- The backend generates all S3 keys.
- Client-selected filenames are not trusted or reused as object keys.
- Finalize checks that the intent exists, belongs to the current user, is pending, and is unexpired.
- Finalize checks that the incoming object exists and matches expected key, content type, and size.
- Finalize decodes the image server-side; metadata alone is not trusted.
- Finalize writes the processed public object before updating the user profile.
- If S3 upload fails, finalize is not called and the previous avatar remains active.
- If finalize fails, the previous avatar remains active.
- If remove fails, the previous avatar remains active.
- Pending incoming objects are cleaned by S3 lifecycle policy.

## Frontend UX

The current profile dialog remains the entry point.

- Replace the avatar URL input with a hidden file input.
- The visible action is `Change avatar` or `Upload avatar`.
- Show a local preview immediately after valid file selection.
- Use `URL.createObjectURL` for local preview and revoke stale object URLs.
- Show `Remove avatar` when an avatar exists or a new file is selected.
- Disable duplicate submission while upload or finalize is running.
- Display separate errors for local validation, direct S3 upload failure, and backend finalize failure.
- Do not add a cropper in the MVP.

Extract a shared `ProfileAvatar` component for:

- portfolio profile header
- public profile card
- profile dialog preview

`ProfileAvatar` handles circular image rendering, fallback `UserRound`, size variants, and image-load failure fallback. Public profile surfaces should display `publicProfile.avatarUrl` when a wallet has a public profile but the browser lacks a valid wallet session.

## Frontend Identity Safety

The current frontend identity client uses a module-global active wallet selector. That is acceptable for short hook refreshes guarded by request ID, but it is brittle for a multi-step upload chain.

Add a scoped identity request helper so each identity RPC can send an immutable wallet key:

```ts
identityClientForWallet(walletKey)
```

or an equivalent per-request header helper.

The avatar dialog uses the captured wallet key for `requestAvatarUpload`, `finalizeAvatarUpload`, `removeAvatar`, and the final refresh. If the connected wallet changes while the dialog is open or while upload is in progress, the frontend must not render the old result into the new wallet's UI.

Logout paths should consistently call `identity.clearSession()` and clear the active FillX wallet selector before or around Orderly disconnect. This avoids stale avatar/profile state after disconnect.

## E2E Strategy

Normal E2E uses MinIO, not real AWS S3.

The E2E environment provides:

```text
AVATAR_S3_ENDPOINT=http://127.0.0.1:9000
AVATAR_S3_FORCE_PATH_STYLE=true
AVATAR_S3_REGION=us-east-1
AVATAR_S3_INCOMING_BUCKET=fillx-e2e-incoming
AVATAR_S3_PUBLIC_BUCKET=fillx-e2e-public
AVATAR_PUBLIC_BASE_URL=http://127.0.0.1:9000/fillx-e2e-public
AWS_ACCESS_KEY_ID=fillx_e2e
AWS_SECRET_ACCESS_KEY=fillx_e2e_password
```

The avatar E2E should:

1. Create or sign in a FillX wallet-backed user.
2. Request an avatar upload.
3. POST an actual image fixture to MinIO using the returned presigned POST.
4. Finalize the upload.
5. Assert the returned profile has `avatarUrl`.
6. Fetch the public `avatarUrl` and assert the object is WebP.
7. Remove the avatar and assert the profile returns `avatarUrl: null`.

Real AWS and CloudFront are covered only by explicit smoke tests or deployment checks, not by the default E2E suite.

## TDD Plan

Backend tests first:

- Avatar rules unit tests:
  - accepts JPEG, PNG, and WebP
  - rejects unsupported MIME types
  - rejects missing, zero, and over-5-MB lengths
  - builds deterministic incoming and public keys
  - derives public URLs from configured base URL and key
- Avatar storage unit tests with a fake S3 client:
  - presigned POST constrains exact key, content type, size, and expiry
  - public object write sets WebP content type and cache headers
- Avatar service unit tests:
  - request requires current FillX user
  - request creates pending intent and returns presigned POST
  - finalize rejects missing, expired, wrong-user, already-finalized, missing-object, oversize, and invalid-image uploads
  - successful finalize processes image, writes public object, finalizes intent, and updates `avatar_key`
  - failed finalize keeps previous avatar active
  - remove clears `avatar_key` without deleting old objects synchronously
- Repository tests:
  - upload intent state transitions are atomic enough to prevent double finalize
  - profile serialization derives `avatarUrl` from `avatar_key`

Backend E2E:

- MinIO full flow for request upload, direct POST, finalize, public avatar fetch, and remove.

Frontend tests:

- Pure model tests in the existing `node:test` style:
  - accepted and rejected file types
  - max file size
  - local preview state
  - remove action
  - replace action
  - save disabled while uploading/finalizing
  - upload/finalize failure keeps previous avatar
- Contract and typecheck:
  - backend shared contract sync updates generated frontend contract
  - frontend typecheck catches stale route usage

Verification commands:

```bash
yarn workspace @fillx/server run test
yarn workspace @fillx/server run check
yarn check:e2e
yarn e2e:minio:up
yarn workspace @fillx/server run test:e2e
yarn typecheck
```

The existing identity E2E failure around Privy/current-user profile mutation should be handled separately if still present when implementation begins. It is not part of the avatar design.

## Operational Notes

- Keep public read narrowly scoped to the processed avatar bucket or prefix for the S3 MVP.
- Keep incoming uploads private.
- Keep ACLs disabled and use bucket policies, not object ACLs.
- Add lifecycle cleanup for private incoming uploads.
- Add lifecycle cleanup for old processed avatar versions if storage cost matters.
- Store `avatar_key` so CloudFront adoption is a config change.
- Avoid logging presigned POST fields or upload signatures.

## Sources

- AWS S3 presigned URL uploads: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
- AWS POST policy conditions: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html
- AWS S3 Block Public Access: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html
- AWS S3 Object Ownership and ACL guidance: https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html
- AWS CloudFront Origin Access Control for S3: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
