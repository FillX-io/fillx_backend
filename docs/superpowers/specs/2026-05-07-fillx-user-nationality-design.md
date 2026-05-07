# Add Nationality to FillX User

## Goal

Add a user-entered nationality field to the FillX user profile. The value is stored on `fillx_users`, returned by existing identity/profile reads, and editable through the profile update API.

## Decisions

- Nationality is a profile field owned by the FillX user, not derived from IP country or wallet metadata.
- Store nationality as an ISO 3166-1 alpha-2 country code, normalized to uppercase.
- Use `null` for unset nationality.
- Allow users to update nationality through the existing profile API surface.

## Recommended Approach

Add nullable `nationality` directly to `fillx_users`, expose it through current user and public wallet profile DTOs, and extend the existing profile update path to handle both display name and nationality. This keeps the change aligned with the current identity model and avoids adding a separate profile table before there is enough profile data to justify one.

Rejected alternatives:

- Separate user profile table: more flexible later, but adds joins and repository complexity now.
- Country display names or free text: simpler initially, but harder to validate, compare, localize, and filter.
- Backend-only field: lower API surface, but it does not meet the user-entered requirement.

## Data Model

Add `nationality` as nullable text on `fillx_users`.

Rules:

- `null` means unset.
- Non-null values must be exactly two uppercase ASCII letters, such as `US`, `NG`, or `JP`.
- The Drizzle schema should include `nationality: text("nationality")`.
- The migration should add the column and a check constraint equivalent to `nationality is null or nationality ~ '^[A-Z]{2}$'`.

Existing users receive `null` automatically after the migration.

## API and Service Behavior

`FillxUserProfile` includes:

```ts
nationality: string | null;
```

`PublicWalletProfile` includes the same field so public wallet profile lookups stay consistent with current-user responses.

The existing `identity.updateDisplayName` route should keep its route name for this change and expand into a general profile update operation. This minimizes frontend churn while allowing the input to accept partial profile fields:

```ts
{
  displayName?: string | null;
  nationality?: string | null;
}
```

Validation and normalization:

- `displayName` keeps the current behavior: trim input, require a non-empty string when provided, and enforce max length 50.
- Omitted fields are preserved.
- `nationality` accepts `null`, an empty string, or a two-letter country code.
- Empty nationality strings are treated as `null`.
- Non-empty nationality values are trimmed and uppercased before validation.
- Invalid nationality values fail before writing.

The service should return the updated `FillxUser` so route serialization can return the normalized profile.

## Frontend Data Flow

Frontend identity types add `nationality: string | null` to both `FillxUserProfile` and `FillxPublicWalletProfile`.

`useCurrentFillxUser` should not need behavior changes because it already stores the typed profile returned by the identity client.

If a profile editing UI exists during implementation, it should submit the selected ISO country code or `null`. If no profile editing UI exists, the implementation should still expose the typed client path and avoid inventing a new visible form as part of this change.

End-to-end flow:

1. User submits a profile update with optional `nationality`.
2. Frontend sends the ISO code or `null`.
3. Backend normalizes and validates the value.
4. Database stores the normalized value.
5. Current-user and public wallet profile reads return the normalized value.

## Error Handling

Invalid nationality input should produce a validation error without modifying the user row. Partial updates should not clear fields unless the field is explicitly provided as `null` or an empty nationality string.

Database constraint failures should be treated as defense-in-depth. Primary validation belongs in the service layer so clients receive clear API errors.

## Testing

Add focused tests for:

- Lowercase nationality normalizes to uppercase.
- Uppercase nationality is accepted unchanged.
- Empty nationality string clears the field to `null`.
- Explicit `null` clears the field.
- Invalid nationality values are rejected before writing.
- Partial updates preserve omitted profile fields.
- Current-user serialization includes nationality.
- Public wallet profile lookup includes nationality.

Run backend type checks and regenerate/sync the frontend contract so backend and frontend types agree.
