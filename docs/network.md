# Base Sepolia and prefunded ERC-4337 (HS-11)

`src/lib/wallet/network.ts` uses installed viem **2.38.5**, Coinbase account **1.1**, creation nonce **0**, factory `0xba5ed110efdba3d005bfc882d75358acbbb85842`, and EntryPoint **0.6** at `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`, matching `passkey.ts`. Changing versions changes reconstruction assumptions. No new SDK or hosted signing service is added. The frontend signs with the user's existing passkey; the backend only forwards RPC and has no owner or signing capability.

## Public configuration

Keep `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org` or another browser-safe Base Sepolia RPC. Set `BUNDLER_PROXY_URL=http://localhost:3000/rpc/bundler` locally, or `https://api.whirm.dev/rpc/bundler` after deploying the backend relay. Blank disables transfers without preventing sign-in, wallet creation or recovery. The relay must use the `BACKEND_URL` origin, HTTPS (localhost HTTP allowed), without URL credentials, query or fragment.

Both URLs are public Vite build values. Never put `PIMLICO_API_KEY` or a provider URL containing it in frontend `.env`, Docker arguments or Vite variables. The key belongs in the backend secret environment. Docker/Compose pass the optional relay URL at build time; rebuild after changing it. See [Dokploy](dokploy.md).

## Adapter contract for HS-15

- `publicClient`: native viem public client on Base Sepolia.
- `networkUnavailableReason(): string | null`: configuration readiness, not a live health check.
- `proxyUnavailableReason(proxyUrl, backendUrl): string | null`: shared relay URL guard.
- `await createPrefundedBundler(account)`: native account-bound viem bundler client. Checks RPC chain ID, bundler chain ID (both **84532**) and supported EntryPoint **0.6** before return. No paymaster. Includes relay cookies; retries disabled, request timeout 15 seconds.
- `networkError(error, submittedHash?): string`: safe English errors for funding, deployment, signature, rejection, expiration, throttling and network uncertainty. Never displays provider URLs or bodies.

Pimlico `standard` fees come from `pimlico_getUserOperationGasPrice`; hex quantities and fee ordering are validated. Viem prepares gas limits, current transaction nonce and deployment `initCode`. Passkey nonce **0** is the factory creation nonce, not a fixed transaction nonce.

HS-15 owns prepare → review → passkey sign → submit → receipt. Gas estimation uses a stub signature and does not authorize spending. In viem 2.38.5, account-bound `sendUserOperation` prepares again: submit an immutable signed operation using the accountless `sendUserOperation` action with all prepared fields and `entryPointAddress`, avoiding changes after signing. Preserve the UserOperation hash and check receipt `success`; inclusion alone does not prove execution. Never automatically resend after submission timeout or an unknown receipt.

## Backend relay contract

The companion backend HS-11 branch owns `POST /rpc/bundler`; deploy it before real sending. Fixed upstream: `https://api.pimlico.io/v2/84532/rpc`, key added only server-side. Required methods:

| Method | Parameters |
|---|---|
| `eth_chainId` | none |
| `eth_supportedEntryPoints` | none |
| `pimlico_getUserOperationGasPrice` | none |
| `eth_estimateUserOperationGas` | v0.6 UserOperation, EntryPoint 0.6 |
| `eth_sendUserOperation` | signed v0.6 UserOperation, EntryPoint 0.6 |
| `eth_getUserOperationReceipt` | 32-byte UserOperation hash |
| `eth_getUserOperationByHash` | 32-byte UserOperation hash |

Use single JSON-RPC 2.0 requests, no batches. Enforce cookie sessions, approved frontend Origin, credentialed CORS, bounded body/time/rates and fixed upstream. The sender must match the session's registered Base Sepolia wallet, including candidates; accepting it never promotes bank association status. Native viem v0.6 serialization uses `sender`, `nonce`, `initCode`, `callData`, `callGasLimit`, `verificationGasLimit`, `preVerificationGas`, `maxFeePerGas`, `maxPriorityFeePerGas`, `paymasterAndData`, `signature`. Validate fields, hex quantities/bytes and EntryPoint. Prefunded `paymasterAndData` is `0x`; sponsorship belongs to HS-16.

Success: `{ jsonrpc: '2.0', id, result }`. RPC failure: `{ jsonrpc: '2.0', id, error: { code, message } }`, retaining useful AA diagnostics but sanitizing secrets/internal details. HTTP 401 expires auth, 403 refuses policy, 429 throttles, 502/504 reports upstream failure. The relay never signs, changes signed operations or offers unrestricted RPC.

## Funding and verification

The account needs Base Sepolia ETH for transfer **plus** network fees and possible first deployment. Receiving ETH does not prove the passkey can spend. No gasless promise; sponsorship is separate.

Run isolated adapter tests with the existing TypeScript/Node toolchain:

```sh
export BACKEND_URL=http://localhost:3000
export WALLET_ORIGIN=http://localhost:5173
export WALLET_RP_ID=localhost
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export BUNDLER_PROXY_URL=http://localhost:3000/rpc/bundler
pnpm exec tsc --ignoreConfig src/lib/wallet/network.ts src/lib/wallet/network.test.ts \
  --outDir node_modules/.tmp/network-tests --module nodenext --target es2023 --skipLibCheck
node --test "$PWD/node_modules/.tmp/network-tests/wallet/network.test.js"
pnpm check
pnpm build
git diff --check
```

Tests mock only HTTP, exercising native viem transport, cookies, wrong chain, missing EntryPoint, invalid fees, URL safety and safe errors. The full suite is in [integration verification](integration.md). No duplicate live integration suite is placed in the adapter.

Local validation on 11 October 2026: three adapter tests and all 33 existing auth/passkey tests passed, `pnpm check` reported zero errors/warnings, `pnpm build` passed, Compose configuration resolved with public example values, and `git diff --check` passed. Dependencies were copied from the existing locked checkout because offline installation lacked a tarball and registry DNS was unavailable. Read-only POST probes to the Base Sepolia RPC (`eth_chainId`) and Pimlico's documented public bundler (`eth_chainId`, `eth_supportedEntryPoints`, `pimlico_getUserOperationGasPrice`) each returned HTTP 403 from this environment. These attempts do not verify live compatibility or the authenticated relay. Docker image build and deployment were not performed.

Live acceptance is separate: deploy relay/server key, verify RPC/bundler chain and EntryPoint, reopen the final-domain passkey, record its actual address/balance, fund that exact account, and submit one real operation with receipt. This branch asserts no funded demo account, final-domain passkey, device/provider test, live Pimlico compatibility or transaction success. Record address, balance, domain/RP ID, device and transaction references during team verification.

References: [viem bundler](https://viem.sh/account-abstraction/clients/bundler), [Coinbase account](https://viem.sh/account-abstraction/accounts/smart/toCoinbaseSmartAccount), [Pimlico fees](https://docs.pimlico.io/references/bundler/endpoints/pimlico_getUserOperationGasPrice), [supported EntryPoints](https://docs.pimlico.io/references/bundler/endpoints/eth_supportedEntryPoints).
