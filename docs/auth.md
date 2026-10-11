# Authentication

`Auth` manages sign-in, sign-out and sessions through the backend. It remains independent of the wallet.

## Create an account

Select **New to Whirm? Sign up**, enter a display name (1–150 characters after trimming), a valid email (up to 255 characters), and a password of **8–1024 characters**. The backend does not require uppercase letters, numbers or symbols. The form displays these requirements, uses new-password autofill and clears the password after submission or changing modes.

`POST /auth/signup` receives `{ email, password, displayName }`, returns **201** with `{ user }` and sets the session cookie. The frontend immediately opens the signed-in wallet journey. Email is trimmed/lowercased and name is trimmed; the password is never trimmed. An existing email (409), invalid details (400), forbidden origin and service/network errors produce messages without authenticating. This creates a bank application account; the personal Bitwarden vault and its master password are created separately.

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
| Sign up         | `POST /auth/signup` with `{ email, password, displayName }` | `201`: user and session; `400`: invalid; `409`: email exists |
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

Run the [integration test commands](integration.md#verification). Only tests replace `fetch`; the application uses the backend.

In the browser, verify:

- Refusal, sign-in, restoration after reload, then sign-out.
- Revocation in another tab, detected on return or during the periodic check.
- Keyboard access, mobile layout and network errors.

## Production

Set `BACKEND_URL` before building. Serve the frontend and backend over **HTTPS** on the same site to retain SameSite=Lax cookies, and allow the frontend origin in `CORS_ORIGINS`.
