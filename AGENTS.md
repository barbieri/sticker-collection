# AGENTS Guide

This file is for coding agents continuing work in this repository.

## Mission
Implement a static, spec-driven sticker collection app with robust sharing, i18n, and paper workflows.

## Non-Negotiables
- Keep app static (no server-side runtime required for production hosting).
- Keep output at `dist/<spec-id>/<locale>/`.
- Keep schema and instances separated:
  - Schema: `schemas/*.json`
  - Instances: `specs/*.json`
- Validate specs before build using Ajv.
- Use `pnpm run <script>` and `pnpm exec <bin>` explicitly.

## Coding/Tooling Rules
- Package manager: `pnpm`.
- TypeScript config extends `@tsconfig/strictest`.
- QA baseline: `pnpm run qa`.
- Do not reintroduce Vite or React.
- Prefer minimal dependencies.
- If adding a package triggers `pnpm approve-builds`, pause and ask the user to review and approve the build scripts; do not reject them automatically.

## Data Contracts
- Spec shape: `branding + sections[]`.
- Nesting: `Section -> Group -> Item`.
- Name field is union:
  - `string` (untranslated)
  - `Record<locale,string>` (translated; must include `en-US`)
- ID normalization behavior expected by product:
  - `MEX1`, `MEX-1`, `MEX-01` => same sticker code.

## Runtime Behavior Expectations
- Renderer must support translated and untranslated names.
- Fallback order for localized names:
  1. current locale
  2. `en-US` (required)
- All user-facing runtime strings (including alerts/errors/placeholders/button labels) must come from `src/i18n/messages.ts` and locale payloads; do not hardcode locale-specific strings in runtime code. Use `t(translationId)` to resolve the string.
- Compact exchange links use typed arrays + compression + base64url.

## Session Start Checklist
1. `pnpm install`
2. `pnpm run validate:specs`
3. `pnpm run qa`
4. Review `PLAN.md` before editing.

## Completion Gate
- After implementing changes and before reporting completion to the user, always run the full `pnpm run qa`.
- Do not mark work as done until `pnpm run qa` passes.
