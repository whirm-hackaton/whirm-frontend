# Base Sepolia and prefunded ERC-4337 (HS-11)

`src/lib/wallet/network.ts` uses installed viem **2.38.5**, Coinbase account **1.1**, creation nonce **0**, factory `0xba5ed110efdba3d005bfc882d75358acbbb85842`, and EntryPoint **0.6** at `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`, matching `passkey.ts`. Changing versions changes reconstruction assumptions. No new SDK or hosted signing service is added. The browser prepares and signs with the user's existing passkey, then submits directly to Pimlico. The banking API supplies authentication and GET/PUT wallet metadata only.

## Public configuration

Use `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org` or another browser-safe Base Sepolia RPC, and `BUNDLER_URL=https://public.pimlico.io/v2/84532/rpc`. The optional bundler setting defaults to blank, disabling transfers without preventing sign-in, creation or recovery. Configured wallet services require HTTPS without URL credentials, query parameters or a fragment. Bundler/RPC requests omit credentials and never send banking session cookies. There is no banking-origin constraint or backend RPC dependency.

Both URLs are public Vite build values. The example endpoint requires **no API key**. Never put a private Pimlico/service key or provider URL containing it in frontend `.env`, Docker arguments, Vite variables or Git. The supplied private service key is not used. A future explicitly browser-public credential would require provider restrictions, quota review and a deliberate configuration/URL-guard change; the current PoC uses only the keyless endpoint. Docker/Compose pass `BUNDLER_URL` at build time; rebuild after changes. See [Dokploy](dokploy.md).

[Pimlico's public endpoint documentation](https://docs.pimlico.io/references/bundler/public-endpoint) lists standard ERC-4337 methods including send, estimation, receipt, operation lookup, supported EntryPoints and Pimlico gas prices. It limits access to **20 requests/minute/IP**, shared by every tab/user behind that IP. Receipt polling is six seconds (roughly ten polls/minute), leaving room for preparation and submission. Do not retry sends automatically. Concurrent users or repeated preparations can still exhaust the quota; a 429 requires waiting. Public paymaster support is limited to testnets; eligibility and actual sponsorship belong to HS-16.

The [supported EntryPoints reference](https://docs.pimlico.io/references/bundler/endpoints/eth_supportedEntryPoints) shows the v0.6 address in its example. This is not proof that the chosen endpoint currently supports it on Base Sepolia: the adapter checks `eth_supportedEntryPoints` and both chain IDs before use.

## Adapter contract for HS-15

- `publicClient`: native viem public client on Base Sepolia.
- `networkUnavailableReason(): string | null`: configuration readiness, not a live health check.
- `walletServiceUnavailableReason(serviceUrl): string | null`: shared public HTTPS URL guard.
- `await createPrefundedBundler(account)`: native account-bound viem bundler client. Checks RPC chain ID, bundler chain ID (both **84532**) and supported EntryPoint **0.6** before returning. No paymaster; credentials omitted; retries disabled; request timeout 15 seconds; polling interval six seconds.
- `networkError(error, submittedHash?): string`: safe English errors for funding, deployment, signature, rejection, provider access/rate limits and network uncertainty. Never displays provider URLs/bodies. Provider 401/403 is not banking session expiration.

Pimlico `standard` fees come from `pimlico_getUserOperationGasPrice`; hex quantities and fee ordering are validated. Viem prepares gas limits, current transaction nonce and deployment `initCode`. Passkey nonce **0** is the factory creation nonce, not a fixed transaction nonce.

HS-15 owns prepare → review → passkey sign → submit → receipt. Estimation uses a stub signature and does not authorize spending. In viem 2.38.5, account-bound `sendUserOperation` prepares again: submit the immutable signed operation with the accountless `sendUserOperation` action, all prepared fields and `entryPointAddress`, avoiding changes after signing. Native v0.6 serialization uses `sender`, `nonce`, `initCode`, `callData`, `callGasLimit`, `verificationGasLimit`, `preVerificationGas`, `maxFeePerGas`, `maxPriorityFeePerGas`, `paymasterAndData`, `signature`; prefunded `paymasterAndData` is `0x`. Preserve the UserOperation hash and check receipt `success`; inclusion alone does not prove execution. Never automatically resend after submission timeout or an unknown receipt.

## Funding and verification

The account needs Base Sepolia ETH for transfer **plus** network fees and possible first deployment. Receiving ETH does not prove the passkey can spend. No gasless promise; sponsorship is separate.

Run isolated adapter tests with the existing TypeScript/Node toolchain:

```sh
export BACKEND_URL=http://localhost:3000
export WALLET_ORIGIN=http://localhost:5173
export WALLET_RP_ID=localhost
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export BUNDLER_URL=https://public.pimlico.io/v2/84532/rpc
pnpm exec tsc --ignoreConfig src/lib/wallet/network.ts src/lib/wallet/network.test.ts \
  --outDir node_modules/.tmp/network-tests --module nodenext --target es2023 --skipLibCheck
node --test "$PWD/node_modules/.tmp/network-tests/wallet/network.test.js"
pnpm check
pnpm build
git diff --check
```

Tests mock only HTTP, exercising native viem transport, omitted credentials, wrong chain, missing EntryPoint, invalid fees, URL safety and safe errors. The full suite is in [integration verification](integration.md). No duplicate live integration suite is placed in the adapter.

Previous read-only POST probes from this environment to the Base Sepolia RPC (`eth_chainId`) and Pimlico public bundler (`eth_chainId`, `eth_supportedEntryPoints`, `pimlico_getUserOperationGasPrice`) each returned HTTP 403. Live compatibility is unverified. Docker build/deployment, a funded demo account, final-domain passkey and device/provider tests were not performed. Live acceptance requires reopening that exact account, recording its address/balance/domain/RP ID/device, funding it, and submitting one operation with receipt and transaction references. No successful spending is asserted by this branch.

References: [viem bundler](https://viem.sh/account-abstraction/clients/bundler), [Coinbase account](https://viem.sh/account-abstraction/accounts/smart/toCoinbaseSmartAccount), [Pimlico fees](https://docs.pimlico.io/references/bundler/endpoints/pimlico_getUserOperationGasPrice).
