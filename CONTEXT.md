# FillX Identity Context

FillX Identity describes how users, wallets, display metadata, and authentication identities relate to public trading profiles. It exists to keep wallet ownership, profile lookup, and account authentication language precise.

FillX profile identity is anchored by verified wallets. A profile may have editable display metadata such as display name, avatar, and nationality, but display name is nullable and not unique. Public UI should render `displayName || shortened primary wallet address`.

## Language

**User Profile**:
A FillX identity record that owns display metadata and any verified wallet bindings.
_Avoid_: account, auth user

**Display Metadata**:
Editable public profile fields such as display name, avatar, and nationality. Display name is nullable and not unique.
_Avoid_: identity proof, unique handle

**Wallet Binding**:
A verified relationship between a user profile and a wallet address for a specific chain.
_Avoid_: wallet hint, supplied wallet

**Wallet Lookup Hint**:
A wallet address supplied by a request to find an existing profile without proving wallet control.
_Avoid_: wallet binding, wallet proof

**Current User**:
The user profile authenticated for the current request.
_Avoid_: wallet profile, resolved profile, guest user

**Guest Response**:
A non-persistent API response for an anonymous visitor that cannot own identity state.
_Avoid_: generated user, anonymous account

**Wallet Proof**:
A fresh cryptographic signature that proves control of a wallet for a specific action.
_Avoid_: wallet address, connected wallet

**Wallet Identity**:
A user identity established from verified control of a wallet address on a specific chain.
_Avoid_: anonymous user, connected wallet

**Primary Wallet**:
The verified wallet binding used as the stable public fallback for a profile when display name is absent.
_Avoid_: display name, lookup hint

**Privy Identity**:
A verified Privy DID from a valid Privy access token.
_Avoid_: wallet, profile

**FillX Session**:
A backend-issued JWT stored in an HTTP-only cookie that authenticates a request as a specific FillX user profile.
_Avoid_: wallet proof, Privy token

**Proof Type**:
The class of evidence accepted for a privileged identity mutation.
_Avoid_: auth method, login state

**Orderly Account**:
A trading account on Orderly derived from a wallet address and broker ID.
_Avoid_: wallet, user profile

**Orderly Subaccount**:
A trading account controlled under an Orderly main account.
_Avoid_: wallet, wallet binding

## Relationships

- A **User Profile** is anchored by verified wallet bindings and may have nullable, non-unique **Display Metadata**.
- Public UI identifies a profile with display name when present, otherwise with a shortened **Primary Wallet** address.
- A **Wallet Binding** requires a **Wallet Proof** or trusted wallet ownership data from an authentication provider.
- A **Wallet Lookup Hint** does not create a **Wallet Binding**.
- A **Wallet Lookup Hint** must not determine the **Current User**.
- An anonymous visitor receives a **Guest Response**, not a permanent **User Profile**.
- A **Guest Response** cannot bind wallets, link Orderly accounts, or upgrade without a verified authentication flow.
- A wallet-only user becomes a **Wallet Identity** after **Wallet Proof**, not merely after connecting a wallet in the browser.
- A **Privy Identity** can authenticate a request without proving control of any **Wallet Binding**.
- A **Privy Identity** must not be linked to a wallet-backed **User Profile** from a request-supplied **Wallet Lookup Hint** alone.
- A **FillX Session** proves the request is authenticated as a FillX user profile, but it is not **Wallet Proof**.
- A **FillX Session** can be issued after wallet proof or verified provider authentication resolves a user profile.
- An **Orderly Account** can be associated with a **User Profile** for trading metadata, but it is not a **Wallet Binding**.
- An **Orderly Subaccount** is subordinate to an **Orderly Account** and must not be treated as a wallet address or profile identity.
- Every privileged identity mutation must declare the accepted **Proof Type**; no other proof type may silently satisfy it.

## Example Dialogue

> **Dev:** "A Privy user sent a wallet address that already has a profile. Should we link the Privy DID to that profile?"
> **Domain expert:** "No. A request-supplied wallet address is only a Wallet Lookup Hint. It cannot determine the Current User or create a link."

> **Dev:** "This Orderly subaccount ID looks like a hex address. Can it identify a profile?"
> **Domain expert:** "No. It is an Orderly Subaccount, not a wallet address. Profile identity is anchored by verified wallet bindings."

> **Dev:** "A MetaMask or Phantom user is not logged in with Privy. Are they anonymous?"
> **Domain expert:** "Not after they sign the wallet challenge. The signature establishes a Wallet Identity for that action."

> **Dev:** "Can a FillX JWT replace wallet signature for a new wallet-bound action?"
> **Domain expert:** "No. A FillX Session authenticates the user profile, but fresh Wallet Proof is still required for wallet-bound actions."

> **Dev:** "Can display name prove that two requests belong to the same FillX user?"
> **Domain expert:** "No. Display name is nullable and not unique. Verified wallet bindings anchor profile identity."

> **Dev:** "Should calling getCurrentUser create a User Profile for an anonymous visitor?"
> **Domain expert:** "No. Anonymous visitors receive a Guest Response. A permanent User Profile is created only after verified auth such as Wallet Proof or Privy authentication."

## Flagged Ambiguities

- "wallet address" was used to mean both **Wallet Lookup Hint** and **Wallet Proof**. Resolved: an address by itself is only a lookup hint; proof requires a fresh signature or trusted provider ownership data.
- "Privy user with wallet" was used to imply wallet ownership. Resolved: a **Privy Identity** proves authentication, not wallet control, unless trusted wallet ownership data is verified.
- "account" was used for both **User Profile** and **Orderly Account**. Resolved: Orderly accounts are trading identifiers and do not anchor profile identity.
- `identity.getCurrentUser` was used for both current-user authentication and wallet-profile resolution. Resolved: **Current User** means the authenticated profile for the request; public wallet profile lookup belongs in profile routes.
- `identity.getCurrentUser` accepted wallet parameters. Resolved: current-user APIs must not accept wallet lookup hints; wallet profile lookup belongs in profile routes.
- Anonymous current-user behavior was ambiguous. Resolved: anonymous visitors receive a non-persistent **Guest Response** and must not create permanent `fillx_users`.
- "session" was used loosely across Privy, wallet, and FillX concepts. Resolved: **FillX Session** means a FillX-issued JWT for current-user authentication and is separate from **Wallet Proof** and **Privy Identity**.
- FillX JWT transport was ambiguous between bearer token and cookie. Resolved: browser-facing FillX sessions use the HTTP-only `fillx-session` cookie.
- Public identity was ambiguous between display metadata, trading accounts, and wallet bindings. Resolved: FillX profile identity is anchored by verified wallets; display metadata does not prove identity.
