# HS-48: cancelled passkey creation

The creation adapter now preserves a settled `null` result as a no-credential outcome before viem/ox turns it into a generic `CredentialCreationFailedError`. Cancellation detection follows bounded `cause` chains, including error objects from another realm. Unknown provider failures, parsing failures after a credential was returned, and generic timeout errors remain uncertain.

After a recognized cancellation, only the still-present `{ registering: true }` marker is removed. A replaced public credential draft is preserved. The user can explicitly restart creation; no credential, RPC preparation, or wallet registration is automatically retried. A late credential after Whirm cancellation or component destruction remains saved for recovery.

## Verification

- Unit coverage uses the real viem/ox adapter with a simulated browser credential container: null, rejected/cross-realm errors and invalid returned credentials.
- Wallet tests cover retry after reload, no automatic registration, unknown outcomes, changed drafts and late credentials.
- Browser coverage uses the real frontend and viem/ox, with only auth/wallet API responses and the result of `navigator.credentials.create` simulated. No real vault account or passkey is used.

## Firefox and Bitwarden acceptance still required

1. On an account without a registered wallet, unlock the Bitwarden extension connected to `https://vault.whirm.dev`.
2. Select **Create wallet**, then **Save passkey in Bitwarden**.
3. In Bitwarden select **Create**, then **Cancel** in the new-login form, without saving.
4. Check whether the extension ends the WebAuthn request or returns to its selection screen. If it stays pending, close/cancel the provider prompt before checking the final result. Cancelling its inner form does not necessarily end WebAuthn.
5. For a settled no-credential/cancellation result, expect **Passkey creation cancelled or unavailable. You can try again.**, an enabled creation action and no wallet registration request.
6. Reload: creation must remain available. Retry explicitly and save once; verify there is only one wallet/passkey.
7. For an unknown failure or genuinely returned passkey, retain the recovery protection and public draft. Do not restart blindly.

Record Firefox/Bitwarden versions and the error `name` / cause names only if diagnosis is needed. Do not log vault contents, credentials, assertions or secrets. This PR does not claim the reported real extension scenario is reproduced.
