# AGENTS.md

Instructions for AI coding agents (Claude Code, Cursor, Codex, etc.) working in this repo.

## Project

GIS Converter — a dashboard app for converting various GIS file formats (Shapefile, KML,
GPX, GML, ...) to GeoJSON. TypeScript end to end, single Node.js app for both frontend and
backend.

## Stack

- **Framework**: TanStack Start (React 19 + TanStack Router, file-based routing, SSR via
  Nitro/Vite). Server functions and API routes live alongside the UI in the same app — there
  is no separate backend service.
- **Data/UI**: TanStack Query, Tailwind CSS v4, shadcn/ui (`components.json` configured, style
  "new-york"), lucide-react icons.
- **Language**: TypeScript, strict mode on (`tsconfig.json`).
- **Linting**: [oxlint](https://oxc.rs/docs/guide/usage/linter.html) — config in
  `.oxlintrc.json`. Do **not** add ESLint/Prettier config; this repo intentionally does not
  use them.
- **Formatting**: [oxfmt](https://oxc.rs/) — config in `.oxfmtrc.json`.

## Commands

Run with `npm run <script>`:

| Script            | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `dev`             | Start the dev server on port 3000                               |
| `build`           | Production build                                                |
| `preview`         | Preview a production build                                      |
| `generate-routes` | Regenerate `src/routeTree.gen.ts`                               |
| `lint`            | Run oxlint                                                      |
| `lint:fix`        | Run oxlint with autofix                                         |
| `format`          | Format the repo with oxfmt                                      |
| `format:check`    | Check formatting without writing                                |
| `typecheck`       | `tsc --noEmit`                                                  |
| `check`           | lint + format:check + typecheck (run before finishing any task) |

Always run `npm run check` before considering a change complete. Fix everything it reports;
don't leave lint/format/type errors for the user to clean up.

### Docker / deployment

A `Dockerfile` (multi-stage: deps → build → slim runtime, non-root user) and `Makefile` wrap
the same build. Run `make help` for the full list; the main ones are `make image` (build),
`make run` (build + run on port 3000, override with `PORT=`), `make logs`, `make stop`, and
`make push` (defaults to the `dockerrepo.softdesign.dk:5000` registry, override with
`REGISTRY=...`). The runtime stage doesn't need `node_modules` — Nitro's
`.output/` is already self-contained.

## Conventions

- File-based routing: routes live in `src/routes`. `src/routes/__root.tsx` is the root
  document/layout; `src/routeTree.gen.ts` is generated — never hand-edit it (it's gitignored
  from linting/formatting).
- Path aliases `#/*` and `@/*` both resolve to `src/*` (see `tsconfig.json`).
- New shadcn components: `npx shadcn@latest add <component>` (not `pnpm dlx` — this repo uses
  npm).
- Prefer server functions / API routes co-located under `src/routes` over a separate backend
  process — the whole point of TanStack Start here is one deployable app.
- Keep boilerplate lean: don't add abstractions, config files, or dependencies beyond what a
  task actually needs.

## Git

- This repo has no remote yet. Commit locally as normal; don't push or add a remote unless
  asked.
- Don't commit `node_modules`, `.output`, `.nitro`, `.tanstack`, or other generated
  directories (see `.gitignore`).
