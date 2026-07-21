# UEFA Champions League 2026–27 — Club Fantasy

A private/small-group **club** fantasy game for the UEFA Champions League 2026–27
season. Players pick **clubs** (one per pot), not footballers; points come from
real match results. See [PLAN.md](PLAN.md) for the authoritative product spec.

> **Status:** Phase 0 (Bootstrap) complete — monorepo, auth (login/refresh/logout
> with refresh-token rotation), admin user/competition management, healthcheck,
> and the first SQL migration. Domain features land in Phase 1+.

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
```

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

## Scripts

| Command                          | Description                              |
| -------------------------------- | ---------------------------------------- |
| `npm run dev`                    | Run server + client                      |
| `npm run build`                  | Type-check + build both workspaces       |
| `npm run migrate`                | Apply pending SQL migrations             |
| `npm run migrate:status -w server` | Show applied/pending migrations        |
| `npm run seed --workspace server` | Seed first admin + default competition  |
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
| `FOOTBALL_DATA_API_TOKEN`  | football-data.org API v4 token (used from Phase 3)   |
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
  client/                 # participant + admin SPA (Vue 3)
  server/                 # HTTP API, auth, migrations, (later) sync + scoring
  supabase/migrations/    # forward-only SQL migrations
```
