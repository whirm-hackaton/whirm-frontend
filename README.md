# Whirm Frontend

Web frontend for Whirm: login, logout and session handling connected to the backend through a session cookie, with a Bitwarden passkey setup journey and Coinbase Smart Account preparation on Base Sepolia. Passkey settings stay on the client; the API registers only the address and chain as an unverified candidate.

Built with **Svelte 5**, **TypeScript**, **Vite**, **Tailwind CSS 4** and **shadcn-svelte**.

## Getting started

- Node.js 24 and pnpm.
- Backend running at `http://localhost:3000`, with its database ready.
- Backend `CORS_ORIGINS` allowing `http://localhost:5173`.

### Quick start

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Configure the public backend, wallet origin, RP ID and Base Sepolia RPC values shown in `.env.example` (required; no defaults), then open [localhost:5173](http://localhost:5173). Auth and wallet requests go directly to that URL, with session cookies. Restart Vite after changing `.env`; rebuild for production. The backend URL is public in the browser bundle.

Optional public `BUNDLER_URL` connects directly to Pimlico for prefunded Base Sepolia operations; blank disables transfers. The example uses its keyless public endpoint. Never expose a private service key in frontend configuration. See [network and bundler configuration](docs/network.md).

For local test accounts, run the backend migrations and seeder as described in [Authentication](docs/auth.md).

## Commands

| Command                          | Purpose                                |
|----------------------------------|----------------------------------------|
| `pnpm install --frozen-lockfile` | Install dependencies from the lockfile |
| `pnpm dev`                       | Start the development server           |
| `pnpm check`                     | Check Svelte and TypeScript            |
| `pnpm build`                     | Build for production into `dist/`      |
| `pnpm preview`                   | Preview the production build locally   |

## Project structure

```text
src/App.svelte          Application entry component
src/lib/env.ts         Public environment parser and validation
src/lib/auth/          Authentication UI, client and tests
src/lib/wallet/        Passkey wallet UI, adapter, API client and tests
src/lib/components/ui/ Shared UI components
src/app.css            Global styles and theme
docs/                  Detailed documentation
```

## Documentation

[Dokploy deployment](docs/dokploy.md) describes the Dockerfile build, public build arguments, HTTPS domains and production session checks for `app.whirm.dev`.

[Authentication](docs/auth.md) covers backend setup, session handling, tests and deployment requirements. For production, set `BACKEND_URL` before building, use HTTPS for both services, and keep them on the same site for SameSite=Lax cookies. Allow the frontend origin in backend `CORS_ORIGINS`.

[Passkey wallets](docs/wallet.md) covers vault preparation, deterministic account settings, the address-only API contract, retries and validation limits. The passkey is created in the selected provider; no account is deployed by this flow.

[API integration](docs/integration.md) provides the common launch procedure, cookie/CORS configuration and test commands.
