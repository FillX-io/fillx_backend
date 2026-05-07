# Identity Proof and Session Boundaries

FillX identity mutations accept explicit proof types: a FillX session proves the current FillX user, wallet signatures prove fresh wallet control, Privy authentication proves a Privy DID, Privy verified linked-account data can prove provider-attested wallet linkage, and Orderly credentials prove trading authorization only. We chose this model so username ownership, wallet binding, and trading authorization cannot silently substitute for one another across login paths.

Browser-facing FillX sessions use a backend-issued JWT stored in an HTTP-only cookie. Anonymous visitors do not create permanent `fillx_users`; they receive non-persistent guest responses until verified auth, such as wallet proof or Privy authentication, creates or resolves a real user profile.

## Considered Options

- Treat connected wallet addresses as current-user identity. Rejected because a client-supplied address is only a lookup hint until a fresh wallet proof is verified.
- Let Privy access tokens bind request-supplied wallets. Rejected because a Privy access token proves the Privy DID/session, not arbitrary wallet ownership.
- Let Orderly account or subaccount identifiers satisfy username ownership. Rejected because Orderly credentials are trading infrastructure, not FillX identity proof.
- Store FillX JWTs in browser-readable storage. Rejected because an HTTP-only cookie gives a safer browser default for long-lived FillX sessions.
