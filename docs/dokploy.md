# Dokploy deployment (HS-43)

Deploy this repository as a separate **Docker Compose** service alongside Vaultwarden. The frontend origin is `https://app.whirm.dev`; its public API is `https://api.whirm.dev`. The vault stays at `https://vault.whirm.dev`.

## Services

This stack creates only `frontend`: the production Svelte/Vite bundle served by Nginx on internal port 80. The banking API at api.whirm.dev and the vault at vault.whirm.dev are existing services, managed separately. No database, second API, Vaultwarden instance or HTTPS proxy is created here; Dokploy's proxy provides HTTPS.

## Source and build

- Create/select **Docker Compose**, in **Compose** mode (not Docker Stack: this file builds an image).
- GitHub repository: `whirm-hackaton/whirm-frontend`.
- Branch: `main`; Compose Path: `compose.yaml` (or `./compose.yaml`).
- Compose service: **frontend**; domain container port: **80**.
- The Compose file calls the existing Dockerfile; no separate Application build settings are needed.

The Dockerfile uses Node 24, installs the locked dependencies with pnpm, runs `pnpm check` and `pnpm build`, and copies only `dist/` into the runtime image. Nginx serves the SPA and supports direct reloads of client routes. Do not use `pnpm dev` or `pnpm preview` as the production server.

## Environment

In the Compose service's **Environment** tab, paste and save:

```dotenv
BACKEND_URL=https://api.whirm.dev
WALLET_ORIGIN=https://app.whirm.dev
WALLET_RP_ID=app.whirm.dev
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
# Public keyless Pimlico endpoint; blank disables transfers.
BUNDLER_URL=https://public.pimlico.io/v2/84532/rpc
```

The four required values and optional `BUNDLER_URL` are public and embedded in the browser bundle. Compose passes them as Dockerfile **build arguments**, so they reach Vite during the build. Rebuild after a change. Missing required arguments fail the build. The bundler URL connects directly from the browser without cookies; blank disables transfers. Never add a private Pimlico/service key, vault password or private wallet key here. See [network configuration](network.md).

## DNS and HTTPS

Point the `app.whirm.dev` DNS record to the VPS. In **Domains**, set:

| Field | Value |
|---|---|
| Host | app.whirm.dev |
| Service | frontend |
| Path | / |
| Internal Path | empty |
| Strip Path | disabled |
| Container Port | 80 |
| HTTPS | enabled |
| Certificate | letsencrypt |

Save the domain and use **Preview Compose** to inspect Dokploy's generated labels and network. Redeploy after changing a Compose domain. Dokploy's proxy terminates HTTPS; Nginx listens on internal HTTP port 80. Vaultwarden uses a separate service/domain and its existing volume.

## Backend configuration

Coordinate changes with the backend owner. Allow the exact frontend origin in the backend's comma-separated `CORS_ORIGINS`:

```dotenv
CORS_ORIGINS=https://app.whirm.dev
NODE_ENV=production
```

Preserve any other origins still needed by the team. Restart/redeploy the backend after changing its configuration. Both services must be publicly reachable via HTTPS on these same-site subdomains. The client uses `credentials: 'include'`; the API must allow credentialed CORS, with the explicit origin rather than `*`. Keep the session cookie HttpOnly, Secure and SameSite=Lax.

Do not reset the database or assume the production seeder can be run: the existing seeder is disabled in production. Use the test users already prepared by the backend owner.

## Smoke checks

1. Open `https://app.whirm.dev` on PC and iPhone without a certificate warning.
2. Verify no requests go to localhost and no HTTP mixed content is blocked.
3. Sign in, reload and sign out; check `/auth/me` restores the session and logout clears it.
4. Verify `GET /wallet` returns `{ wallet }` or 404 for the current user. Candidate registration uses only `{ address, chainId }` and remains unverified.
5. Create the demonstration passkey on the final origin, explicitly selecting Bitwarden. Reopen on the second device with the existing passkey and compare the same account address.
6. Run the transaction checks separately under HS-15/HS-18. Receiving ETH at an address does not prove the passkey can authorize spending.

Passkeys created for localhost cannot automatically be used on app.whirm.dev. Do not overwrite a credential belonging to an already funded wallet. Use a planned demonstration account on the stable domain and have the team check which wallet should be funded.

Record the deployed commit, versions, URL, actual test results and public transaction references. A successful build is not proof of a working production session or mobile passkey.

## References

- [Dokploy Compose](https://docs.dokploy.com/docs/core/docker-compose)
- [Dokploy Compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains)
- [Authentication and cookies](auth.md)
- [Passkey creation](wallet.md)
- [Existing passkey reopening](passkey-reopening.md)
