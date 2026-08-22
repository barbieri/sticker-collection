# Implementation Plan

## Goal
Ship a production-ready static sticker collection app with spec-driven albums, reliable sharing, i18n, and practical paper workflows, while keeping output static at `dist/<spec-id>/<locale>/`.

## Current Repository State
- Architecture:
  - Plain HTML templates (`templates/*.hbs`) + TypeScript runtime (`src/main.ts`)
  - Bundled with esbuild (`scripts/build.mjs`)
  - No server runtime required for production
- Static output:
  - Per spec/locale pages generated in `dist/<spec-id>/<locale>/`
  - Root index generated from `templates/root-index.hbs`
- Data contracts:
  - Schema in `schemas/specs.json`
  - Instances in `specs/*.json`
  - Build runs spec validation via Ajv before generating assets/pages
- i18n:
  - Runtime strings sourced from `src/i18n/messages.ts`
  - Localized spec payload generated per locale at build time
  - Name fallback behavior supported by runtime/spec service (`locale -> en-US`)
- Persistence:
  - LocalStorage-backed collections by `(spec, albumName)`
  - Config persistence per spec
- Sharing and print:
  - Compact payload codec (`src/services/codec.ts`) using typed arrays + gzip + base64url
  - Missing/duplicates exchange payloads (`src/services/share-service.ts`)
  - Exchange receive/sendback routes and review screens implemented in runtime
  - Deterministic print view with owned/completed visual treatment and counters
- Quality:
  - Unit tests (Vitest) for codec, share service, storage, spec service, sticker-code normalization
  - E2E tests (Playwright) for album/search/duplicates/share flows
  - QA command: `pnpm run qa` (`typecheck + biome + coverage + e2e + build`)

## Completed Milestones
- Migrated app away from Lit component rendering to static template + DOM-driven runtime.
- Implemented multi-spec + multi-locale static generation pipeline.
- Implemented compact state exchange format and round-trip decoding.
- Implemented core album, duplicates, search, share, and config tabs with persisted state.
- Implemented the print-oriented collection view and export action.
- Added automated validation and quality gates in scripts.

## Remaining Work
1. Runtime hardening and cleanup
- Add/expand edge-case guards for malformed shared payloads and unsupported browser compression APIs.
- Review and remove leftover unused dependencies from migration (if any).
- Add compatibility notes/fallback strategy where browser APIs are missing.

2. Test expansion
- Add focused tests for exchange conflict edge-cases and cross-locale route behavior.
- Expand regression coverage for print and exchange workflows.

## Acceptance Criteria
- `pnpm run validate:specs` passes.
- `pnpm run qa` passes.
- `pnpm run build` emits valid static output for all specs/locales.
- Specs remain schema-valid with schema/instance split preserved.
- Exchange payloads round-trip without data loss.
- Runtime localization uses message catalog + locale fallback rules.
