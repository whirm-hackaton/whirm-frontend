# Reopen the same passkey wallet (HS-42)

1. Sign in to the bank. On the new device, unlock and sync the same personal Bitwarden vault configured with https://vault.whirm.dev. Enable its passkey provider.
2. Choose **Recover my wallet**. The frontend refreshes GET /wallet and validates user, address and Base Sepolia chain (84532).
3. Choose **Use my existing passkey**. This direct click requests a discoverable credential with a fresh random challenge, the configured RP ID and required user verification. No allowCredentials list or old browser receipt is needed. Choose the original wallet passkey in Bitwarden.
4. The frontend validates credential ID/raw ID, challenge, origin, cross-origin flag, RP ID hash and user presence/verification flags. It hashes authenticatorData plus SHA-256(clientDataJSON), parses the ES256 DER signature and recovers the possible P-256 public keys with @noble/curves. High-S WebAuthn signatures are accepted.
5. For each recovered key, viem calculates the Coinbase account address using the same HS-41 version 1.1, factory, one WebAuthn owner and creation nonce 0. Only the key whose address matches GET /wallet permits reopening. No key or metadata is expected from the backend.

WebAuthn assertions do not directly return a public key. Public-key recovery plus matching the registered deterministic account address resolves this without backend passkey storage or dependence on the previous browser. This is frontend recovery, not verification of the bank association. The API candidate status and verifiedAt remain unchanged. No transaction, deployment or spending authorization is submitted; HS-15 must request a fresh passkey signature and validate it on-chain.

GET 404 means no registered wallet and does not automatically create one. Other errors, expired sessions, invalid metadata, wrong passkeys, cancellation, or RPC failure stop recovery without replacing the wallet or invoking credential creation. Cancellation/unmount aborts WebAuthn and discards late results. Recovery does not read or write localStorage; HS-41 retains its receipt only for safe creation retries.

The same wallet origin and RP ID must be used on every device. A localhost passkey cannot recover an app.whirm.dev wallet. The provider choice remains controlled by the browser; the application cannot attest that Bitwarden was selected. Unlocking the vault uses its own UI, never a secret collected by this application.

## Verification

Tests exercise signed P-256 assertions through the real recovery adapter and viem factory calldata, including recovered public key selection, wrong key/address, wrong domain/challenge, missing user verification, malformed signature, high-S signatures and cancellation. State tests exercise a fresh profile with only address/chain API metadata, direct-click confirmation, error handling, session expiration and late results. Run the test commands in [API integration](integration.md), pnpm check and pnpm build.

On 11 October 2026, all 33 frontend tests, pnpm check (zero errors/warnings), pnpm build and git diff --check passed. Against the local API, the HS41 test account loaded its candidate wallet without passkey metadata, keyboard recovery reached confirmation, cancellation returned to a retryable state, and the 390px layout had no horizontal overflow. No actual Bitwarden signature was requested during that UI check.

Actual Bitwarden desktop/mobile selection, vault synchronization and lost-device recovery remain to be checked in HS-38/HS-17. Fixtures do not establish those provider/device behaviors. Deployment and spending are separate.

References: [WebAuthn assertion verification](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion), [noble-curves v1.9.1](https://github.com/paulmillr/noble-curves/tree/1.9.1), [viem Coinbase account](https://viem.sh/account-abstraction/accounts/smart/toCoinbaseSmartAccount).
