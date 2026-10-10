# Repository Guidelines

## Project Structure & Module Organization

This is a Svelte 5 frontend using TypeScript, Vite, Tailwind CSS 4, and shadcn-svelte.

- `src/main.ts` mounts `src/App.svelte`; `index.html` supplies the entry page.
- `src/lib/` contains reusable components and utilities. Shared UI primitives live in `src/lib/components/ui/`, with exports in each component's `index.ts`.
- `src/app.css` defines global styles and theme tokens.
- `src/assets/` holds imported images; `public/` holds assets served directly, such as `/icons.svg`.
- Root configuration includes `vite.config.ts`, `svelte.config.js`, TypeScript configs, and `components.json` for shadcn-svelte.
- Keep detailed project documentation in the root `docs/` directory, the project overview and quick start in the root `README.md`, and repository instructions in the root `AGENTS.md`.

## Build, Test, and Development Commands

Use pnpm and keep `pnpm-lock.yaml` aligned with dependency changes.

- `pnpm install`: install dependencies.
- `pnpm dev`: start the Vite development server with hot reload.
- `pnpm check`: run Svelte diagnostics and TypeScript checks for application and build configuration.
- `pnpm build`: create the production bundle in `dist/`.
- `pnpm preview`: serve the production build locally after building.
- `pnpm exec shadcn-svelte add dialog`: add a UI component using the existing registry configuration.

## Coding Style & Naming Conventions

Match the file being edited: application code uses two-space indentation, single quotes, and no semicolons; generated UI components use tabs, double quotes, and semicolons. No formatter or lint command is configured.

Use TypeScript for new component logic (`<script lang="ts">`), Svelte 5 runes such as `$state` and `$props`, and camelCase for variables and functions. Follow existing component naming: `Counter.svelte` for application components, `button.svelte` inside UI component folders. Import shared code through `$lib`; reuse existing UI primitives and theme tokens.

Write all user-facing frontend text in English, including labels, buttons, instructions, error messages, page titles, and accessibility text. Set the document and component language to English.

## Testing Guidelines

No automated test framework, test script, or coverage threshold is configured. Run `pnpm check` and `pnpm build` before submitting changes. For UI changes, verify affected interactions, keyboard access, and responsive layout in the browser. Include verification steps in the PR.

## Commit & Pull Request Guidelines

History uses Conventional Commit prefixes, including `feat:` and `chore:`. Write a concise, imperative subject describing the change.

Keep PRs focused. Describe the resulting behavior, link relevant issues, report validation results, and include screenshots for visible UI changes. Commit dependency lockfile updates when needed; keep generated build output out of version control.
