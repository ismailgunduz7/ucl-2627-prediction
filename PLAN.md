# UEFA Champions League 2026–27 Fantasy Competition — Implementation Plan

This document is the single source of truth for building the product **from scratch**. An implementer (human or AI agent) should be able to deliver the system using only this plan, without prior knowledge of any other competition or codebase.

---

## 1. Product vision

Build a private / small-group **club fantasy game** for the **UEFA Champions League 2026–27** season.

Players do **not** pick footballers (no FPL-style squad of GK/DEF/MID/FWD). They pick **clubs**. Points come from those clubs’ real match results. Engagement continues all season through **weekly lineup decisions** (active three vs bench, captain), **jokers**, live match feedback, and season-act resets — not only through a one-time squad lock.

### Goals

- Fun, understandable rules for a friend group or office league.
- Minimal admin busywork: **match scores are synced from an external provider**, not typed match-by-match.
- Keep players coming back every matchweek (lineup + captain + optional joker + live hub).
- Scoring weights remain **admin-editable** without code deploys.
- **Integer points only** (no half-points, no fractional rounding).

### Non-goals (out of scope)

- UEFA **qualifying / preliminary rounds** (the fantasy competition starts at the **league phase** and then includes the full knockout path — see §2).
- Betting props (corners, cards, over/unders, odds).
- Public multiplayer marketplace, payments, or mobile native apps (web first).
- Player-level fantasy (goals/assists by named footballers).
- Random / auto-assigned squad side mode (not part of this product).
- Mid-season joining after permanent squad lock (new users only before selection lock).

---

## 2. Tournament domain (real world)

### 2.1 Competition window

- **Competition:** UEFA Champions League, season **2026–27**.
- **Included (full product scope — not “league only”):**
  1. League phase
  2. Knockout phase play-offs (teams ranked **9–24** after the league phase)
  3. Round of 16
  4. Quarter-finals
  5. Semi-finals
  6. Final
- **Excluded:** All rounds before the league phase (qualifiers / preliminary rounds).

### 2.2 League phase

Approximate structure (confirm against official 2026–27 regulations when seeding data):

- **36 clubs** in a single league table (Swiss / league-phase format).
- Each club plays a fixed number of league-phase matches (historically **8** matchdays per club in the post-2024 format).
- Many matches kick off **in parallel** on the same matchday — the product must handle concurrent live and finished fixtures without assuming a single live match.

### 2.3 Pots (tiers)

At the league-phase draw, UEFA assigns clubs to **four pots** (Pot 1–4). In this game:

- **Pot = scoring tier.**
- Each pot has its own point values for the same rule types (e.g. a Pot 1 win may score differently than a Pot 4 win).
- Squad building uses pots as a **hard constraint**: exactly one club from each pot (see §3).

When the official draw is published, seed `teams` with pot assignments. Until then, use placeholder pots and swap via admin/seed update.

### 2.4 Knockout phase

After the league phase:

- Paths follow UEFA 2026–27 regulations (play-offs for ranks 9–24, then R16 → final).
- **Top-8 clubs skip the play-off round.** Clubs finishing the league phase in positions **1–8** advance directly to the Round of 16. During the play-off matchweeks these clubs have **no fixture (bye)** and therefore score **0** those weeks. To make sure a top-8 finish is not a disadvantage, each such club receives a **one-time** `league_top8_bonus` (§4.2) when the league phase completes. There is **no per-week "bye" award** of any kind.
- Where ties are **two-legged**, each **leg is its own matchweek** for fantasy (bench/captain/joker lock per leg).
- No third-place match.
- Scoring continues with stage-specific rules (`round_advance`, final medals, etc.).
- Tie-break methods (extra time, penalties) follow that season’s UEFA rules. There is **no away-goals rule**.

### 2.5 Eliminated clubs

- A club that is **eliminated** from the tournament remains in the database and may remain on a user’s permanent squad.
- From the moment of elimination onward, that club contributes **0 fantasy points from future matches** (it no longer plays). A club that has **no fixture assigned** in a given matchweek (whether eliminated or a top-8 club on a bye week) simply scores **0** that week — there is no per-week bye award.
- Elimination can occur:
  - **After the league phase:** clubs that finish outside the positions that continue (e.g. ranks **25–36**) are marked eliminated when the league phase completes.
  - **During the knockout path:** losers of play-offs / R16 / QF / SF (and the final loser remains in for silver-medal scoring on the final matchweek, then is done).
- Clubs are **not** deleted. Skill is picking successful clubs from each pot; only two reach the final.

---

## 3. Game rules

### 3.1 Players (users)

- Accounts are **created by an admin** (username + password). There is **no public self-registration** API.
- Optional grouping into **competitions**. A competition is **only** a way to isolate a set of participants from each other (e.g. work, school, friends, family) so each user sees **only their own competition's** participants, leaderboard, and open picks. **All game rules, config, scoring, jokers, matchweeks, acts, and tournament data are global/shared** across competitions — competitions never change the rules, only *who is grouped with whom*. First season may use a **single** competition; the schema and admin UI must support multiple.
- Roles: **participant** and **admin**. Admins manage the system and do not play on the same account (excluded from participant leaderboards).
- New participants may be added only **before permanent squad lock**. After lock, no new players join that season.

### 3.2 Squad selection (permanent)

| Rule | Default | Notes |
|------|---------|--------|
| Squad size | **4 clubs** | One from each pot when using 4 pots |
| Pot constraint | **Exactly one club per pot** | Hard constraint (4 clubs, 4 pots) |
| Duplicates | Forbidden | Same club cannot appear twice |
| Edit window | Until **selection lock** | **Same instant as matchweek 1 lineup lock:** `T0(MW1) − 5 minutes` (§3.4). Not a separate arbitrary clock. |
| After lock | Permanent until act transfer (§3.7) | Weekly bench/captain/jokers do not change the permanent 4 |

Validation must be enforced server-side (RPC or transactional service), not only in the UI.

### 3.3 Matchweeks

A **matchweek** is the atomic engagement and locking unit.

- League phase: matchweeks `1 … N` (N ≈ 8).
- Knockout: **one matchweek per leg** (e.g. `playoff-leg1`, `playoff-leg2`, `r16-leg1`, …, `final`). Single-leg ties (e.g. final) = one matchweek.

Every match belongs to exactly one matchweek.

### 3.4 Edit locks (authoritative)

Let `T0(M)` = kickoff time of the **earliest** match in matchweek `M`.

| Action | Rule |
|--------|------|
| Lineup (bench/captain), jokers, weekly swap for matchweek **M** | Editable until **`T0(M) − 5 minutes`**. After that instant, matchweek **M** is frozen for that user. |
| Editing matchweek **M+1** (and later) | Allowed **once the first match of M has kicked off** (i.e. after `T0(M)`), even while M is still being played. |
| Hard constraint | The lock instant for M is **always** `T0(M) − 5 minutes`. It must never be configured to fall after `T0(M)`. |

**Privacy / open picks:** From `T0(M)` onward (first kickoff of M), within the same competition, peers can see each user’s bench, captain, and joker for M (see §3.6). Before `T0(M)`, those picks stay private.

**Kickoff reschedules (provider moves `T0`):** The lock instant is **always derived from the current `first_kickoff_at`** of matchweek `M`, recomputed on every sync — it is never a stored, frozen deadline. Consequences:

- `first_kickoff_at` = the earliest `kickoff_at` among matches still assigned to `M` (a `postponed` match keeps its assignment; if it is the earliest and gets a new date, `T0(M)` moves with it).
- **Kickoff moved later, and `M` had not yet started** (`now < old T0(M)`): the lock simply moves later; if the week was already locked purely because the old `T0−5m` had passed, it **re-opens** until the new `T0−5m`. Safe because open picks only appear from `T0(M)`, so nothing was revealed yet.
- **Kickoff moved earlier such that the new `T0(M) − 5m` is already in the past at sync time:** `M` **locks immediately**. Any user without a valid saved lineup gets the deterministic fallback (§3.5).
- **A match has already kicked off (`now ≥ T0(M)`):** `M` is treated as **started and frozen**; it does **not** re-open even if a later match in `M` is rescheduled, because peer picks are already visible.
- All comparisons are UTC (§3.9).

### 3.5 Weekly lineup (free, every matchweek)

Before the lock for matchweek M, every participant sets:

1. **Bench (1 of 4)** — Exactly one club from the effective four (permanent squad after optional `weekly_swap`) sits on the **bench**. The other **three score**. Bench club points that week are **ignored**, unless `bench_boost` is active.
2. **Captain (1 of the scoring clubs)** — Captain’s **net matchweek points** are multiplied by **×2** (or **×3** with `triple_boost`). Captain must be among the clubs that score that week (the three, or any of four under bench boost).

These are **not** jokers; change them every week at no inventory cost.

**Bench ↔ captain swap.** A benched club can **never** hold the captaincy — the **only** way to captain a benched club is the `bench_boost` joker (§3.6), which makes all four score. So if the user swaps the roles of two of their own clubs (e.g. captain **X** and bench **Y** → captain **Y**, bench **X**), the captaincy moves to the club that leaves the bench (**Y**, now a scoring club) and the old captain (**X**) goes to the bench and stops scoring. Generally: whenever the current captain is moved to the bench, the captaincy must be reassigned to a scoring club in the same action.

**Default if the user does nothing before lock:** keep previous matchweek’s bench + captain if both are still valid on the effective four; otherwise deterministic fallback (e.g. bench = highest pot number / Pot 4, captain = Pot 1 among the three). Document fallback in UI.

**After a `weekly_swap` ends:** next matchweek uses the permanent squad again (including a club that may already be eliminated — that club simply scores 0 until replaced via a later weekly swap or act transfer).

**Integer points:** captain multiplier is ×2 or ×3 only.

### 3.6 Jokers (inventory)

Each participant receives inventory counts (admin-configurable). Illustrative defaults per **act** (see §3.7):

**Initial grant (Act I).** A participant's inventory is seeded with the **Act I (league phase)** `joker_inventory_defaults` at account creation, and in every case **strictly before the MW1 selection lock** (`T0(MW1) − 5m`) — so a participant can already activate a joker for matchweek 1. This is the counterpart of the Act II **refresh** in §3.7 step 3: Act I = first grant at onboarding, Act II = full reset at league completion. A participant added mid–Act I still receives the full Act I grant.

| Code | Suggested name (TR copy TBD) | Count | Effect |
|------|------------------------------|-------|--------|
| `weekly_swap` | Haftalık değişim | 2 | Same-pot one-week club replacement |
| `triple_boost` | Üçlü kaptan / ×3 kaptan | 1 | No club pick: captain multiplier ×2 → ×3 |
| `clean_sheet_shield` | CS kalkanı | 2 | See shield table; **must target a scoring (non-bench) club** |
| `bench_boost` | Bench boost | 1 | All four clubs score this week |

**Activation rules**

- At most **one** joker activation per participant per matchweek. This is a **hard rule**, enforced both by the `joker-service` and by a DB partial unique index (§8.1 `joker_activations`); a second live activation for the same week is rejected. To use a different joker, the user must first cancel the active one (refund) before lock.
- Optional (using a joker is never required).
- Must activate/cancel before lock (`T0(M) − 5 minutes`).
- Inventory decrements on activation.
- **Cancel before lock:** joker is removed and **inventory is restored** (+1).
- Team-targeted jokers (`clean_sheet_shield`) may only target a club that is **not** on the bench. The only joker that makes a benched club score is `bench_boost`.
- If the user moves a **joker-targeted club onto the bench** (e.g. shield target), treat that as **cancelling the joker** and **refund inventory**. UI must show a confirmation dialog before applying, e.g. “X takımında kullandığınız joker var. Bench’e çekmek jokeri iptal eder ve iade eder. Devam?”
- **Changing/removing a club that has a joker on it.** Because the squad is still editable before a matchweek locks (permanent selection before selection lock, `act_transfer`, or `weekly_swap`), any edit that **removes or replaces a club that is the target/subject of an active joker for that matchweek** must warn the user first: a confirmation dialog stating the joker will be cancelled and refunded, e.g. “X takımında kullandığınız joker var. Takımı değiştirmek jokeri iptal eder ve iade eder. Devam?” On confirm, cancel the joker and restore inventory (+1). (In practice this applies to team-targeted jokers such as `clean_sheet_shield`, and to any joker payload that references the removed club.)

**Visibility**

- Before `T0(M)`: private.
- From `T0(M)`: peers see bench, captain, and joker **only if a joker was used**. If no joker, show bench + captain only — do **not** show an empty/placeholder joker.

#### Joker — One-week team swap (`weekly_swap`)

- Replace one permanent slot for **this matchweek only** with another club from the **same pot**, not already in the squad.
- **Flow:** choose the replacement club (“yeni takım”), then activate swap. There is no in-place edit of an active swap’s target: to change the replacement club, **cancel** the swap (refund), pick the new replacement, activate again.
- Exclude **eliminated** clubs from the picker when `eliminated_at` is set. If **every** other club in that pot is eliminated, swap in that pot is impossible.
- **Effect on bench/captain when the swapped-out club held a role:** the incoming replacement club **inherits the swapped-out club's slot and role**. If the swapped-out club was the **bench**, the replacement becomes the new bench (captain unchanged). If it was the **captain** (a scoring club), the replacement becomes a scoring club and **inherits the captaincy**. A benched club can never hold the captaincy except under `bench_boost` (§3.5). The user can still freely change bench/captain afterwards before lock.
- Lineup is chosen on the post-swap four.
- Next matchweek reverts to the permanent squad automatically (eliminated permanent clubs simply yield 0 from matches).

**Interaction with act transfer (§3.7):** Act transfer is **optional** — users may keep all four permanent clubs. If both are in play for the same upcoming matchweek:

1. Apply / edit **act transfer** on the permanent squad first when the user wants a permanent change.
2. Then activate **weekly_swap** on top of the current permanent squad if they also want a one-week replacement.
3. While a non-cancelled `weekly_swap` is active for that matchweek, **block act-transfer edits**. User must cancel the swap, change act transfer, then re-activate swap if desired.
4. Same-pot only; if a pot has no non-eliminated alternatives, that pot cannot be changed via act transfer either.

#### Joker — Triple boost (`triple_boost`)

- **No target club.** Applies to the current captain.
- Captain multiplier becomes **×3** instead of **×2** (never ×6).
- Changing captain before lock moves ×3 to the new captain.
- Requires a valid captain.

#### Joker — Clean sheet shield (`clean_sheet_shield`)

Target: one **scoring** club (not benched).

| GA (goals conceded) | Effect |
|---------------------|--------|
| 0 | Normal clean sheet bonus. |
| 1 | Count as clean sheet for bonus **and** do **not** apply `goals_conceded` for that 1 goal. |
| ≥ 2 | Shield **breaks**; normal scoring (no CS; full `goals_conceded`). |

#### Joker — Bench boost (`bench_boost`)

- All **four** clubs contribute points this matchweek (including negatives from the designated bench club).
- Captain may be any of the four.
- Crest wall: **do not** mute the bench crest; show a small **“boosted”** chip on the hub.
- Cannot combine with another joker the same week.

### 3.7 Season acts (league → knockout)

Acts:

1. **Act I — League phase**
2. **Act II — Knockout** (play-offs for 9–24 through final)

**When the league phase is complete** (all league-phase matches finished — detected automatically from synced data):

1. Mark league-phase eliminations (e.g. ranks **25–36**) via `eliminated_at`.
2. **Award `league_top8_bonus`:** grant the one-time per-pot bonus to each club that finished the league phase in positions **1–8** (§4.2). Written as a club-layer `team_point_entries` line attributed to the first play-off matchweek so it flows into participant scoring for owners who have that club scoring that week.
3. **Joker refresh:** every participant’s inventory resets to Act II defaults (full refill; prior remaining counts are replaced by the Act II grant table).
4. **Act transfer window opens:** each participant **may** change **one** permanent squad club to another club in the **same pot** (`act_transfer`). Optional — keeping the squad unchanged is valid.
5. While the window is open (until transfer lock), the user may update that transfer as often as they like (same-pot; destination must not be eliminated; if the pot has no eligible clubs, transfer in that pot is impossible).
6. **On each successful commit/update:** write `team_selections` **immediately** (status `committed`). Further edits overwrite until lock.
7. **Transfer lock:** `T0(M_ko1) − 5 minutes` where `M_ko1` is the first knockout matchweek. At lock: `available` → `expired`; `committed` stays as the frozen permanent squad.
8. While a `weekly_swap` is active for `M_ko1`, act-transfer edits are blocked until the swap is cancelled (§3.6).

**Strategic note:** After jokers refresh, a `weekly_swap` can temporarily replace an eliminated (0-point) club with a still-alive club. Top-8 clubs sitting out the play-off matchweeks score 0 those weeks (bye); the one-time `league_top8_bonus` (§4.2) compensates for that idle period, while bench/swap remain available as user tools.

Act transfer does **not** consume the weekly joker slot.

### 3.8 Engagement features (in scope)

Details in §10 and §18.

| Feature | Summary |
|---------|---------|
| Matchweek briefing | Pre-lock overview of *your* fixtures + risk map |
| Deadline drama | Urgency UX approaching `T0(M) − 5 minutes` |
| Weekly wrap card | Personal end-of-week summary (in-app; share export not required) |
| Open picks after kickoff | Bench, captain, and joker (if any) visible to peers from `T0(M)` |
| Multi-live tracker | Concurrent live matches, own clubs pinned |
| Live delta | Point deltas as live/finished scores update |
| Crest wall | Four crests; mute bench unless bench boost (+ optional boosted chip) |
| Season replay | End-of-season retrospective |

### 3.9 Domain constants & invariants (fixed, not configurable)

These values are **structural rules of the game**, not admin config. They live as code/DB constants and must never be surfaced as editable settings:

| Constant | Value | Notes |
|----------|-------|-------|
| `SQUAD_SIZE` | **4** | Permanent squad is always 4 clubs. |
| `POT_COUNT` | **4** | Exactly one club per pot. |
| `ACTIVE_CLUBS_PER_WEEK` | **3** | = `SQUAD_SIZE − 1` (one benched); `bench_boost` overrides to 4 for that week only. |
| `LINEUP_LOCK_OFFSET_SECONDS` | **300** | Lock is always `T0(M) − 5 minutes`; never after `T0(M)`. |

**Invariants that must hold (validated at startup / in tests):**

1. `ACTIVE_CLUBS_PER_WEEK == SQUAD_SIZE − 1`.
2. `SQUAD_SIZE == POT_COUNT` (exactly one club per pot).
3. `LINEUP_LOCK_OFFSET_SECONDS > 0` and the derived lock instant is strictly before `T0(M)`.
4. Selection lock for the permanent squad is **derived** from the MW1 lineup lock (`T0(MW1) − 5m`) — never a second, independent clock.
5. The captain fallback (§3.5) assumes exactly one club per pot; it must be derived from the current pot layout, not hardcoded to a pot index if any of the above ever change.

**Time handling:** All instants (`kickoff_at`, `first_kickoff_at`, lock times, `eliminated_at`, `locked_at`) are stored and compared in **UTC** (`timestamptz`). Clients localize for display only. Lock evaluation is always UTC-vs-UTC so DST transitions cannot shift a deadline.

---

## 4. Scoring model

### 4.1 Two layers

1. **Club layer** — Point lines for each club from match results (pot-specific rule values).
2. **Participant layer** — Per matchweek totals from effective squad + bench/captain/jokers → `player_matchday_scores`. Season total = sum of matchweek scores.

**Resolution order (authoritative) for a participant matchweek:**

1. Start from permanent squad (4).
2. Apply `weekly_swap` if activated → still 4 clubs.
3. If `bench_boost` → all 4 score; else drop the benched club.
4. For each scoring club, take club-layer points from this matchweek’s matches (finished lines + live provisional drafts — §4.3), applying shield adjustments if any; include any one-time bonus lines attributed to this matchweek (e.g. `league_top8_bonus`, §4.2). A scoring club with **no fixture assigned** to this matchweek and no bonus line contributes **0** (bye).
5. Apply captain multiplier ×2, or ×3 if `triple_boost`.
6. Week total = sum over scoring clubs.

### 4.2 Rule types (initial set)

Store as `scoring_rule_types` + per-pot values in `tier_scoring_rules` (tier = pot).

| Code | Category | When |
|------|----------|------|
| `win` | match | Club wins (per time-basis config) |
| `draw` | match | Draw |
| `loss` | match | Loss |
| `goals_scored` | match | Per goal scored |
| `goals_conceded` | match | Per goal conceded |
| `clean_sheet` | match | GA = 0 (shield may treat GA = 1 as CS for bonus / conceded suppression) |
| `league_top8_bonus` | league | **One-time** per-pot bonus awarded to each club that **finishes the league phase in positions 1–8**. These clubs skip the knockout play-off round, so they have no fixture (bye) during the play-off matchweeks and score 0 then; this one-time bonus keeps a top-8 finish from being a disadvantage. Awarded once when the league phase completes; attributed to the first play-off matchweek. **Not** a per-week award and **not** given to eliminated clubs. |
| `round_advance` | knockout | Progress to next knockout round (awarded on the match/leg that causes advancement) |
| `gold_medal` / `silver_medal` | knockout | Final winner / runner-up (on the final matchweek) |

All values are **admin-editable** integers (may be negative or zero). They must respect the **pot-strength direction** (§16): reward rules (`win`, `draw`, `clean_sheet`, `league_top8_bonus`) are **higher for weaker pots** (Pot 1 lowest → Pot 4 highest); penalty rules (`loss`, `goals_conceded`) are **more negative for stronger pots**. The admin rules editor should warn when a saved value breaks this monotonic direction.

Tune `league_top8_bonus` so that finishing top-8 (and sitting out the play-off matchweeks) is not a disadvantage versus clubs that play extra play-off legs. Because the top-8 idle period spans the play-off matchweeks, seed the bonus to roughly match the points such a club would otherwise be expected to earn across those weeks. Users can still bench or `weekly_swap` around idle weeks; the one-time bonus is the structural fix. A club with **no fixture assigned** to a matchweek always scores **0** that week — there is no per-week bye award.

Other than `league_top8_bonus`, there is **no** separate end-of-league “rank bonus” rule beyond marking eliminations and whatever match points were earned in the league phase.

### 4.3 Live / provisional vs finished scoring

The backend must support **live hubs, anlık delta, and provisional week points** while matches are in progress, and **final** points when matches are finished.

**Shared idea:** the *rules* for a live scoreline are the same as for a finished match (`scoreMatchDraft(match, rules)` = treat current score as if the match ended now: W/D/L, goals, CS/shield on current GA). The only design choice is **whether that draft is stored**.

#### Option A — Recommended: finished rows only; provisional on read

| | Behaviour |
|---|-----------|
| `team_point_entries` | Written **only** when a match is `finished` (source of truth). |
| Live matches | Draft points computed in memory (or short-TTL cache) on each hub/leaderboard/delta request. |
| `player_matchday_scores` | Written/updated as **final** only when the matchweek completes (§4.6). During the week, APIs return a **computed** provisional total (not necessarily a DB row, or a cache row that is never treated as authoritative). |
| Recalc | Simple: replay finished matches → rebuild finals. |
| Cost | Fewer writes, no provisional cleanup, fewer race conditions. |
| Tradeoff | More CPU on read during busy multi-live windows (mitigate with short cache). |

#### Option B — Alternative: persist provisional participant (and optional club) rows

| | Behaviour |
|---|-----------|
| Live / in-progress week | Upsert `player_matchday_scores` with `is_final = false` on each sync tick (and optionally provisional club lines). |
| Match finishes / week completes | Replace with definitive rows; set `is_final = true`. |
| Cost | Higher write load, careful invalidation when scores flip. |
| When to use | Only if Option A read path is too slow/chatty after profiling. |

**Decision for this plan: implement Option A.** Do **not** treat `is_final = false` as a required live-write path. The `player_matchday_scores` table stores **completed (final) weeks**; live provisional is computed by the API from finished entries + live drafts + lineup/jokers. Option B remains a documented escape hatch if A does not meet latency needs.

### 4.4 Time basis for knockout

Config flag: whether win/draw/loss and goals use 90-minute score vs after-extra-time score. Penalties decide the winner for advancement but do **not** count as goals scored/conceded unless explicitly configured.

### 4.5 Match outcomes that are not a normal finish

| Status | Club fantasy points | Matchweek completion |
|--------|---------------------|----------------------|
| `finished` | Normal rules | Counts toward completion |
| `cancelled` | **Neither club scores** any points from that match | Treated as **resolved**; does **not** block matchweek completion |
| `postponed` then played later | When eventually finished, points are attributed to the match’s **original** `matchweek_id`, even if the real kickoff falls after later matchweeks | Original matchweek stays **incomplete** until that match is `finished` or `cancelled` |

Default: do **not** move a postponed match to a different fantasy matchweek.

**Out-of-order finalization:** Because a postponed match keeps its original `matchweek_id`, matchweeks can finalize **out of chronological order** — a later matchweek may complete and write final `player_matchday_scores` while an earlier one is still incomplete (waiting on the postponed fixture). This is expected under Option A:

- The earlier (incomplete) matchweek keeps returning a **provisional** computed total (finished lines so far; the postponed fixture contributes 0 until played) and its wrap card stays locked until it truly completes.
- The season total and leaderboard (§4.8) always sum **final** completed weeks + **provisional** for any still-incomplete week, so ranks stay correct even while an old week is pending.
- When the postponed match is finally `finished`/`cancelled`, that original matchweek completes, its finals are written, and its wrap card unlocks — possibly days after later weeks.

### 4.6 Matchweek completion (automatic)

A matchweek `M` is **complete** when every match assigned to `M` is either `finished` or `cancelled`.

- Detection is by the sync/scoring job — **not** an admin button.
- On completion: write final `player_matchday_scores` for all participants; unlock weekly wrap cards.
- When the **league phase** completes specifically, also award `league_top8_bonus` to the clubs ranked 1–8 (§3.7 step 2) before finalizing the affected participant scores.

### 4.7 Recalculation

Admin can trigger a **full rebuild**:

1. Clear definitive `team_point_entries`.
2. Re-apply club-layer scoring for all finished matches (+ one-time `league_top8_bonus` when the league phase is complete).
3. Re-apply final participant matchweek scores (lineups + jokers).

Incremental path: on match upsert, update that match’s club lines (or live drafts) and recompute affected provisional API responses; on finish/complete, persist finals.

### 4.8 Leaderboard ranking

- **Scope:** leaderboards list only **participants** of the requesting user's competition. `is_admin` users are **excluded** from every participant leaderboard and never counted in ranks (§3.1).
- Primary: sum of **final** `player_matchday_scores.points`, plus **live/provisional** computed total for any in-progress **or still-incomplete** matchweek — including an earlier week awaiting a postponed match (§4.5, Option A).
- Tie-break: higher points in the most recent **completed** matchweek, then alphabetical `display_name`.
- Display ranks use standard competition ranking (“1224”).

---

## 5. External match data

### 5.1 Provider

Primary provider: **[football-data.org](https://www.football-data.org/)** API v4, competition code **`CL`**.

- Free tier: fixtures, results, league tables; rate limit ~10 req/min; live scores may be delayed.
- Paid “livescores” tier if near-real-time UI is required.

Implement behind a **provider interface** so the source can be replaced without rewriting scoring.

### 5.2 Sync behaviour

- Map provider team IDs → local `teams.external_id`.
- Map provider match IDs → local `matches.external_id`.
- Upsert: kickoff, status (`scheduled` | `live` | `finished` | `postponed`), scores, matchweek, stage, leg when applicable.
- On `live` score changes: refresh provisional participant views (§4.3).
- On transition to `finished`: persist club entries; recompute affected participant views; check matchweek completion (§4.6).
- Ensure `matchweeks` registry rows exist/update for every fixture slug (league and each KO leg).
- On every sync, **recompute `matchweeks.first_kickoff_at`** from current fixture kickoff times so lock instants track provider reschedules (§3.4). A matchweek already started (`now ≥ T0`) stays frozen and does not re-open.
- Poll schedule: quiet periods infrequent; active match windows more frequent within rate limits.
- Persist sync cursors / last success / error logs for admin.

### 5.3 Admin override

Admins can manually edit a match result if the provider is wrong or late. Manual edits set `is_manual_override`; sync must **not** overwrite overridden fields unless admin clears the flag.

Every manual edit (and flag clear) is recorded in an **audit log** (`match_override_audits`, §8.1): who, when, which match, and the before/after values of each changed field. This is required for dispute resolution and for reasoning about score changes after a recalc (§4.7).

### 5.4 No betting stats pipeline

Do not ingest corners, cards, shots, or odds. Match results only.

### 5.5 Elimination detection

Set `teams.eliminated_at` when:

- League phase completes and the club finishes outside continuing places (e.g. **25–36**), and/or
- The club loses a knockout tie (play-off through SF).

Use this flag to filter swap and act-transfer pickers (§3.6–3.7).

### 5.6 Provider access, caching & rate limits

The provider rate limit (~10 req/min on the free tier) is a **server-to-provider** constraint, **not** a per-end-user one. Design so participant traffic never fans out into provider calls:

- **Centralized ingestion:** only the scheduled sync job (and admin "trigger sync") call the provider. Participant/admin **read** endpoints (hub, fixtures, multi-live, leaderboard, deltas) are served **only** from our DB + a short-TTL server cache — never by proxying the provider per request. So N concurrent users cause **0** extra provider calls; user concurrency can never trip the provider limit.
- **Adaptive polling within the budget:** poll infrequently in quiet periods and more often during active match windows, staying under the limit; persist sync cursors and last-success/error (§5.2). If a poll is throttled (HTTP 429) or fails, keep serving the last-good cached data and retry with backoff — the UI shows "son güncelleme HH:MM" and a provisional badge rather than an error.
- **Live is best-effort:** on serverless hosts (e.g. Vercel cron, ~1-minute minimum granularity) plus the free tier's delayed scores, "anlık delta" is **near-real-time, not real-time**. If true low latency is needed, move to the paid livescore tier and/or a dedicated always-on worker (§15). This is a hosting/tier decision, not a scoring-logic change.

---

## 6. Technology stack (greenfield recommendation)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Monorepo | npm workspaces | `client`, `server` |
| Frontend | Vue 3 + TypeScript + Vite + Pinia + Vue Router + PrimeVue | Fast admin + participant UI |
| Backend | Node.js + Hono + TypeScript | Lightweight API |
| Database | PostgreSQL (e.g. Supabase-hosted) | Relational fit for scoring/jokers |
| Auth | Custom JWT access + httpOnly refresh cookie (rotation) | Private league; admin-provisioned users |
| Hosting | Vercel (or similar) for client + server | Cron via scheduled functions for sync |
| Secrets | Env vars for DB URL, JWT secret, football-data token, admin path |

---

## 7. Repository layout (target)

```text
/
  PLAN.md                 # this file
  README.md               # setup, env, scripts
  package.json            # workspaces
  client/                 # participant + admin SPA
  server/                 # HTTP API, sync, scoring
  supabase/               # SQL migrations + seeds
```

No separate betting client. No random-mode module.

---

## 8. Data model

### 8.1 Core tables

**users**  
`id`, `username`, `password_hash`, `display_name`, `is_admin`, `competition_id`, timestamps.  
Created only via admin API.

**refresh_tokens**  
Rotation-safe refresh sessions.

**competitions**  
`id`, `name`, timestamps.  
Grouping/visibility scope only — a competition partitions participants and their leaderboard/open-picks views. It carries **no** rule, scoring, or config overrides; all such data is global (§3.1). All competitions share the same tournament, teams, matches, matchweeks, scoring rules, and config.

**tournament_config**  
Key/value or JSON document for the **admin-editable** knobs only (the fixed rules in §3.9 are **not** stored here):

- `scoring_flags` (knockout time basis, etc.)
- `joker_inventory_defaults` per act: `{ weekly_swap, triple_boost, clean_sheet_shield, bench_boost }`
- `current_act` (`league_phase` | `knockout`)
- `deadline_drama_window_seconds` (UI-only; default 7200 = final 2 hours banner, §18.2)
- feature flags

Squad size (4), active clubs per week (3), the one-per-pot rule, and the 5-minute lock offset are **fixed domain constants** (§3.9), not config rows.

**tiers** (pots)  
`id`, `name` (`Pot 1`…`Pot 4`), `sort_order` (1–4).

**teams**  
`id`, `name`, `short_name`, `tier_id`, `external_id`, `is_active`, `crest_url`, `eliminated_at` (nullable timestamptz), optional country.

**matches**  
`id`, `external_id`, `stage`, `matchweek_id` (**FK → `matchweeks.id`**), `leg` (nullable int), `kickoff_at` (UTC `timestamptz`), `status`,  
`home_team_id`, `away_team_id`, scores + optional AET/penalty fields,  
`is_manual_override`, timestamps.

Every match references its matchweek by a real **foreign key** (`matchweek_id → matchweeks.id`), not a loose string. Sync ensures the target `matchweeks` row exists before upserting the match. Matchweek membership is defined by this **assignment**, independent of whether the match has been played (relevant for §4.5 postponed handling — an assigned-but-unplayed fixture still counts as “has a fixture this week”, so the club is not treated as a bye).

**matchweeks**  
Explicit registry:  
`id` (slug), `act`, `sort_order`, `label`, `status` (`upcoming` | `open` | `in_progress` | `complete`),  
`first_kickoff_at` (denormalized from matches; updated by sync),  
`completed_at` (set automatically when §4.6 holds).

Sync **creates/updates** `matchweeks` rows whenever fixtures for that slug appear or change (league MW1…N and each knockout leg). Implementers do not hand-maintain the registry beyond seed templates.

**scoring_rule_types** / **tier_scoring_rules**  
As in §4.2 (includes `league_top8_bonus`).

**team_selections**  
`user_id`, `team_id`, `tier_id`. Exactly `SQUAD_SIZE` (4) rows per user.

Pot-uniqueness cannot be enforced by a plain unique index on `team_id` alone (the pot lives on `teams.tier_id`), so **denormalize `tier_id` into this table** and add:

- unique `(user_id, team_id)` — no duplicate clubs;
- unique `(user_id, tier_id)` — at most one club per pot;
- a DB-level guard that `team_selections.tier_id` always equals `teams.tier_id` for that `team_id` (composite FK `(team_id, tier_id)` referencing a unique `(id, tier_id)` on `teams`, or a trigger). The write path (RPC / transactional service) sets `tier_id` from the team, never from client input.

**team_point_entries**  
`team_id`, `match_id`, `rule_type_id`, `points`, `source_key` (unique), metadata JSON.  
Definitive rows for finished matches only under Option A.

**matchweek_lineups**  
`user_id`, `matchweek_id`, `bench_team_id`, `captain_team_id`, timestamps.  
Unique `(user_id, matchweek_id)`.

**joker_types**  
`weekly_swap` | `triple_boost` | `clean_sheet_shield` | `bench_boost`

**joker_inventory**  
`(user_id, joker_type_id, remaining_count)` — reset on act transition.

**joker_activations**  
`id`, `user_id`, `matchweek_id`, `joker_type_id`, payload JSON, `created_at`, `cancelled_at` nullable.  
At most one **non-cancelled** activation per `(user_id, matchweek_id)` — enforced at **two** layers: (1) a **partial unique index** `UNIQUE (user_id, matchweek_id) WHERE cancelled_at IS NULL` so the DB physically rejects a second live joker for the same week, and (2) the `joker-service` checks/decrements inventory transactionally on activate. A cancelled activation (`cancelled_at` set) frees the slot so the user may activate a different joker before lock (§3.6, edge case §11.8).

Payloads:

- swap: `{ fromTeamId, toTeamId }`
- triple: `{}`
- shield: `{ teamId }`
- bench_boost: `{}`

**act_transfers**  
Model the grant explicitly:

| Column | Meaning |
|--------|---------|
| `user_id` | Owner (unique for the season grant) |
| `status` | `available` \| `committed` \| `expired` |
| `from_team_id` | Nullable until first commit |
| `to_team_id` | Nullable until first commit |
| `updated_at` | Last change while `available`/`committed` before lock |
| `locked_at` | Set when transfer window locks (`T0(M_ko1) − 5m`); status `available` → `expired` if never committed |

While status is `available` or `committed` and before lock, user may update `from_team_id`/`to_team_id` (same pot, destination not eliminated; pot must have at least one eligible club) **unless** a `weekly_swap` is active for the first knockout matchweek — then cancel swap first. On each successful apply, status becomes `committed` and **`team_selections` updates immediately**. At lock: if still `available`, set `expired`; if `committed`, freeze.

**player_matchday_scores**  
`user_id`, `matchweek_id`, `points`, `breakdown` JSON, unique `(user_id, matchweek_id)`.  
Rows are written when the matchweek is **complete** (final). Live provisional totals are **not** required to live in this table under Option A (§4.3).

**match_override_audits**  
`id`, `match_id` (FK), `admin_user_id` (FK), `action` (`override` | `clear_override`), `changed_fields` JSON (per field `{ from, to }`), `created_at` (UTC).  
Append-only; written on every manual match edit or flag clear (§5.3).

**sync_runs** / **sync_errors** (optional) for observability.

### 8.2 Derived views

- `team_total_points` — sum of definitive club entries (team pages).
- Leaderboard — sum of final matchweek scores + computed provisional for the in-progress week (Option A).

---

## 9. Backend responsibilities

### 9.1 Auth

- `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`
- **No** public `register`
- Access JWT short-lived; refresh httpOnly cookie with rotation
- Middleware: `auth`, `admin`, `participant`

### 9.2 Participant APIs

- Tournament status (locks, current act/matchweek, `T0` and lock countdown, act-transfer grant)
- List teams (pots, crests, eliminated flag)
- Get permanent squad (put only before selection lock, except act-transfer endpoint)
- Get/put matchweek lineup before that week’s lock
- Act transfer: get grant / update selection while window open
- Leaderboard; open picks after `T0(M)` (omit joker field when none)
- Player points + weekly wrap (wrap when `matchweeks.status = complete`)
- Briefing + risk map
- Fixtures + multi-live bundle
- Live delta / provisional hub summary
- Scoring rules matrix
- Jokers: inventory, activate, cancel (refund) before lock
- Season replay when tournament finished

### 9.3 Admin APIs

- Users CRUD (create participants) + assign competition
- Competitions CRUD
- Scoring rules editor
- Tournament config
- Trigger act transition helpers if auto-detect needs manual fallback (league complete should normally be automatic)
- Matches list + manual override
- Trigger sync; sync logs
- Full recalculate
- Joker inventory adjustments

### 9.4 Services

- `auth-service`, `selection-service`, `lineup-service`
- `scoring-engine` (club layer, finished)
- `provisional-scoring-service` (Option A drafts for live)
- `matchweek-scoring-service` (participant layer)
- `matchweek-lifecycle-service` (lock times, completion detection)
- `joker-service` (activate/cancel/refund, bench conflict → cancel)
- `act-service` (refresh inventory, act_transfers state machine, **award one-time `league_top8_bonus` at league completion**)
- `elimination-service` (set `teams.eliminated_at`, filter pickers)
- `briefing-service`, `score-provider`, `football-data-provider`, `score-sync-service`
- `leaderboard-service`, `tournament-config-service`, `season-replay-service`

### 9.5 Jobs

- Scheduled sync + matchweek completion + act transition when league phase matches all finished

---

## 10. Frontend surfaces

### 10.1 Participant

| Route | Purpose |
|-------|---------|
| `/` | Pre-lock squad CTA → matchweek hub → act-transfer CTA → season replay |
| `/kadro` | Permanent squad + crest wall |
| `/hafta` | Lineup, jokers, briefing, deadline drama, live tracker, deltas, wrap when complete |
| `/puan-durumu` | Leaderboard + open picks after `T0` |
| `/fikstur` | Multi-live + fixtures |
| `/kurallar` | Rules matrix + lineup/joker/act copy |
| `/oyuncu/:id` | Breakdown + wrap history |
| `/takim/:id` | Club matches/points |
| `/sezon` | Season replay |

**Hub must show:** crest wall (bench muted unless boosted + chip), lock countdown, briefing/risk map, bench/captain, joker controls with confirm-on-bench-conflict, multi-live, live deltas, provisional points, wrap card when complete.

### 10.2 Admin

- Users (create accounts), competitions, rules, config, matches/overrides, sync, recalculate, joker repair

UI copy may be Turkish; code identifiers in English.

---

## 11. Edge cases (must-test)

1. Swap to a club with no match that week → 0 from that slot.
2. Two matches in one matchweek for one club → sum both, then multipliers.
3. Captain ×2/×3 on negative week points → multiplies negative.
4. Captain on bench without bench boost → reject.
5. Bench boost + triple → all four score; captain ×3.
6. Shield GA=1 on a loss → loss points stand; CS bonus may apply; conceded suppressed.
7. Provider score correction after finish → recompute club + participants.
8. Second joker same week → reject; cancel then activate another → OK if before lock.
9. Cancel joker before lock → inventory +1.
10. Edits after `T0(M) − 5m` for week M → reject; edits for M+1 after `T0(M)` → allow.
11. Swap / act transfer across pots → reject.
12. Act transfer after knockout lock → reject; `available` → `expired`.
13. Weekly swap week ends → permanent (possibly eliminated) club returns to effective squad; scores 0 if eliminated.
14. Bench a shield target → confirm → joker cancelled + refunded.
15. Shield activate while target is benched → reject.
16. Open picks: no joker → no joker field.
17. Matchweek completes when all its matches are `finished` or `cancelled`; `postponed` blocks until played; postponed points stay on original matchweek.
18. Triple never ×6.
19. No self-register; no post-lock user creation for the season.
20. Eliminated clubs (league exit or knockout loss) hidden from swap/transfer pickers; empty pot → no transfer/swap in that pot.
21. Active weekly_swap blocks act-transfer edits until swap cancelled.
22. Clubs finishing league positions 1–8 receive a **one-time** `league_top8_bonus` at league completion; during play-off matchweeks these clubs have no fixture and score **0** (bye). Eliminated clubs receive no bonus.
23. Swap the roles of captain **X** (scoring) and bench **Y** → **Y** becomes captain, **X** goes to bench; a benched club is captain **only** under `bench_boost`.
24. `weekly_swap` out the captain club → incoming replacement inherits the captaincy (scoring); `weekly_swap` out the bench club → incoming becomes the new bench.
25. Edit squad (permanent selection before lock / `act_transfer` / `weekly_swap`) removing a club that has an active joker on it → confirm dialog → joker cancelled + refunded.
26. Initial Act I joker inventory is available **before** MW1 selection lock, so a joker can be activated for MW1.
27. Scoring seed direction: no reward rule gives a stronger pot more than a weaker pot; no penalty gives a weaker pot a harsher value (§16). Second live joker for the same week rejected by the DB partial unique index (§8.1).

---

## 12. Security and privacy

- Passwords hashed (bcrypt/argon2).
- Refresh token rotation.
- Admin UI behind obscure path + admin role on API.
- **Rate-limit login** per `(IP + username)` over a short sliding window (e.g. a handful of attempts per ~15 min). On limit, respond `429` with a `Retry-After` header and a clear "çok fazla deneme, X dakika sonra tekrar deneyin" message — **no permanent account lockout** (avoids trivial denial-of-service against a known username). Successful login resets the counter.
- Provider rate limits never reach end users: all provider calls are server-side and centralized; participant reads come from DB/cache only (§5.6). A user can never "hit" the football-data limit through normal use.
- Display names + opaque ids/slugs; no peer access to picks before `T0(M)`.
- Provider token server-side only.

---

## 13. Implementation phases

### Phase 0 — Bootstrap

- Monorepo, env samples, migrations, auth (login only), admin shell, healthcheck.

### Phase 1 — Domain skeleton

- Pots, 36 clubs, matchweeks registry, matches, config, permanent squad + selection lock, admin user create.

### Phase 2 — Club scoring + rules UI

- Rule types + admin editor; finished-match scoring; team pages.

### Phase 3 — Provider sync

- football-data.org sync, overrides, multi-live payloads, elimination flags when derivable.

### Phase 4 — Weekly lineup + matchweek scoring + locks

- Bench/captain; `T0 − 5m` lock; next-week editing after `T0`; crest wall; participant scores; **weekly wrap on auto-complete**.

### Phase 5 — Jokers + live provisional + hub chrome

- All four jokers; cancel/refund; bench-conflict confirm; open picks; deadline drama; briefing/risk map; **Option A provisional scoring** + live deltas.

### Phase 6 — Acts + full knockout path

- Auto league-complete → joker refresh + act_transfers state machine; play-off through final; per-leg matchweeks; medals/advancement; season replay.

### Phase 7 — Hardening

- Recalc reliability, observability, README, production deploy; final pot seed after official draw.

---

## 14. Acceptance criteria

1. Admin-created users can login; pick one club per pot (4); selection lock enforced; no self-register; no joins after lock.
2. Each matchweek: bench 1 + captain; three clubs score (four with bench boost); captain ×2 or ×3 with triple; integers only.
3. Edits for week M stop at `T0(M) − 5 minutes`; after `T0(M)`, week M+1 may be edited.
4. Sync drives scores; multi-live + live deltas work via provisional scoring (§4.3 Option A unless B chosen later).
5. At most one joker per week; cancel refunds; shield cannot sit on bench; bench conflict cancels+refunds with confirm.
6. Peers see open picks from `T0(M)`; if no joker, joker UI omitted.
7. Matchweek completes automatically when all its matches are finished or cancelled; postponed kept on original week; wrap card on complete.
8. League → knockout: mark league eliminations; jokers refresh; optional same-pot permanent transfer committed immediately, locked at first KO week lock; swap/act-transfer interaction per §3.6–3.7.
9. Full path in scope; one-time `league_top8_bonus` for clubs finishing league positions 1–8 (idle play-off weeks score 0, no per-week bye award); no qualifying; no betting; no random mode.
10. Crest wall + boosted chip; season replay; selection lock = MW1 lineup lock.

---

## 15. Open decisions (config / copy only)

- Exact joker inventory counts per act.
- Display strings for joker names (TR).
- Exact `league_top8_bonus` point values per pot (seed so a top-8 finish ≈ fair vs playing the play-off legs).
- One vs many competitions in production.
- Free-tier delayed live vs paid livescore.
- Final 2026–27 stage labels from UEFA.
- Risk-map weighting details.
- Escape hatch only: switch provisional path to Option B after load testing (§4.3).

---

## 16. Suggested default scoring seed (starting point only)

**Guiding principle (must hold for every reward-type rule).** Pot 1 = strongest clubs, Pot 4 = weakest. Because a result is *easier* for a stronger club and *harder* for a weaker one, **positive/reward** values must be **lower for stronger pots and higher for weaker pots** (ascending Pot 1 → Pot 4): `win`, `draw`, `clean_sheet`, and `league_top8_bonus`. **Penalty** values move the other way — a stronger club is punished *more* for a bad result (more negative for Pot 1, tending to 0 for Pot 4): `loss`, `goals_conceded`. `goals_scored` may stay flat. Any seed that gives a stronger pot a higher reward (or a weaker pot a harsher penalty) is a bug.

| Rule | Pot1 | Pot2 | Pot3 | Pot4 | Direction |
|------|------|------|------|------|-----------|
| win | 3 | 4 | 5 | 6 | reward ↑ (weaker more) |
| draw | 1 | 1 | 2 | 2 | reward ↑ |
| loss | -2 | -1 | 0 | 0 | penalty ↓ (stronger more) |
| goals_scored | 1 | 1 | 1 | 1 | flat |
| goals_conceded | -1 | -1 | 0 | 0 | penalty ↓ |
| clean_sheet | 2 | 2 | 3 | 3 | reward ↑ |

Illustrative `league_top8_bonus` (tune in playtest): Pot1→Pot4 = `6 / 8 / 10 / 12` — a **reward** rule, so it ascends like `win` (weaker pot = more). It is a one-time award roughly covering the two play-off matchweeks a top-8 club sits out, so finishing top-8 is not a dump period. Admin-editable.

Knockout `round_advance` / medal values: tune after league-phase feel is good.

---

## 17. Agent working instructions

1. This file is authoritative.
2. Ship vertical slices: squad → finished scoring → sync → lineup/locks → jokers/live provisional → acts/knockout.
3. Automate tests for §11.
4. Do not add betting, qualifying rounds, player fantasy, half-points, random mode, or self-registration.
5. Keep the score provider behind an interface; prefer provisional **Option A** (§4.3).
6. Document env vars in `README.md` (`DATABASE_URL`, `JWT_SECRET`, `FOOTBALL_DATA_API_TOKEN`, `ADMIN_PATH`, `CLIENT_ORIGIN`, etc.).
7. If UEFA’s final 2026–27 labelling differs slightly, adjust seeds/enums — keep the core loop: **4-club pot squad, weekly 3+bench+captain, 5-minute pre-kickoff locks, integer multipliers, jokers with cancel/refund, act refresh + transfer, full knockout path.**

---

## 18. Engagement feature specs

### 18.1 Matchweek briefing + risk map

Before lock on the hub: list the user’s four clubs’ fixtures (opponent, home/away, kickoff).

**Risk map:** per-club band `düşük` / `orta` / `yüksek` for fantasy danger (not a betting tip). Inputs shown as chips: opponent pot, home/away (optional later: recent CL form). Example: “Pot 4 deplasmanda Pot 1 → yüksek risk — bench adayı.”

### 18.2 Deadline drama

- Countdown to `T0(M) − 5 minutes`.
- Final **2 hours** before lock (config): stronger banner / dirty-form reminder.
- After lock: calm locked state.

### 18.3 Hafta kapanış kartı

When matchweek auto-completes (§4.6): week total, per-club lines (bench “puan yazılmadı” unless boosted; a bye club shows “maç yok — 0”; show `league_top8_bonus` line if awarded that week), captain/joker callout, rank delta. In-app only; share image optional later.

### 18.4 Open picks

From `T0(M)`: peers see bench, captain, and joker **if present**. No joker → show nothing for joker.

### 18.5 Multi-live tracker

All live CL matches; user clubs pinned; tolerate provider delay.

### 18.6 Anlık delta

Compact events from provisional + finished transitions, e.g. `+3 galibiyet`, `−1 gol yedi`, `kaptan ×2 → +6`. Scoped to the user’s scoring clubs. Mark provisional until match finished.

### 18.7 Crest wall

Four crests; bench muted **unless** `bench_boost` (then equal weight + **boosted** chip); captain badge.

### 18.8 Season replay

Final rank/total; best/worst week; joker usage; captain hit rate; act transfer committed vs expired; cumulative points timeline.
