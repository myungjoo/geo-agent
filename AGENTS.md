# AGENTS.md

## Cursor Cloud specific instructions

### Overview

GEO (Generative Engine Optimization) Agent System — TypeScript/Node.js monorepo (npm workspaces) with 4 packages: `core`, `skills`, `dashboard`, `cli`. No external services required; uses embedded libSQL (SQLite-compatible) database.

### Standard commands

All standard dev commands are in the root `package.json`:

| Command | Purpose |
|---|---|
| `npm run build` | Build all packages (TypeScript) |
| `npm run lint` | Biome lint/format check |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm test` | Build + run all vitest tests (744 tests, 16 files) |
| `npm run dev` | Start dashboard dev server (delegates to `packages/dashboard`) |

### Running the dev server

The `npm run dev` command starts the Hono API server but exits immediately because `server.ts` only exports `startServer()` without auto-invoking it. Use the CLI instead:

```bash
node --import tsx packages/cli/src/index.ts start
```

This starts the dashboard API on `http://localhost:3000`. Working endpoints include `/`, `/health`, `/api/settings/agents/prompts`, and `/api/settings/llm-providers`.

**Known limitation**: `/api/targets` and `/api/targets/:id/pipeline` routes return 500 because `startServer()` does not initialize the DB connection. The DB-dependent routes (`initTargetsRouter(db)`, `initPipelineRouter(db)`) are not wired into the startup path. Tests exercise these routes properly via test-level DB setup.

### Node.js version

`.nvmrc` specifies Node 20. Node 20+ is required (`.npmrc` has `engine-strict=true`). Node 22 also works and is used in CI.

### Testing notes

- `npm test` runs `pretest` (build) then `vitest run`.
- For faster iteration, use `npx vitest run` directly if already built.
- Tests use in-memory libSQL (`@libsql/client`) — no file or external DB needed.
- Logger output is suppressed during tests (detects `VITEST` env var).
