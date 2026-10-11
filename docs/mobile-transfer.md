# Transfer after recovery and existing access (HS-18)

HS-15 owns transaction preparation, passkey signing, submission and receipt verification. HS-18 exercises that same implementation on the recovery device and records what happens to existing access. Do not add another transfer adapter or a simulated success path.

## Deployment and prerequisites

Branch: `codex/hs-18-mobile-transfer`, based on `codex/hs-15-transfer` at `94a11e6a92f0d1b715f72a28ccdc6c1094ecf1b8`. Target the HS-15 branch while that work remains unmerged. Integrate subsequent HS-15 commits before final acceptance.

The tested deployment must contain HS-15 and these changes. Record its actual revision. Keep the wallet origin `https://app.whirm.dev` and RP ID `app.whirm.dev`; a different preview domain cannot use this origin's passkey. Use the existing Dokploy configuration and the public `BUNDLER_URL` described in [network.md](network.md). Rebuild after environment changes. Do not change the deployment branch while a teammate is testing without coordination.

Use the same personal Bitwarden vault at `https://vault.whirm.dev`. Have the original wallet address, Base Sepolia network (84532), and a different controlled recipient address ready. Fund the **recovered wallet**, rather than just MetaMask, with enough test ETH for the amount plus the displayed maximum fee. Pending submissions must be reconciled before starting another send.

## Step-by-step mobile test

1. On PC, record the original wallet address and balance on Base Sepolia. Record the block/time used for the balance comparison. Close Firefox and leave the PC unused during the mobile flow; state accurately whether it is powered off or only the browser is closed.
2. On iPhone, unlock and refresh the same Bitwarden vault. Open `https://app.whirm.dev` in Chrome. Sign in to the bank account, select **Recover my wallet**, then **Use my existing passkey** and choose Bitwarden. Do not create another wallet or passkey.
3. Compare the recovered address and network with step 1. Refresh the balance. Check that funds are available; explain changes using explorer activity and block/time. Stop if the address differs.
4. Under **Send test ETH**, enter the controlled recipient and a small amount, for example `0.00001` ETH if the balance covers amount and fees. Select **Review transfer and fees**. Check sender, recipient, amount, network and maximum total.
5. Select **Authorize and send with my passkey**. The human approves the existing Bitwarden passkey on the phone. The PC must not approve or relay this operation.
6. Wait for **Transfer confirmed successfully on Base Sepolia**. A UserOperation hash or a pending message alone is not success. Keep the blockchain transaction hash, explorer link and execution receipt; both operation execution and transaction status must succeed.
7. Verify recipient receipt and refreshed sender balance. The sender change includes the amount and actual network cost. Record whether this transaction deployed the smart account; creating a passkey alone did not deploy it.

## Refusal and old-access checks

- Before a separate send, review a transfer and refuse/cancel the Bitwarden prompt. Expect cancellation with no submitted operation. Refresh/explorer activity must not show that refused transfer as successful. Reopen/review again only after its state is clear.
- A banking session alone cannot complete a send: a fresh passkey signature is required. Do not count wallet recovery as transaction authorization.
- After mobile acceptance, reopen the original PC using the same vault/passkey. Check whether wallet recovery still works and record the result. This may demonstrate an existing usable credential; no additional spend is required. Do not call it proof of spending without an actual signed transaction.
- Vault synchronization and mobile recovery do not revoke the original passkey. Signing out of Whirm closes the banking session, not the wallet credential. No owner rotation, stolen-device revocation or total-vault-loss recovery is implemented here. Record any separately performed vault/device action precisely rather than implying on-chain revocation.
- On a pending or uncertain submission, use **Check execution receipt** and the explorer. Do not repeat the transfer or erase its storage marker. See [transactions.md](transactions.md).

## Evidence record (public data only)

| Field | Value to record |
| --- | --- |
| Operator/date | Kalamar; actual test time |
| Deployment | Actual frontend commit, origin and configured RP ID |
| Devices | PC/iPhone OS, Firefox/Chrome and Bitwarden versions |
| Original device | Browser closed / powered off / other, stated exactly |
| Wallet | Original and recovered address, chain 84532 |
| Funding | Balance/block/time before recovery and before sending |
| Transfer | Controlled recipient, amount, displayed maximum fee |
| Approval | Existing Bitwarden passkey on iPhone; no PC relay |
| Outcome | UserOperation hash, transaction hash, explorer link, receipt success/status |
| Balances | Recipient receipt; sender balance and actual fee after confirmation |
| Refusal | Action and result; no submission confirmed |
| Existing access | Original PC recovery result; any separate access action |
| Limits | Cases not executed, unresolved outcomes and discrepancies |

Never include a master password, private key, session cookie or vault export. Mark each case passed, failed or not executed. Automated tests and a successful recovery alone do not close the live transaction criteria.

## Current evidence

On 11 October 2026, Kalamar reported creating an application account and wallet on PC, saving the passkey in Bitwarden, closing Firefox, refreshing Bitwarden on iPhone and successfully using the synchronized passkey in Chrome on the application. No outgoing mobile transaction, explicit address/balance comparison, refusal test or original-device access check was reported. HS-18 remains awaiting that live evidence.
