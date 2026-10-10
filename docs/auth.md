# Authentication

`Auth` manages sign-in, sign-out and sessions through the backend. It remains independent of the wallet.

## Local setup

Start the backend and its database. Use **localhost** for both services:

- Backend: `http://localhost:3000`.
- Frontend: `http://localhost:5173`, allowed in the backend's `CORS_ORIGINS`.

Prepare the test accounts from the **backend**:

```sh
pnpm db:migrate
pnpm db:seed
```

The credentials are in the backend README.

From the **frontend** (preserve an existing `.env`):

```sh
cp .env.example .env
pnpm dev
```

`BACKEND_URL` in `.env` sets the URL called directly for `/auth/*` and `/wallet` (required; no default). `src/lib/env.ts` uses `envsafe` to validate required public environment variables and throws when they are missing or invalid. The browser sends the frontend origin; the backend must allow it in `CORS_ORIGINS`. Restart Vite after changes and rebuild for production. This URL is public.

## API

[OpenAPI documentation](http://localhost:3000/ui)

| Action          | Endpoint                                      | Result                                         |
|-----------------|-----------------------------------------------|------------------------------------------------|
| Sign in         | `POST /auth/login` with `{ email, password }` | `200`: user; `401`: refused                    |
| Restore session | `GET /auth/me`                                | `200`: user; `401`: missing or expired session |
| Sign out        | `POST /auth/logout`                           | `204`: session revoked, cookie cleared         |

The user is returned as `{ user: { id, email, displayName } }`.

## Session

- The `session` cookie is **HttpOnly**, **SameSite=Lax**, and valid for **24 hours** without renewal. Requests use `credentials: 'include'`.
- The session is restored on mount, when returning to the page, and every minute while the page is visible with an active session.
- Expiration clears the local user and offers sign-in again. Network or server errors display a message; failed sign-out can be retried.
- The password field is cleared on submission. The frontend writes no credentials or tokens to browser storage.

The session does not authorize blockchain spending.

## Integration

```svelte
<script lang="ts">
  import { Auth, type AuthSession } from '$lib/auth'

  let session = $state<AuthSession | null>(null)
</script>

<Auth onSessionChange={(next) => { session = next }} />
```

The callback receives the public user or `null`. Unmounting the component stops its requests and sends `null`, without revoking the server session.

The `createAuth()` client exposes `subscribe`, `restore()`, `connect(email, password)`, `disconnect()`, `expire()` and `destroy()`.

The optional `children(session, expireSession)` snippet displays the signed-in flow instead of the introduction. `App.svelte` assembles the [API-connected wallet](wallet.md), with a separate instance per user. `Auth` stays mounted to handle sign-out and expiration. A wallet `401` calls `expireSession()` and immediately clears the user and local metadata.

## Verification

```sh
pnpm exec tsc --ignoreConfig \
  src/lib/auth/auth.ts src/lib/auth/auth.test.ts \
  --outDir node_modules/.tmp/auth-tests \
  --module nodenext --target es2023 --skipLibCheck

BACKEND_URL=http://localhost:3000 node --test "$PWD/node_modules/.tmp/auth-tests/auth/auth.test.js"

pnpm check
pnpm build
```

Only tests replace `fetch`; the application uses the backend.

In the browser, verify:

- Refusal, sign-in, restoration after reload, then sign-out.
- Revocation in another tab, detected on return or during the periodic check.
- Keyboard access, mobile layout and network errors.

## Production

Set `BACKEND_URL` before building. Serve the frontend and backend over **HTTPS** on the same site to retain SameSite=Lax cookies, and allow the frontend origin in `CORS_ORIGINS`.

## History

Temporary stubs `simulation.ts` and `simulation.test.ts` from [HS-27](https://projects.dotshark.dev/hackatons/task/HS-27/construire-la-connexion-swissquote-et-ses-erreurs-ct-fronten), pending backend authentication, were replaced by the HTTP client and its tests.

The [integration guide](integration.md) documents the common launch procedure, CORS/cookies, tests and the comparison with Kaneo tickets.
