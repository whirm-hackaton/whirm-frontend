# Common API integration (HS-36)

The frontend uses the existing Hono/PostgreSQL API in `whirm-backend` for identity and wallet metadata. The remaining simulation is public address generation; no key pair, passkey secret, deployment or ownership proof is produced. New associations remain `candidate` with `verifiedAt: null`.

## Reproducible local setup

Use Node.js 24, pnpm and Docker Compose. In `whirm-backend`:

```sh
pnpm install --frozen-lockfile
# On first setup only; preserve an existing .env.
cp .env.example .env
docker compose up -d --wait db
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The backend uses pnpm 11.28.5. Its `.env` must allow `CORS_ORIGINS=http://localhost:5173` and use `NODE_ENV=development` for local HTTP. Run migrations after pulling HS-34; a working login alone does not mean the wallet tables exist.

In `whirm-frontend`, in a second terminal:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173`. API: `http://localhost:3000`; PostgreSQL: port `5433`. Use `localhost` consistently. Demo accounts: `alice@example.test` and `bob@example.test`, password `Hackaton2026!`. The seeder is idempotent and disabled in production.

Vite proxies `/auth` and `/wallets` to port 3000, retaining the browser's `Origin`. Requests use `credentials: 'include'`. The API rejects POST requests from unapproved origins. Its credentialed CORS preflight can be inspected directly on port 3000; Vite handles its own preflights on port 5173.

The session cookie is HttpOnly, SameSite=Lax, scoped to `/`, and expires after 24 hours without renewal. Production enables Secure cookies. The frontend restores `/auth/me` on mount, on focus/visibility changes, and every minute while visible and signed in. Wallet `401` responses expire auth immediately.

## API contract

See the backend [OpenAPI UI](http://localhost:3000/ui) or `/doc`.

| Action | Request | Success | Handled failures |
| --- | --- | --- | --- |
| Sign in | `POST /auth/login`, `{ email, password }` | `200`, `{ user }`, session cookie | `400`, `401`, `403`, server/network errors |
| Restore identity | `GET /auth/me` | `200`, `{ user }` | `401`, server/network errors |
| Sign out | `POST /auth/logout` | `204`, session revoked and cookie cleared | Failed logout retains the local session for retry |
| Restore wallets | `GET /wallets` | `200`, `{ wallets }` for the session's user | `401`, invalid payload, server/network errors |
| Register candidate | `POST /wallets`, `{ address, chainId: 84532 }` | `201` new / `200` repeated, `{ wallet }` | `400`, `401`, `403`, `409`, invalid payload, server/network errors |

Metadata uses `id`, `userId`, `address`, `chainId`, `status`, `createdAt`, `verifiedAt`. The frontend never sends user identity in a wallet request or promotes an association to verified.

## Verification

No additional test dependency is needed:

```sh
pnpm exec tsc --ignoreConfig \
  src/lib/auth/auth.ts src/lib/auth/auth.test.ts \
  src/lib/wallet/wallet.ts src/lib/wallet/wallet.test.ts \
  --outDir node_modules/.tmp/integration-tests \
  --module nodenext --target es2023 --skipLibCheck
node --test "$PWD/node_modules/.tmp/integration-tests/auth/auth.test.js"
node --test "$PWD/node_modules/.tmp/integration-tests/wallet/wallet.test.js"
pnpm check
pnpm build
```

The 17 frontend tests cover auth restoration/refusal/logout, wallet persistence, candidate payloads, conflicts, network/server errors, invalid or foreign metadata, expiration, duplicate requests, cancellation, idempotent retry and late responses after unmount. Only tests replace `fetch`.

Verified locally on 10 October 2026:

- Frontend tests: 17 passed; Svelte/TypeScript: zero errors or warnings; production build passed.
- Existing backend tests: 29 passed, including PostgreSQL tests in isolated schemas.
- Browser: incorrect password, Alice sign-in, candidate registration from keyboard, metadata restoration after reload, sign-out, Bob isolation, and immediate expiration after logout in another tab.
- Responsive layout: 390 px mobile without horizontal overflow, and 1280 px desktop.
- HTTP through Vite: candidate idempotency, foreign-wallet `404`, address conflict `409`, invalid chain `400`, forbidden origin `403`, cookie flags and logout revocation. Credentialed CORS checked directly on the API.
- Wallet service unavailability was observed before applying the HS-34 migrations, then recovered via **Refresh wallets**.

Collective team sign-off and production deployment have not been performed.

## Branch and Kaneo scope

Compared `feat/swissquote-auth` with `origin/main`, including the uncommitted HS-36 changes. Kaneo's signed-in account is **Slain**, confirmed by the user. Its accessible workspace contains one project, Hackaton SwissQuote. All four assigned In Progress tickets were checked; task and related metadata pagination each have one page.

| Ticket | Evidence in the branch | Scope assessment |
| --- | --- | --- |
| HS-5 | `App.svelte`, auth/wallet modules, shared styles/configuration; connected login → registration → display | Functional journey covered. Original autonomous fixture-only acceptance criteria are superseded by HS-36; the final application requires the API. |
| HS-26 | Wallet UI/client/tests, navigation through the auth snippet; loading, errors and cancellation | Wallet journey covered. Local-only metadata simulation is replaced by persisted API metadata under HS-36. |
| HS-27 | Auth UI/client/tests, refused/expired/loading states, logout and session callback | Auth journey covered. Local auth fixtures are replaced by the existing API client. |
| HS-36 | `/wallets` proxy/client, persisted metadata restoration, auth expiration callback, tests and launch/cookie/CORS documentation | Technical implementation and local connected journey validated; collective team acceptance remains outstanding. |

The parent/subtask descriptions still mention Pierre as wallet owner even though Kaneo now assigns these tickets to Slain. Their original simulation-only wording does not exactly match the final branch. No ticket descriptions, assignees or statuses were changed during this verification.

HS-34 is Done. HS-8 and HS-33 are In Review. The HS-3 and HS-35 dependency references did not resolve through Kaneo's ticket lookup. These planning/review discrepancies need team reconciliation; they do not prevent the implemented routes from being exercised locally.

## Production and preview

Serve the frontend over HTTPS and reverse-proxy `/auth` and `/wallets` to the common backend on the same origin, retaining `Origin`. List the public frontend origin in backend `CORS_ORIGINS`, and set `NODE_ENV=production` for Secure cookies. The static production bundle does not include a proxy; configure one in hosting.

`pnpm preview` inherits Vite's API proxy but uses port 4173. Add `http://localhost:4173` to the comma-separated backend `CORS_ORIGINS` and restart the backend before testing preview. Preview is a local check, not production hosting. Vite documents this inheritance in its [preview proxy options](https://vite.dev/config/preview-options.html#preview-proxy).
