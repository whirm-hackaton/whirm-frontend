# Common API integration (HS-36)

The frontend uses the existing Hono/PostgreSQL API in `whirm-backend` for identity and wallet metadata. HS-41 creates a P-256 passkey on the client and prepares the Coinbase account locally. As specified by HS-34/HS-41, only address and chain are sent to PUT /wallet; public passkey settings remain on the client. New associations remain `candidate` with `verifiedAt: null`. No account deployment or backend ownership proof occurs in this flow.

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

In `whirm-frontend`, in a second terminal (preserve an existing `.env`):

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open `http://localhost:5173`. API: `http://localhost:3000`; PostgreSQL: port `5433`. Use `localhost` consistently. Demo accounts: `alice@example.test` and `bob@example.test`, password `Hackaton2026!`. The seeder is idempotent and disabled in production.

Set `BACKEND_URL` in the frontend `.env` (required; no default). Auth and wallet requests go directly to this URL with `credentials: 'include'`. The backend must allow the frontend origin in credentialed CORS and accepts POST requests only from approved origins. Restart Vite after changing `.env`, and rebuild for production. The public wallet origin, RP ID and Base Sepolia RPC URL in `.env.example` are also explicitly exposed to browser code. `src/lib/env.ts` uses `envsafe` to declare required variables without defaults and throws when they are missing or invalid. Add future public variables to its schema as needed.

The session cookie is HttpOnly, SameSite=Lax, scoped to `/`, and expires after 24 hours without renewal. Production enables Secure cookies. The frontend restores `/auth/me` on mount, on focus/visibility changes, and every minute while visible and signed in. Wallet `401` responses expire auth immediately.

## API contract

See the backend [OpenAPI UI](http://localhost:3000/ui) or `/doc`.

| Action | Request | Success | Handled failures |
| --- | --- | --- | --- |
| Sign in | `POST /auth/login`, `{ email, password }` | `200`, `{ user }`, session cookie | `400`, `401`, `403`, server/network errors |
| Restore identity | `GET /auth/me` | `200`, `{ user }` | `401`, server/network errors |
| Sign out | `POST /auth/logout` | `204`, session revoked and cookie cleared | Failed logout retains the local session for retry |
| Restore wallet | `GET /wallet` | `200`, `{ wallet }` for the session's user; `404` if absent | `401`, invalid payload, server/network errors |
| Register candidate | `PUT /wallet`, `{ address, chainId: 84532 }` | `201` new / `200` repeated, `{ wallet }` | `400`, `401`, `403`, `409`, invalid payload, server/network errors |

Metadata uses `id`, `userId`, `address`, `chainId`, `status`, `createdAt`, `verifiedAt`. The frontend never sends user identity in a wallet request or promotes an association to verified.

The API permits one wallet per user. A `GET /wallet` response with status `404` enables the creation confirmation; other failures keep creation blocked. The frontend retains credential ID, public key and SDK settings locally and validates the API response against its prepared address and chain.

## Verification

No additional test dependency is needed. Export the four public values from `.env` before running Node tests (Vite loads them automatically). For localhost:

```sh
export BACKEND_URL=http://localhost:3000
export WALLET_ORIGIN=http://localhost:5173
export WALLET_RP_ID=localhost
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
pnpm exec tsc --ignoreConfig \
  src/lib/env.ts src/lib/env.test.ts \
  src/lib/auth/auth.ts src/lib/auth/auth.test.ts \
  src/lib/wallet/wallet.ts src/lib/wallet/wallet.test.ts \
  src/lib/wallet/passkey.ts src/lib/wallet/passkey.test.ts \
  src/lib/wallet/assertion.ts src/lib/wallet/assertion.test.ts \
  src/lib/wallet/reopen.test.ts src/lib/wallet/recovery.test.ts \
  --outDir node_modules/.tmp/integration-tests \
  --module nodenext --target es2023 --skipLibCheck
BACKEND_URL=http://localhost:3000 node --test "$PWD/node_modules/.tmp/integration-tests/env.test.js"
BACKEND_URL=http://localhost:3000 node --test "$PWD/node_modules/.tmp/integration-tests/auth/auth.test.js"
node --test "$PWD"/node_modules/.tmp/integration-tests/wallet/*.test.js
pnpm check
pnpm build
```

The earlier HS-36 suite covered auth restoration/refusal/logout, wallet persistence, candidate payloads, conflicts, network/server errors, invalid or foreign metadata, expiration, duplicate requests, cancellation, idempotent retry and late responses after unmount. Only tests replace `fetch`.

Verified locally on 10 October 2026, before switching from the Vite proxy to direct requests:

- Frontend tests: 17 passed; Svelte/TypeScript: zero errors or warnings; production build passed.
- Existing backend tests: 29 passed, including PostgreSQL tests in isolated schemas.
- Browser: incorrect password, Alice sign-in, candidate registration from keyboard, metadata restoration after reload, sign-out, Bob isolation, and immediate expiration after logout in another tab.
- Responsive layout: 390 px mobile without horizontal overflow, and 1280 px desktop.
- HTTP through Vite: candidate idempotency, foreign-wallet `404`, address conflict `409`, invalid chain `400`, forbidden origin `403`, cookie flags and logout revocation. Credentialed CORS checked directly on the API.
- Wallet service unavailability was observed before applying the HS-34 migrations, then recovered via **Refresh wallets**.

Collective team sign-off and production deployment have not been performed.

## Branch and Kaneo scope

Compared `feat/swissquote-auth` with `origin/main`, including the uncommitted HS-36 changes. Kaneo's signed-in account is **Slain**, confirmed by the user. Its accessible workspace contains one project, Hackaton SwissQuote. All four assigned In Progress tickets were checked; task and related metadata pagination each have one page.

| Ticket | Evidence in the branch                                                                                                       | Scope assessment                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| HS-5   | `App.svelte`, auth/wallet modules, shared styles/configuration; connected login → registration → display                     | Functional journey covered. Original autonomous fixture-only acceptance criteria are superseded by HS-36; the final application requires the API. |
| HS-26  | Wallet UI/client/tests, navigation through the auth snippet; loading, errors and cancellation                                | Wallet journey covered. Local-only metadata simulation is replaced by persisted API metadata under HS-36.                                         |
| HS-27  | Auth UI/client/tests, refused/expired/loading states, logout and session callback                                            | Auth journey covered. Local auth fixtures are replaced by the existing API client.                                                                |
| HS-36  | `/wallet` proxy/client, persisted metadata restoration, auth expiration callback, tests and launch/cookie/CORS documentation | Technical implementation and local connected journey validated; collective team acceptance remains outstanding.                                   |

The parent/subtask descriptions still mention Pierre as wallet owner even though Kaneo now assigns these tickets to Slain. Their original simulation-only wording does not exactly match the final branch. No ticket descriptions, assignees or statuses were changed during this verification.

HS-34 is Done. HS-8 and HS-33 are In Review. The HS-3 and HS-35 dependency references did not resolve through Kaneo's ticket lookup. These planning/review discrepancies need team reconciliation; they do not prevent the implemented routes from being exercised locally.

## HS-41 validation

On 11 October 2026, the initial HS-41 implementation passed 20 frontend tests, `pnpm check` (zero errors/warnings), `pnpm build` and `git diff --check`. Those checks preceded the address-only PoC contract correction. See [Passkey wallets](wallet.md) for configuration, API contract and real-provider validation limits. Production wallet context is https://app.whirm.dev with RP ID app.whirm.dev, distinct from the vault.

The subsequent single-wallet route correction passed 22 tests, `pnpm check`, `pnpm build` and `git diff --check`. Browser checks against the local API used `hs41@example.test`: sign-in showed no registered wallet, keyboard **Create my wallet** reached the Bitwarden confirmation, and page reload restored the empty state. These checks preceded removal of passkey fields from the API payload and did not create a real passkey.

The address-only PoC correction passed 23 tests, `pnpm check`, `pnpm build` and `git diff --check`. A temporary test user exercised the corrected client against the real local API with WebAuthn/account preparation fixtures: GET `404`, PUT `201 candidate`, GET `200` with the same wallet, and repeated PUT `200` with the same ID. Browser checks confirmed the candidate stays unverified and displays without expecting passkey metadata from the API. The temporary user/wallet were removed; real Bitwarden creation remains an HS-38 check.

## Production and preview

HS-42 uses the address-only GET /wallet contract and frontend recovery from an existing discoverable passkey. No passkey metadata or association-proof endpoint is required from the API. See [Recover the same wallet](passkey-reopening.md) for the recovery algorithm and real-provider validation limits.

Set `BACKEND_URL` before building. Serve both services over HTTPS on the same site (for example, `app.example.com` and `api.example.com`) for SameSite=Lax cookies. List the public frontend origin in backend `CORS_ORIGINS`, and set `NODE_ENV=production` for Secure cookies. The backend URL is public in the static bundle.

`pnpm preview` serves the built bundle on port 4173, using the `BACKEND_URL` from the build. Add `http://localhost:4173` to the comma-separated backend `CORS_ORIGINS` and restart the backend before testing preview. Preview is a local check, not production hosting.
