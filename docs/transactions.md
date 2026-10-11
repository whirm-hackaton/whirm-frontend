# Prefunded Base Sepolia transfers (HS-15)

Open the registered wallet with its existing passkey, then use the **Send ETH** form. The address must match the recovered Coinbase Smart Account 1.1 on Base Sepolia, using EntryPoint 0.6. Opening authorizes no spending and leaves the backend wallet association unchanged (`candidate` stays `candidate`). No signing key is sent to the backend.

The transfer form validates an Ethereum recipient and a positive ETH amount with at most 18 decimal places. Zero addresses, self-transfers, exponents and comma separators are refused. **Send** prepares the operation and loads the balance before a separate confirmation. The summary shows the full recipient (with a copy button), amount, network, maximum fee and maximum total. **Exact amounts** retains the entered precision and exact fee/total before signing. Compact values use six significant digits, rounding upward with an explicit `≈` marker; no nonzero fee becomes zero, and the formatter never changes the signed bigint values. This path requires the account balance to cover both amount and fees; sponsoring is not enabled. The fee ceiling comes from the prepared gas limits and `maxFeePerGas`; the execution receipt reports the actual fee.

The transfer flow checks the balance before estimation, again against the prepared fee ceiling, and inside the submission lock after signing. An amount above the balance is refused before account preparation. An amount covered by the balance but exceeding it once fees are included gets a separate explanation. All comparisons and shortfalls use `bigint`. A balance drop after review prevents submission without creating a pending marker.

The shared balance adapter verifies RPC chain ID 84532 before each balance read, including refresh and the final check before sending. A wrong-chain or unavailable RPC blocks the read rather than diagnosing insufficient funds from another network's balance.

Preparation errors retain a **Last transfer check** with the checked balance, amount, available fee ceiling, total and positive shortfall. Unknown fees and totals stay unavailable; a shortfall computed without fees is explicitly labelled as such. **Edit amount** focuses and selects the existing input; **Add funds to wallet** shows the same account address and Base Sepolia funding instructions. Neither action resets the recipient or creates a wallet. Review the transfer again after editing or funding.

Deployment errors AA13/AA14/AA15 stay distinct from explicit account funding errors such as AA21. Merely mentioning `initCode` or `prefund` in RPC diagnostics does not prove insufficient funds; AA31 concerns a paymaster deposit rather than the wallet balance.

**Confirm and send** invokes `account.signUserOperation` before another asynchronous action, retaining the original passkey AbortSignal. Viem may resolve the already-calculated account address first, but no gas/nonce/paymaster network preparation precedes signing. Submission uses viem's accountless `sendUserOperation` action with all reviewed fields and the resulting real signature. The account is explicitly cleared on both client and request, so submission cannot prepare or sign the operation again.

## Configuration

Use the configuration documented in [Base Sepolia network](network.md). `BUNDLER_URL` points directly to an official public, keyless Pimlico HTTPS endpoint. Wallet network requests go directly to that endpoint with credentials omitted. The banking API handles authentication and wallet metadata. Never put a private provider credential in frontend configuration. If the bundler is unconfigured, the UI explains why sending is disabled. The bundler must support `eth_sendUserOperation`, `eth_getUserOperationReceipt`, `eth_supportedEntryPoints`, `eth_chainId` and Pimlico gas-price estimation. The network adapter checks the chain and EntryPoint before preparation.

## Pending, cancellation and failure

Cancellation during preparation/review/signing aborts the passkey request and ignores any late result. Once submission starts, cancellation is unavailable because it cannot undo a submitted operation. Synchronous state guards prevent double-click sends; Web Locks coordinate submission across tabs.

Before network submission, the expected operation hash and public recipient/amount are saved in browser storage under the chain/account address. Storage failure prevents sending. An unknown HTTP/network outcome or receipt timeout retains that hash and blocks another send. Reloading and recovering the same wallet restores the pending receipt check. Do not clear this marker or repeat the transfer while the outcome is unknown. A receipt lookup reuses account settings without requesting another passkey signature.

Only deterministic JSON-RPC parameter/validation rejection codes (`-32602`, `-32500` through `-32510`) clear a rejected submission. Other errors remain uncertain. A valid receipt must match the operation hash, account and EntryPoint. Success requires **both** `receipt.success === true` and the enclosing transaction's `status === 'success'`; inclusion or a returned hash alone never indicates success. Failed operations can still charge gas. The result shows the actual network fee and, on success only, the actual total debited, with a transaction explorer link. **Transfer details** retains the tracking reference (distinct from the transaction hash), entered amount and exact charged values. The full receipt remains internal. Balance refresh follows receipt validation.

A bundler which never returns a receipt after an ambiguous submission leaves sending blocked. This is intentional: inspect the explorer and reconcile the original operation before changing browser storage. The form has no automatic retry or replacement operation. Pending public details persist locally; signing out clears the screen but does not erase that safety marker.

## Verification

The implementation uses the installed viem 2.38.5 account-abstraction actions ([official sending guide](https://viem.sh/account-abstraction/guides/sending-user-operations)).

Run the [integration suite](integration.md#verification). Tests cover exact bigint amount validation, review before signing, duplicate clicks, cancellation/unmount races, insufficient funds, forbidden paymaster data, deterministic rejection, timeout/reload safety, receipt identity/execution failure, stale balance and cross-tab receipt races, and real viem RPC serialization with every signed field preserved. `pnpm check`, `pnpm build` and `git diff --check` are also required.

Fixture tests do not prove a real passkey provider or chain transfer. For live acceptance, configure the public bundler endpoint and wallet origin/RP ID, fund the **recovered account address** with Base Sepolia ETH for amount plus fees, then:

1. Recover the original passkey wallet in the configured secure origin.
2. Confirm its displayed balance and enter a controlled, different recipient with a small test ETH amount.
3. Review address, amount, Base Sepolia and fee ceiling; authorize with the human's existing Bitwarden passkey.
4. Keep the UserOperation hash, transaction hash, successful operation receipt and Base Sepolia explorer link. Verify recipient receipt and updated sender balance.
5. Independently exercise passkey rejection/cancellation, pending receipt lookup and a double click. Never intentionally repeat a send with an uncertain outcome.

No live outgoing transfer, Bitwarden authorization, zero-balance sponsoring or mobile recovery is claimed by these automated checks.
