# UEFA Champions League 2026-27 Club Fantasy

A private/small-group **club** fantasy game for the UEFA Champions League 2026-27
season. Players pick **clubs** (one per pot), not footballers; points come from
real match results. See [PLAN.md](PLAN.md) for the authoritative product spec.

> **Status:** phases 0-6 are done and the game plays end to end. That covers
> accounts, permanent squads, club scoring with the per-pot rules editor,
> provider sync behind a swappable interface, weekly lineups with the
> `T0 - 5m` lock, all four jokers, live provisional scoring, the leaderboard
> with per-player and per-club breakdowns, and the run from the league phase
> through the knockouts to the final. Since then it has also grown a
> background sync job that polls the provider on an adaptive schedule, a
> fixtures page that shows a whole round at a time and follows several live
> matches at once, **Ahtapot Paul** (a weekly MS1/MS0/MS2 coupon on every
> match), a live feed on the weekly hub that itemises each point as it lands,
> and a season replay that unlocks once the final is played.
>
> The season now runs on **real data**: all 36 clubs carry their
> football-data.org ids and crests, and the league phase holds UEFA's published
> fixture list rather than a stand-in draw. Phase 7 in [PLAN.md](PLAN.md) §13
> tracks what is left, which is production deploy configuration and deeper
> edge-case tests. The mock provider stays in the tree for local work against a
> simulated clock.

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

# 5. Seed the domain: the official 2026-27 pots, config, and 8 league
#    matchweeks with a randomly drawn fixture list on the real calendar.
#    SEED_FORCE=1 wipes the whole season (accounts stay) and reseeds;
#    SEED_DRAW_SEED=<n> reproduces a specific draw.
npm run seed:domain --workspace server

# 6. Point the season at football-data.org: stamp provider ids and crests onto
#    the 36 clubs, swap the drawn fixtures for the published ones, and switch
#    the configured provider over. Needs FOOTBALL_DATA_API_TOKEN.
npm run seed:provider --workspace server
```

> The clubs and pots are the **official 2026-27 field** (UEFA, 26 Aug 2026).
> The fixture list this step draws is **random**, made under the real
> constraints: two opponents per pot, one at home and one away, never a
> same-country pairing. Step 6 replaces it with the real one.

The seed creates an admin and a default competition. The account is `admin` /
`changeme123` unless you set `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD`.
**Change that password immediately in any real deployment.**

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

Scores only move when someone pulls them in. Pull them by hand from **Yönetim →
Skor Çekme**, which is also where the mock provider takes the simulated clock
you use to advance the mock season. Set `SYNC_SCHEDULER_ENABLED=true` and the
background job polls on its own instead. That job parks itself whenever the mock
provider is selected, because the mock reads its status off the clock you give
it rather than off the wall clock.

## Scripts

| Command                          | Description                              |
| -------------------------------- | ---------------------------------------- |
| `npm run dev`                    | Run server + client                      |
| `npm run build`                  | Type-check + build both workspaces       |
| `npm run migrate`                | Apply pending SQL migrations             |
| `npm run migrate:status -w server` | Show applied/pending migrations        |
| `npm run seed --workspace server` | Seed first admin + default competition  |
| `npm run seed:domain --workspace server` | Seed the 2026-27 pots, matchweeks + a drawn fixture list |
| `npm run seed:provider --workspace server` | Map the clubs onto football-data.org and load the real fixtures |
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
| `SYNC_SCHEDULER_ENABLED`   | Poll the provider from an in-process timer (default `false`) |
| `CRON_SECRET`              | Shared secret for `/api/cron/tick`; empty refuses every caller |
| `PORT`                     | API port (default 8787)                              |
| `VITE_API_BASE_URL`        | API base URL the client calls                        |

## Deploy

The client is a static site on Netlify and the API a Node service on Render,
both built from this repository. `netlify.toml` builds the client workspace out
of the repo root and publishes `client/dist`. There is also a `Dockerfile` at
the root for any host that would rather take a container.

**Something has to drive the season.** Scores arrive because something polls
the provider, and a host that sleeps between requests will happily serve pages
while quietly never advancing anything: scores frozen on their last value, a
published knockout draw never picked up, and nothing erroring anywhere. There
are two ways to be that something, and you pick one:

- **An external cron**, which is what runs today. Set `CRON_SECRET` and point
  any cron service at `POST /api/cron/tick` once a minute, passing the secret
  as `X-Cron-Secret` or a bearer token. This is what makes free hosting work,
  since the host is then free to sleep between pings.
- **An in-process timer.** Set `SYNC_SCHEDULER_ENABLED=true` instead, on a host
  that keeps the process alive. `fly.toml` is set up for this, with
  `auto_stop_machines` off and one machine running.

The ping is deliberately dumber than the work: the cadence rules still decide
whether the provider is actually called, so a minute-by-minute ping through a
quiet week costs one cheap query and nothing more. Both paths take the same
row lock before polling, so a server running the timer *and* answering a cron
cannot double the provider's load.

**Put the API behind the same origin.** The refresh cookie is `SameSite=Lax`, so
a browser will not send it to an API on a different site and every page reload
would drop the session. `client/public/_redirects` proxies `/api/*` through the
Netlify domain to solve that without owning a domain, so the browser only ever
talks to one origin. That also makes CORS moot and lets
`VITE_API_BASE_URL` stay unset, since a production build with no value talks to
its own origin.

The same file falls everything else back to `index.html`, which the router needs
for direct links to `/kadro` or `/yonetim/maclar`. Order matters: the API rules
sit above the catch-all, and Netlify takes the first match.

The API, on a host running the Node runtime:

```bash
npm install --include=dev && npm run build --workspace server   # build
node server/dist/index.js                                       # start
npm run migrate   # schema, from anywhere with DATABASE_URL; not done on boot
```

`--include=dev` is not optional. `NODE_ENV=production` is one of the variables
you set, and npm reads it: a plain `npm install` then skips TypeScript along
with every other dev dependency, and the build fails looking for it.

Leave the host's root directory at the repository root. The server is a
workspace and the lockfile that pins it lives there, so an install rooted at
`server/` cannot resolve the tree.

Set `NODE_ENV=production` (this is what makes the cookie `Secure`), a fresh
`JWT_SECRET`, `CLIENT_ORIGIN` to the site URL with no trailing slash,
`FOOTBALL_DATA_API_TOKEN`, `ADMIN_PATH` and `CRON_SECRET`. Point the host's
health probe at `/health/ready`. Do not set `PORT`; the host provides it.

Move the API to another address and both proxy targets in `_redirects` follow
it.

The rate limiter and the background jobs live in the process, so run **one**
instance. Two would each keep their own login counter and each poll the
provider.

## Auth model

- **No public registration.** Admins create all accounts.
- Short-lived **access JWT** (in-memory on the client) + **httpOnly refresh
  cookie** with server-side **rotation** (each refresh revokes the old token).
- Login is **rate-limited** per `(IP + username)` with a `429` + `Retry-After`;
  there is no permanent account lockout (avoids DoS on a known username).
- Spent refresh tokens are swept daily, a week after they expire. The server
  does this itself; there is no cron to set up.

## Repository layout

```text
/
  PLAN.md                 # authoritative product spec
  package.json            # npm workspaces root
  AGENTS.md               # working agreement for contributors
  Dockerfile              # API image, built from the repo root
  fly.toml                # API host: one machine, never stopped
  netlify.toml            # client build for Netlify
  client/                 # participant + admin SPA (Vue 3)
  server/                 # HTTP API, auth, scoring, provider sync, migrations
  supabase/migrations/    # forward-only SQL migrations
```
