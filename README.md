# Lantern — Nuxt migration

Lantern is an application for creating, managing, publishing, discovering, and consuming written and illustrated works. This repository is the staging migration from the original Flask application to Nuxt.

The original Flask application is the behavioral source of truth. This is a one-to-one migration: no product redesign, no new features, and no changed business rules.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Nuxt 4, Vue 3, TypeScript, CSS |
| Backend | Nuxt server routes, Nitro, server-side application utilities |
| Runtime | Cloudflare Workers, Wrangler |
| Storage | Cloudflare D1 (relational data), Cloudflare R2 (media) |
| Tests | Vitest |

Major directories:

```
app/         pages, components, composables, middleware, layouts
server/      API endpoints, server routes, server utilities
public/      static assets
migrations/  SQL reference schema and migrations
tests/       behavior/parity tests and doubles
docs/        migration documentation, route map, parity records
scripts/     verification, migration, release, and rehearsal tooling
```

## Prerequisites

- Node.js (version in `.node-version`)
- npm
- Wrangler for Cloudflare local development and staging migrations

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Starts the Nuxt development server on `http://localhost:3000`.

To exercise the built Worker locally (Cloudflare bindings, D1, R2):

```bash
npm run build
npm run preview
```

`preview` runs the built Worker through Wrangler in local mode. Binding names and database/bucket identifiers are in `wrangler.jsonc`.

## Verification

```bash
npm run verify
```

This is the single required gate and runs:

1. `npm run parity:routes` — verifies all 48 reviewed Flask routes are dispositioned with `gap=0`. This checks coverage only, not behavioral parity.
2. `npm test` — runs the Vitest parity harness against real h3 handlers with in-memory D1/R2 doubles.
3. `npm run build` — verifies the production build.

CI (`.github/workflows/verify.yml`) runs `npm run verify` only. It has no deployment step and no Cloudflare credentials.

## Tests

```bash
npm test              # single run
npm run test:watch    # watch mode
```

Current baseline: **121 tests across 15 files**, all passing. Coverage includes auth, sessions, durable rate limits, token flows, ownership, novel/chapter and comic/episode workflows, discussions, publishing, public reading, media, and staging isolation.

Parity evidence and harness design: `docs/PARITY_HARNESS.md`. Route dispositions: `docs/parity-route-map.json`. Targeted source audit: `docs/PARITY_AUDIT_20261119.md`.

## Local Worker rehearsal

The cutover smoke checklist can be rehearsed without touching any remote resource:

```bash
npm run build
npm run db:seed:local
npx wrangler dev --cwd .output --local --port 8799
# in another terminal:
npm run smoke -- http://127.0.0.1:8799
```

`db:seed:local` applies migrations to **local-only** Wrangler D1 databases and is idempotent. `smoke` runs the read-only checks from `docs/CUTOVER_RUNBOOK.md` §6. Recorded results are in `docs/REHEARSAL_RECORD.md`.

## Staging migrations

The Nuxt migration runner targets staging only. It refuses production database names.

```bash
npm run migrate:plan   # dry-run plan
npm run migrate -- --remote --database lantern_staging_db --confirm-staging-remote
```

Remote staging was reconciled and backfilled: all four migrations are tracked in `lantern_schema_migrations` with matching checksums and no DDL replay. See `docs/PRODUCTION_MIGRATION_PLAN.md` for the production plan (documented, not executed).

## Release controls

```bash
npm run release:check
```

Evaluates the machine-readable gates in `docs/release-gates.json` against gates, blockers, and a four-role sign-off (`docs/release-signoff.json`). The sign-off commit is compared to the current `git HEAD` at check time, so it always binds to the exact commit being released. It currently reports **NOT READY** because the production R2 binding, route rollback rehearsal, and explicit sign-off are outstanding.

`npm run deploy` intentionally fails closed via `scripts/deploy-guard.mjs`. No deployment is performed by this repository.

## Production restrictions

Production is **read-only** for this migration. Do not:

- deploy or enable deployment;
- modify production infrastructure, D1, or R2;
- run production migrations;
- push, open a PR, or merge from this workspace without explicit production authorization.

See `AGENTS.md` for the full project rules.

## Migration status

- Staging behavioral parity: **PASS** (48 routes, `gap=0`, 121 tests, build green).
- Operational readiness: **BLOCKED** by the production media binding (`lantern_media`), route/DNS rollback rehearsal, and sign-off.
- Cutover report: `docs/CUTOVER_READINESS.md`.
- Cutover/rollback runbook: `docs/CUTOVER_RUNBOOK.md`.
- Rehearsal record: `docs/REHEARSAL_RECORD.md`.
- Production migration plan: `docs/PRODUCTION_MIGRATION_PLAN.md`.
