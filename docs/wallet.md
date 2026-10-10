# Wallet metadata

After sign-in, the frontend loads the current account's persisted metadata with `GET /wallets`. **Register simulated candidate** generates a random public EVM-format address and calls `POST /wallets` with only `{ address, chainId: 84532 }`. It does not generate a key pair or prove ownership. No account is deployed; do not send funds to these addresses.

## Flow

- Loading and saving states disable competing actions.
- Each saved association displays its address, Base Sepolia chain, server status, creation date and verification date. `candidate` and `unverified` are explicitly shown as unverified associations; only server metadata can report `verified`.
- Reloading or signing in again restores metadata from the API. Signing out clears the screen without deleting persisted data.
- A `401` clears wallet data and immediately expires the auth session. Network/server errors and invalid responses show an error with **Refresh wallets** for recovery.
- A `409` reports an address conflict without identifying the other account. Refresh, then register a new simulated candidate.
- **Cancel request** aborts the browser request. The server may already have committed the candidate, so refresh is required before retrying. Network failures have the same uncertainty. Retries within the same mounted instance reuse the candidate address, allowing the backend's idempotency to prevent duplicates.

## Modules

`Wallet.svelte` owns the UI; `wallet.ts` owns the HTTP client and response validation. It has no auth imports. `App.svelte` passes the authenticated user ID and expiration callback through `Auth`'s `children(session, expireSession)` snippet, keyed by user ID. Unmounting aborts pending requests and discards late responses.

The backend derives identity exclusively from its session cookie. The frontend also rejects foreign-user metadata, unsupported chains, duplicate IDs and inconsistent verification states before displaying a response. Neither module stores tokens, private keys or seeds in browser storage.

See [API integration](integration.md) for setup, tests and the ticket comparison. Real wallet cryptography, deployment and ownership verification remain separate work.
