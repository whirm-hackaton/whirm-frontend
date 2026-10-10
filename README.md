# Whirm Frontend

Web frontend for Whirm: login, logout and session handling connected to the backend through a session cookie, with candidate wallet registration and persisted metadata from the common API.

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

Set `BACKEND_URL` in `.env` to the backend URL (required; no default), then open [localhost:5173](http://localhost:5173). Auth and wallet requests go directly to that URL, with session cookies. Restart Vite after changing `.env`; rebuild for production. The backend URL is public in the browser bundle.

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
src/lib/wallet/        Wallet metadata UI, API client and tests
src/lib/components/ui/ Shared UI components
src/app.css            Global styles and theme
docs/                  Detailed documentation
```

## Documentation

[Authentication](docs/auth.md) covers backend setup, session handling, tests and deployment requirements. For production, set `BACKEND_URL` before building, use HTTPS for both services, and keep them on the same site for SameSite=Lax cookies. Allow the frontend origin in backend `CORS_ORIGINS`.

[Wallet metadata](docs/wallet.md) covers candidate registration, persisted metadata, cancellation and errors. No real wallet is deployed and no keys are generated.

[API integration](docs/integration.md) provides the common launch procedure, cookie/CORS configuration, validation results and comparison with the assigned Kaneo tickets.
