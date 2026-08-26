# UEFA Champions League 2026–27 — Club Fantasy

A private/small-group **club** fantasy game for the UEFA Champions League 2026–27
season. Players pick **clubs** (one per pot), not footballers; points come from
real match results. See [PLAN.md](PLAN.md) for the authoritative product spec.

> **Status:** Phases 0–6 complete and playable end to end — accounts, permanent
> squads, club scoring with the per-pot rules editor, provider sync behind a
> swappable interface, weekly lineups with the `T0 − 5m` lock, all four jokers,
> live provisional scoring, the leaderboard and per-player/per-club breakdowns,
> and the league → knockout transition through the final. On top of that: a
> background sync job that polls the provider on an adaptive schedule, a
> fixtures and multi-live page covering a whole round at a time,
> **Ahtapot Paul**, a weekly MS1/MS0/MS2 coupon on every match of the week, a
> live delta feed on the weekly hub that itemises every point as it lands, and
> a season replay that opens once the final is played.
>
> What is left is tracked as Phase 7 in [PLAN.md](PLAN.md) §13 — production
> deploy configuration, deeper edge-case tests, and reseeding the clubs once
> UEFA publishes the 2026–27 draw. Until then the app runs on placeholder
> clubs driven by a mock provider.

## Stack

| Layer    | Choice                                                        |
| -------- | ------------------------------------------------------------ |
| Monorepo | npm workspaces (`server`, `client`)                          |
| Server   | Node.js + Hono + TypeScript (`pg`, `zod`, JWT, bcrypt)       |
| Client   | Vue 3 + Vite + TypeScript + Pinia + Vue Router + PrimeVue    |
| Database | PostgreSQL (Supabase-hosted or local)                        |

## Prerequisites

- Node.js ≥ 20
- A PostgreSQL database (local, or a Supabase project connection string)

## Setup

```bash
# 1. Install all workspace dependencies
npm install

# 2. Create your env file from the sample and fill in DATABASE_URL, JWT_SECRET, ...
cp .env.example .env

# 3. Apply database migrations
npm run migrate

# 4. Seed the first admin account (there is no public self-registration)
npm run seed --workspace server

# 5. Seed the domain mockup: pots, 36 placeholder clubs, config, and 8 league
#    matchweeks with a mock fixture list (re-run with SEED_FORCE=1 to reset)
npm run seed:domain --workspace server
```

> The 2026–27 participants aren't known yet (qualifying is ongoing), so the
> domain seed uses a **placeholder** 36-club field from last season, split into
> four pots. Reseed after UEFA publishes the official draw (PLAN.md §2.3).

The seed creates an admin (default `admin` / `changeme123` — override with
`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`) and a default competition. **Change
the password immediately in any real deployment.**

## Running

```bash
# Server + client together
npm run dev

# Or individually
npm run dev:server   # http://localhost:8787
npm run dev:client   # http://localhost:5173
```

- Participant app: `http://localhost:5173/`
- Admin app: `http://localhost:5173/yonetim` (admin login required)
- Healthcheck: `http://localhost:8787/health` and `/health/ready`

Scores only move when someone pulls them in. Trigger a sync by hand from
**Yönetim → Sync** (the mock provider takes a simulated clock there, which is
how you advance the mock season), or set `SYNC_SCHEDULER_ENABLED=true` to let
the background job poll on its own. That job deliberately parks itself while the
mock provider is selected, since the mock reads its status off the clock you
give it.

## Scripts

| Command                          | Description                              |
| -------------------------------- | ---------------------------------------- |
| `npm run dev`                    | Run server + client                      |
| `npm run build`                  | Type-check + build both workspaces       |
| `npm run migrate`                | Apply pending SQL migrations             |
| `npm run migrate:status -w server` | Show applied/pending migrations        |
| `npm run seed --workspace server` | Seed first admin + default competition  |
| `npm run seed:domain --workspace server` | Seed pots, mock clubs, matchweeks + fixtures |
| `npm run test`                   | Run server unit tests (node:test)        |

## Environment variables

| Variable                   | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`             | PostgreSQL connection string                         |
| `JWT_SECRET`               | Secret for signing short-lived access tokens         |
| `ACCESS_TOKEN_TTL_SECONDS` | Access token lifetime (default 900)                  |
| `REFRESH_TOKEN_TTL_SECONDS`| Refresh token lifetime (default 1209600 = 14 days)   |
| `ADMIN_PATH`               | Obscure base path gating the admin area              |
| `CLIENT_ORIGIN`            | Allowed browser origin (CORS + refresh cookie)       |
| `FOOTBALL_DATA_API_TOKEN`  | football-data.org API v4 token (server-side only)    |
| `SYNC_SCHEDULER_ENABLED`   | Poll the provider in the background (default `false`) |
| `PORT`                     | API port (default 8787)                              |
| `VITE_API_BASE_URL`        | API base URL the client calls                        |

## Auth model

- **No public registration.** Admins create all accounts.
- Short-lived **access JWT** (in-memory on the client) + **httpOnly refresh
  cookie** with server-side **rotation** (each refresh revokes the old token).
- Login is **rate-limited** per `(IP + username)` with a `429` + `Retry-After`;
  there is no permanent account lockout (avoids DoS on a known username).

## Repository layout

```text
/
  PLAN.md                 # authoritative product spec
  package.json            # npm workspaces root
  AGENTS.md               # working agreement for contributors
  client/                 # participant + admin SPA (Vue 3)
  server/                 # HTTP API, auth, scoring, provider sync, migrations
  supabase/migrations/    # forward-only SQL migrations
```
