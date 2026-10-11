# Passkey wallet creation (HS-41)

For reopening on the same or a new device, see [Recover the same wallet (HS-42)](passkey-reopening.md). Recovery uses a discoverable assertion and recovers the public key on the frontend; GET /wallet supplies only the registered address and chain.

The frontend prepares a Coinbase Smart Account on Base Sepolia with one P-256 WebAuthn owner. The browser or operating system chooses the credential provider; the user must select Bitwarden. The application cannot assert which provider was used.

**PoC contract:** the frontend creates the passkey and keeps the public settings needed by the SDK on the client. `PUT /wallet` receives only address and chain ID, as specified by HS-34/HS-41. The API records a candidate; backend ownership verification is outside the PoC. HS-38 validates the real Bitwarden journey; fixtures do not prove provider selection, vault synchronization or account deployment.

## User journey

1. Sign in with the bank account and load saved wallet metadata.
2. Select **Open my vault (new tab)** to open https://vault.whirm.dev. Create a personal vault and choose the master password there, or use an existing account. Connect the official Bitwarden extension/mobile client separately to the self-hosted server https://vault.whirm.dev, using the same personal vault on each device. Enable passkeys, unlock and sync, then return to Whirm. Website sign-in alone does not connect the extension/app.
3. **Create my wallet** refreshes the API to prevent creating over an existing wallet. **Save my passkey in Bitwarden** is a separate direct user click, preserving browser activation for WebAuthn.
4. Create a discoverable ES256 credential with user verification required, attestation `none`, and no authenticator attachment restriction. The frontend receives only the credential ID and public key.
5. Persist the public credential before any RPC call. Compute the address from one WebAuthn owner, fixed account version and fixed creation nonce, then send only address and chain ID to PUT /wallet.
6. Show the registered candidate and its calculated address. Registration is not deployment or proof of control. Creation does not submit a transaction or deploy an account.

No master password, vault secret, private key or seed is requested, stored, sent or logged. Vault registration does not happen through the bank application.

## Interrupted setup

A provider request stores `{ registering: true }` before requesting a passkey. Closing/reloading during that request can leave this marker even if Bitwarden saved nothing. The marker blocks automatic creation to prevent a duplicate; API `GET /wallet` returning 404 confirms only that no wallet metadata exists, not that no passkey exists.

When the API returns 404 and the only saved data is this exact marker (no credential draft), the UI offers **Resume an interrupted setup**. The user must first unlock/sync Bitwarden and explicitly confirm that no Whirm passkey was saved for this account. **Restart wallet setup** acquires the existing cross-tab creation lock, checks the API again and re-reads storage. Only a fresh 404 with the unchanged marker permits removing that one marker. Existing wallet, credential data, malformed/unreadable storage, session failure, other API failures or a busy lock keep data protected. Restart enables the normal creation flow; it never creates a passkey automatically or deletes anything in Bitwarden/on-chain.

If a passkey exists but the API has no wallet address, retain it and coordinate recovery with the team. This action is not a recovery implementation for that case. Do not clear site storage or delete a credential to bypass the guard. A 401 indicates authentication failure and must be resolved through bank sign-in.

## Stable context and SDK parameters

Configure these public values before building:

| Setting                | Local                      | Production                       |
|------------------------|----------------------------|----------------------------------|
| `WALLET_ORIGIN`        | `http://localhost:5173`    | `https://app.whirm.dev`          |
| `WALLET_RP_ID`         | `localhost`                | `app.whirm.dev`                  |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | A reachable Base Sepolia RPC URL |
| `BACKEND_URL`          | `http://localhost:3000`    | The HTTPS banking API URL        |

The current adapter intentionally requires the RP ID to equal the origin hostname. Production requires a secure HTTPS context, a top-level wallet origin exactly matching configuration, and a compatible browser. `vault.whirm.dev` belongs to the vault and is never the wallet RP ID. Passkeys created for localhost are not usable for app.whirm.dev. Use the same production origin on all devices. Preview requires a separate build configured for port 4173; switching ports changes the origin and therefore cannot reuse this branch's localhost metadata.

`viem` is pinned to **2.38.5** for WebAuthn, smart accounts and contract calls; `@noble/curves` is pinned to **1.9.1** for P-256 public point validation. The public format stays x/y without the SEC1 `04` prefix, which is added only for validation. The adapter uses `createWebAuthnCredential`, `toWebAuthnAccount` and `toCoinbaseSmartAccount`:

- Coinbase account version: `1.1`; creation nonce: `0n` (serialized as `'0'`). This is not the evolving transaction nonce.
- Initial owners: exactly the client's P-256 public key; no bank/team owner.
- Factory: `0xba5ed110efdba3d005bfc882d75358acbbb85842`.
- EntryPoint: v0.6, `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`.
- Public key: `0x` plus 128 hex characters containing 32-byte x and y coordinates, without the `04` prefix. Validate a point on P-256 before use.
- The factory `getAddress(owners, nonce)` RPC read computes the expected address. There is no address override and no account deployment in this flow.

The SDK's standard Coinbase contract permits owner-authorized changes and upgrades. The initial single owner does not imply immutable single ownership. Existing-passkey recovery belongs to HS-42; spending belongs to HS-15 and requires a passkey signature validated on-chain. Backend association verification is outside the PoC.

## API contract

`PUT /wallet` sends:

```json
{
  "address": "0x…",
  "chainId": 84532
}
```

PUT success returns `201` or `200` with `{ wallet }`; GET returns `200` with `{ wallet }`, or `404` when the user has no wallet. The API permits one wallet per user. Each wallet contains `id`, `userId`, `address`, `chainId`, `status`, `createdAt`, `verifiedAt`. Credential ID, public key, RP ID and account settings are not sent to or expected from the API. A `409` never replaces the existing wallet or the saved credential.

The frontend validates ID/user ownership, address, chain and dates/status. It accepts creation only when the returned address matches the locally prepared account on Base Sepolia. A successful response does not discard the public credential receipt. No local promotion to `verified` or backend proof request occurs.

## Retry, cancellation and concurrent tabs

Web Locks serialize credential creation per user and origin. Browsers without this primitive cannot create a new wallet safely. A second tab that already confirmed an empty API response reuses the persisted public credential rather than creating a new one. The receipt stays after success for this purpose.

Public recovery data is stored under `whirm-passkey:<userId>:<origin>` in localStorage, never private credential material. A marker is stored before WebAuthn, then replaced immediately by returned public settings before RPC. A settled no-credential result or recognized provider cancellation clears only the unchanged request marker and enables an explicit retry. Wrapped and cross-realm cancellation errors are recognized; replaced credential drafts are preserved. Reload during an unsettled request, or an unknown parsing failure after provider creation, leaves an uncertain marker and blocks new creation; this requires recovering the existing credential/provider or support intervention rather than risking an additional wallet. There is no automatic reset of an uncertain marker.

RPC failure, API rejection, network uncertainty, cancellation and unmount do not discard an already returned credential. Late credential results are persisted but never submitted after cancellation/unmount. Refresh and **Resume wallet creation** reuse it. Denied/quota browser storage blocks creation before requesting a credential. A persistence failure after creation keeps public settings in memory, explicitly warns to keep the tab open, and cannot promise reload recovery.

Session `401` clears the displayed wallet and expires bank auth. Sign-out does not remove the public receipt. New-device recovery belongs to HS-42: GET /wallet supplies address and chain, while remaining public settings must come from the existing passkey or SDK mechanism. It must not assume API storage or depend solely on the old browser's receipt. No export/import workaround is provided by HS-41.

## Verification

Use the compilation/test commands in [API integration](integration.md). Tests cover actual viem creation options and P-256 parsing using a stub browser credential, factory calldata with one owner and nonce zero, malformed keys/context, address-only payload and candidate response, API/RPC/network retry across reload, concurrent-tab receipt reuse, delayed credential results after cancellation/unmount, definitive rejection versus uncertain markers, denied storage, wallet mismatch and session expiration.

Real provider/device acceptance requires Bitwarden selection, vault synchronization and lost-device recovery. For Firefox cancellation, cancel the new-login form without saving, then close the provider prompt if its WebAuthn request remains pending. A settled cancellation must show **Passkey creation cancelled or unavailable. You can try again.**, keep creation available after reload and send no wallet registration request. Retry explicitly and verify only one credential is saved; keep recovery protection for unknown results. Cancelling an inner provider form does not necessarily end WebAuthn.

## Modules

`Wallet.svelte` owns the English UI; `wallet.ts` handles the API, state, receipt and cancellation; `passkey.ts` implements WebAuthn/viem and public metadata guards. `Auth` passes bank identity and expiration through its existing snippet, keyed by user ID. No backend files are changed.

References: [viem credential creation](https://viem.sh/account-abstraction/accounts/webauthn/createWebAuthnCredential), [viem Coinbase account](https://viem.sh/account-abstraction/accounts/smart/toCoinbaseSmartAccount), [POC](https://wiki.dotshark.dev/doc/passkeys-poc-vaultwarden-bancaire-schema-et-etat-des-essais-ZKwEUZioKR), [frontend plan](https://wiki.dotshark.dev/doc/passkeys-plan-dimplementation-frontend-et-parcours-explique-vOIPvaiKrI).
