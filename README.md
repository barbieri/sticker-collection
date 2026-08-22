# Sticker Collection

Static web app to manage sticker albums with spec-driven content.

## Stack
- TypeScript
- Lit
- esbuild
- Handlebars templates
- Ajv for spec validation
- Biome for lint/format
- pnpm + Husky

## Core Concepts
- Specs for each Sticker Collection live in `specs/*.json`.
- JSON Schema lives in `schemas/*.json`.
- Data model: `Sections > Groups > Items`.
- Names can be localized object or plain string.
- Localized objects must include `en-US`.
- Build output layout: `dist/<spec-id>/<locale>/`.
- Root `dist/index.html`:
  - one spec: auto-redirect to locale path
  - multiple specs: list specs for selection
- Each spec/locale output includes a compiled `service-worker.js`.
  - Source lives in `src/service-worker.ts` and is compiled by esbuild during `pnpm run build`.
  - The worker is copied to `dist/<spec-id>/<locale>/service-worker.js` so its scope is limited to that installed spec/locale app.
  - Its role is to make the static app reliably launch offline after installation by serving the cached app shell, manifest, and icon assets from Cache Storage.
  - HTTP cache headers alone are host/browser-managed and best-effort; the worker gives the app explicit control over offline navigation fallback and cache version cleanup.
  - The worker derives its cache name from its own URL path, so the same compiled file can be reused for every spec/locale.

## Commands
- `pnpm run validate:specs` validate `specs/*.json` with Ajv + JSON Schema
- `pnpm run build` validate specs and generate static output
- `pnpm run serve` serve `dist/` on port `4173`
- `pnpm run dev` build then serve
- `pnpm run typecheck` run TypeScript checks
- `pnpm run check` run Biome checks
- `pnpm run qa` run `typecheck + check + build`
