# Local setup and verification

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

The backend uses pnpm 11.28.5. Its `.env` must allow `CORS_ORIGINS=http://localhost:5173` and use `NODE_ENV=development` for local HTTP. Run migrations after backend schema changes; a working login alone does not mean the wallet tables exist.

In `whirm-frontend`, in a second terminal (preserve an existing `.env`):

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open `http://localhost:5173`. API: `http://localhost:3000`; PostgreSQL: port `5433`. Use `localhost` consistently. Demo accounts: `alice@example.test` and `bob@example.test`, password `Hackaton2026!`. The seeder is idempotent and disabled in production.

Set `BACKEND_URL` in the frontend `.env` (required; no default). Auth and wallet requests go directly to this URL with `credentials: 'include'`. The backend must allow the frontend origin in credentialed CORS and accepts POST requests only from approved origins. Restart Vite after changing `.env`, and rebuild for production. The public wallet origin, RP ID and Base Sepolia RPC URL in `.env.example` are also explicitly exposed to browser code. `src/lib/env.ts` uses `envsafe` to declare required variables without defaults and throws when they are missing or invalid.

The session cookie is HttpOnly, SameSite=Lax, scoped to `/`, and expires after 24 hours without renewal. Production enables Secure cookies. The frontend restores `/auth/me` on mount, on focus/visibility changes, and every minute while visible and signed in. Wallet `401` responses expire auth immediately.

## API contracts

See [Authentication](auth.md#api), [Wallet creation](wallet.md#api-contract) and the backend [OpenAPI UI](http://localhost:3000/ui).

## Verification

For optional direct Pimlico access, see [network configuration](network.md). `BUNDLER_URL` defaults to blank so auth/passkey tests remain independent of the bundler. Banking session cookies apply only to the banking API; Pimlico requests omit credentials.

No additional test dependency is needed. Set these public values before running the full Node test suite (Vite loads `.env` automatically):

```sh
export BACKEND_URL=http://localhost:3000
export WALLET_ORIGIN=http://localhost:5173
export WALLET_RP_ID=localhost
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export BUNDLER_URL=https://public.pimlico.io/v2/84532/rpc
pnpm exec tsc --ignoreConfig \
  src/lib/env.test.ts src/lib/auth/auth.test.ts src/lib/wallet/*.test.ts \
  --outDir node_modules/.tmp/integration-tests \
  --module nodenext --target es2023 --skipLibCheck
node --test "$PWD/node_modules/.tmp/integration-tests/**/*.test.js"
pnpm check
pnpm build
```

Tests simulate browser credentials and service responses. Real Bitwarden creation, cancellation, device synchronization and a funded Base Sepolia transfer require separate browser acceptance checks.

## Production and preview

HS-42 uses the address-only GET /wallet contract and frontend recovery from an existing discoverable passkey. No passkey metadata or association-proof endpoint is required from the API. See [Recover the same wallet](passkey-reopening.md) for the recovery algorithm and real-provider validation limits.

Set `BACKEND_URL` before building. Serve both services over HTTPS on the same site (for example, `app.example.com` and `api.example.com`) for SameSite=Lax cookies. List the public frontend origin in backend `CORS_ORIGINS`, and set `NODE_ENV=production` for Secure cookies. The backend URL is public in the static bundle.

`pnpm preview` serves the built bundle on port 4173, using the `BACKEND_URL` from the build. Add `http://localhost:4173` to the comma-separated backend `CORS_ORIGINS` and restart the backend before testing preview. Preview is a local check, not production hosting.
