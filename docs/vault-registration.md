# Integrated personal vault registration

Before wallet creation, **Prepare my vault** offers an existing-vault path or a registration form inside Whirm. A new vault is a separate personal account, with its own email and master password. No shared organization or administrator recovery is created. The user must still sign in to the official Bitwarden extension/app at `https://vault.whirm.dev`, unlock/sync it and confirm readiness. Whirm cannot inspect that client or select its passkey provider. Registration does not create a wallet or a passkey automatically.

## Trust boundary and protocol

The Whirm browser code now handles a master password during registration. It derives the authentication verifier and encrypts the random vault key and RSA private key locally using Web Crypto. The master password, plaintext vault key and plaintext RSA private key are not put in request bodies, browser storage, telemetry or logs. Password inputs are cleared before the request, when leaving the form and on unmount. Mutable key buffers are cleared best-effort; JavaScript strings and CryptoKey lifetimes cannot guarantee memory erasure.

The frontend serves two fixed same-origin relay routes, because Vaultwarden's stock CORS allows its own vault origin rather than app.whirm.dev:

- `POST /vault-registration/start` → `https://vault.whirm.dev/identity/accounts/register/send-verification-email`, carrying email only.
- `POST /vault-registration/finish` → `https://vault.whirm.dev/identity/accounts/register/finish`, carrying the registration token, email, authentication verifier and encrypted key material.

These routes terminate at Nginx, not the banking Hono API. **The frontend web server relays an authentication verifier and encrypted keys.** It does not receive the master password or plaintext vault keys from this implementation. The verifier is still sensitive authentication material: do not log request bodies. This is not a claim that a bank controlling the frontend could never collect the password; the supplied frontend code is a trust dependency.

Registration uses Vaultwarden 1.37.4's supported `RegisterDataCompat` legacy field shape inside the current token-based finish flow: PBKDF2-HMAC-SHA256 (600,000 iterations; normalized email salt), PBKDF2 verifier (master key, untrimmed password salt, one iteration), HKDF-Expand labels `enc`/`mac`, AES-256-CBC with HMAC-SHA256 (cipher string type 2, random IV), a random 64-byte user key, and RSA-OAEP 2048-bit keys in SPKI/PKCS8 format. RSA SHA-1 is the Bitwarden compatibility format; it is not the wallet signature algorithm. The implementation uses native Web Crypto primitives, not an officially supported Bitwarden registration SDK.

The UI applies a **12–1024 character onboarding policy** for the master password, distinct from Whirm's 8–1024 character bank-password policy. This is our form rule, not a claim about all Vaultwarden configurations. Passwords are never trimmed or reused from bank authentication.

## Deployment

Rebuild and redeploy the frontend image so both its bundle and Nginx registration relay are updated. No new environment variable, database, backend route or admin token is needed. Keep the wallet origin/RP ID stable. The vault must allow signups; disabled registration is shown as failure. This PoC handles the flow which returns the registration token immediately (no email verification). If the server requires email verification, the form stops and explains that the user must complete registration in Bitwarden; it never bypasses verification.

The Nginx relay accepts POST from `https://app.whirm.dev` only, limits body size and request rate, refuses query parameters, uses fixed upstream routes and verifies upstream TLS. It strips cookies/authorization and does not expose a vault login, generic proxy, admin API or decrypted vault. Registration requests have access logging disabled and responses are marked no-store. Existing bank auth and wallet API requests remain unchanged. Do not enable body logging in Dokploy/proxy/observability tooling.

Registration completion with a lost connection may have created the account. The UI advises signing in to Bitwarden before retrying; it does not retry automatically or replace an existing account. Leaving the page cannot roll back an already submitted registration. Normal Bitwarden sign-in does not happen inside Whirm.

## Verification

Run `pnpm check`, `pnpm build` and the existing integration tests plus `src/lib/vault/registration.ts` and `registration.test.ts`. Protocol tests independently derive/decrypt with Node/OpenSSL and validate verifier, key wrapping, RSA public/private correspondence, fresh randomness, request destinations, no plaintext password/cookies, unsupported responses, cancellation and unknown completion.

Browser acceptance: existing-vault readiness gates wallet creation; invalid confirmation does not make requests; account creation stays in Whirm; duplicate clicks are suppressed; password inputs clear; errors/disabled signups do not claim success; the vault still requires manual Bitwarden client sign-in. Check keyboard and mobile layouts. Live provider acceptance requires logging in to the newly registered account using an official Bitwarden client and then saving/syncing a real wallet passkey. Automated checks alone do not certify the implementation.

## Validation on 11 October 2026

- 60 frontend/protocol tests passed; Svelte/TypeScript reported zero errors or warnings; production build passed.
- Browser registration created a disposable account in an isolated Vaultwarden 1.37.4 instance. Confirmation mismatch, keyboard submission, one completion request, no plaintext password/cookie in requests, readiness gating/reset and desktop/mobile layout were checked. Banking API responses were fixtures.
- Official Bitwarden CLI 2026.9.1 logged in to that account, synchronized, encrypted/saved an item, locked, unlocked with the master password, synchronized and decrypted the item. The fixture used HTTPS with a locally trusted test certificate; certificate validation remained enabled.
- Docker image built and Nginx syntax passed. The relay refused GET (405), a foreign Origin (403), an unknown route (404) and query parameters (400). A POST containing only `{}` reached the public vault over verified TLS and returned its expected validation error (422), without account creation or email delivery. Nginx's Docker resolver requires the user-defined network supplied by Compose/Dokploy.
- These are isolated interoperability checks, not production signup or a real wallet-passkey test with the new onboarding. Existing production coffres and wallet passkeys were not modified.

## Primary references

- [Vaultwarden 1.37.4 registration data](https://github.com/dani-garcia/vaultwarden/blob/1.37.4/src/api/core/accounts.rs)
- [Vaultwarden 1.37.4 registration token/finish routes](https://github.com/dani-garcia/vaultwarden/blob/1.37.4/src/api/identity.rs)
- [Vaultwarden origin handling](https://github.com/dani-garcia/vaultwarden/blob/1.37.4/src/util.rs)
- [Bitwarden key derivation](https://bitwarden.com/help/kdf-algorithms/)
- [Bitwarden reference cryptography example](https://github.com/bitwarden/help/blob/master/crypto.html) (historical example; use the 600,000 iteration configuration above)
- [Bitwarden authentication verifier derivation](https://github.com/bitwarden/clients/blob/main/libs/common/src/key-management/master-password/services/master-password.service.ts)
