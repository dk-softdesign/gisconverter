# GIS Converter

A single-page dashboard that converts GIS files to GeoJSON, previews them on a map and in a
table, and lets the user edit properties and validate them against a schema before
downloading. TypeScript end to end, one Node.js app for both frontend and backend.

Supported inputs: DXF, Shapefile (zipped), Excel (`.xlsx`), KML/KMZ, GeoPackage (`.gpkg`),
and existing GeoJSON (for editing and validation).

## Stack

- **Framework**: TanStack Start — React 19 + TanStack Router (file-based routing), SSR via
  Nitro. API routes live in the same app; there is no separate backend service.
- **UI**: Tailwind CSS v4, shadcn/ui (`components.json`, style "new-york"), lucide-react
  icons, Leaflet via react-leaflet for the map.
- **Toolchain**: Vite+ (`vp`) — wraps Vite, Oxlint and Oxfmt (see the section below). Lint and
  format config live in `vite.config.ts` (`lint` / `fmt`); there are no `.oxlintrc` /
  `.oxfmtrc` files. Do **not** add ESLint or Prettier.
- **Runtime**: Node 24 (`.node-version`, `engines`). Code relies on it, e.g. the built-in
  `node:sqlite` for GeoPackage.
- **Package manager**: npm.

## Commands

| Command                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `npm run dev`               | Dev server on port 3000                           |
| `npm run build`             | Production build into `.output/` (self-contained) |
| `npm run preview`           | Preview a production build                        |
| `npm run check`             | lint + format check + typecheck                   |
| `npm run lint` / `lint:fix` | Oxlint (type-aware)                               |
| `npm run format`            | Format with Oxfmt (`format:check` to only check)  |
| `npm run typecheck`         | `tsc --noEmit`                                    |
| `npm run generate-routes`   | Regenerate `src/routeTree.gen.ts`                 |

**Always run `npm run check` before considering a change complete**, and fix everything it
reports. There is no test suite yet. A pre-commit hook (`.vite-hooks/pre-commit` →
`vp staged`) runs `vp check --fix` on staged files.

Docker/deployment: a multi-stage `Dockerfile` and a `Makefile` wrap the same build. `make
help` lists targets; the main ones are `make image`, `make run` (port 3000, override with
`PORT=`), `make logs`, `make stop`, and `make push` (registry defaults to
`dockerrepo.softdesign.dk:5000`, override with `REGISTRY=`).

## Architecture

- `src/routes/index.tsx` — the whole UI: upload form, side panel, Preview (Map / List /
  Validation tabs). Every data edit goes through `commitFeatures` so it lands in the undo
  history (`src/lib/undo-history.ts`).
- `src/routes/api/convert.ts` — `POST /api/convert`; picks a converter by file extension.
  Other API routes: `detect-crs` (guesses a DXF's CRS) and `suggest-edit` (Claude-assisted
  bulk edits; needs `ANTHROPIC_API_KEY` in the server environment).
- `src/lib/*-to-geojson.ts` — one converter per format. Each returns
  `{ featureCollection, warnings }` in WGS 84, tags features with a `layer` property (drives
  the layer legend), and throws `NoGeometryError` when a source has records but no geometry —
  the UI then offers a properties-only import and retries with `allowNoGeometry`.
- `src/lib/crs.ts` — the curated list of source CRSs (Danish projections first); reprojection
  goes through proj4 in `src/lib/reproject.ts`.
- `src/lib/settings.ts` — user settings (theme, defaults, export options); `useSettings()` /
  `useUpdateSettings()`. Like bulk-edit presets and Match property names progress, they're
  stored per member on the server (`user_data` table, `src/lib/user-data.ts`), not in the
  browser — keep new per-user state there too. Settings and presets arrive with the page via
  the auth query, so the theme is applied server-side without a flash.

### Login and members

The whole app requires login. Roles: `admin` (can manage members) and `member`.

- `src/start.ts` — global request middleware: pages without a session redirect to `/login`
  (or `/setup` until the first admin exists), `/api/*` returns 401; `/api/health` is public.
  It also re-adds TanStack Start's CSRF check, which defining `createStart` would otherwise
  drop — keep it when editing this file.
- `src/lib/auth-functions.ts` — server functions for login, setup, invites and member
  maintenance. Server functions bypass the page middleware, so each one checks access itself
  (`requireUser` / `requireAdmin` middleware) — do the same for any new server function.
- `src/lib/server/` — server-only: SQLite (`db.ts`, `node:sqlite`, schema created on start)
  and `auth.ts` (scrypt password hashes, session and invite tokens stored only as SHA-256
  hashes). Import it lazily from server code (`await import(...)`) so it stays out of the
  client bundle.
- Pages: `/login`, `/setup`, `/invite/$token` (invite and password-reset links), `/members`.
  New members get a one-time link from an admin; there is no email sending.
- Database location: `DATABASE_PATH` (default `data/gisconverter.db`, gitignored). In Docker
  it's `/app/data`; on the swarm that's the `sdnas` NFS volume (see `docker-compose.yml`), so
  it survives redeploys on any node. Because it can sit on NFS, SQLite runs with a rollback
  journal (not WAL) and deploys are `stop-first` — keep both.

## Conventions

- Only run one dev server per checkout: each regenerates `src/routeTree.gen.ts`, and two of
  them fight over it in an endless reload loop.

- Routes live in `src/routes`; `__root.tsx` is the root document. `src/routeTree.gen.ts` is
  generated — never edit it by hand.
- Path aliases `#/*` and `@/*` both resolve to `src/*`; the codebase uses `#/`.
- Add shadcn components with `npx shadcn@latest add <component>`.
- Keep it lean: no new abstractions, config files or dependencies beyond what a task needs.
- User-facing changes get an entry in `CHANGELOG.md` (newest date first, plain language, "Added"
  / "Changed" / "Fixed"). It's bundled into the app and shown by the header's Changelog button.
- `wkx` has hand-written types in `src/types/wkx.d.ts`; a TypeScript 7 checker bug means
  callers must cast the result of `Geometry.parse()` (see the comment there).

## Git

- Remote: `origin` (GitHub, `dk-softdesign/gisconverter`), working directly on `main`. Push only
  when asked.
- Don't commit generated directories (`node_modules`, `.output`, `.nitro`, `.tanstack`, …).

<!-- Everything between the markers below is managed by Vite+ (`vp config`, run on
     `npm install`) and gets overwritten — put project guidance above, not inside. -->

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
