# Identity Proof and Session Boundaries

FillX identity mutations accept explicit proof types: a FillX wallet session proves the current FillX user only for the active wallet selector, wallet signatures prove fresh wallet control, Privy authentication proves a Privy DID, Privy verified linked-account data can prove provider-attested wallet linkage, and Orderly credentials prove trading authorization only. We chose this model so username ownership, wallet binding, and trading authorization cannot silently substitute for one another across login paths.

Browser-facing FillX sessions use an opaque HTTP-only cookie whose value is stored only as a server-side hash on a session family. The active wallet is never stored on the family; each request must send the normalized active wallet selector, and the backend authenticates only when that family has an unexpired, unreveoked wallet-session row for that exact wallet key. Anonymous visitors do not create permanent `fillx_users`; they receive non-persistent guest responses until verified auth, such as wallet proof or Privy authentication, creates or resolves a real user profile.

Known-wallet resume lasts 30 days from wallet proof. EVM wallet identity is address-based across EVM chains, so `evm:<address>` maps to the same FillX profile regardless of the chain used for signing. The sign-in challenge still records and verifies the actual signing chain.

## Considered Options

- Treat connected wallet addresses as current-user identity. Rejected because a client-supplied address is only a selector until it matches a server-side wallet-session row or a fresh wallet proof is verified.
- Let Privy access tokens bind request-supplied wallets. Rejected because a Privy access token proves the Privy DID/session, not arbitrary wallet ownership.
- Let Orderly account or subaccount identifiers satisfy username ownership. Rejected because Orderly credentials are trading infrastructure, not FillX identity proof.
- Store FillX JWTs or proof material in browser-readable storage. Rejected because an HTTP-only opaque cookie plus server-side session meaning gives a safer browser default for long-lived FillX sessions.
