# Working agreement for agents

Rules for any AI agent (or human) contributing to this repository. Read this
before making changes.

[PLAN.md](PLAN.md) is the authoritative product specification. When code and
PLAN.md disagree, PLAN.md wins. The only other way out is to change the plan on
purpose, in the open. It never just drifts.

## Documentation is part of the work

**Every change updates the documentation it affects, in the same commit as the
code.** Not at the end of the feature, not in a follow-up pass. The commit that
changes behaviour is the commit that fixes the prose describing it. A reader who
only has the docs should never be told something the code stopped doing.

What to touch:

- **[PLAN.md](PLAN.md)**: §0 for what is built, deliberately deviating, or not
  built yet; §13 Phase 7 for what remains; the relevant spec section when the
  rules themselves change; §14 when a change adds an acceptance criterion.
- **[README.md](README.md)**: the status paragraph, setup or run steps, scripts,
  environment variables, and repository layout.
- **This file**: when a working convention changes.
- **`.env.example`**: whenever a new environment variable is read.

A change that is genuinely invisible to all four (an internal refactor with no
behaviour change) needs no doc edit, and inventing one is worse than none.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope):
subject`.

- **Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `perf`, `test`
- **Scopes:** `server`, `client`, or omit when a change spans both
- **Subject:** lowercase, imperative, no trailing period
- **Body:** explain *why* and what changed in behaviour, in plain prose

### Never hard-wrap the body

**Each paragraph is a single line.** Separate paragraphs with a blank line. Do
not wrap at 72, 80 or any other column. Editors and review tools wrap for us,
and hard wraps make later edits and diffs messy.

```
feat(client): put joker actions on every lineup slot

Replace the separate joker panel with buttons on the club cards themselves. Pitch clubs offer triple captain, clean-sheet shield and weekly swap; the bench slot offers bench boost.

Once a joker is live only its own button remains, highlighted on the slot it applies to, and clicking it again cancels and refunds.
```

The same body hard-wrapped, which is wrong:

```
Replace the separate joker panel with buttons on the club cards themselves.
Pitch clubs offer triple captain, clean-sheet shield and weekly swap; the
bench slot offers bench boost.
```

### Other commit rules

- **No `Co-Authored-By` trailers**, and no "generated with" footers.
- Prefer prose paragraphs over bullet lists in the body. A list is fine only
  when the change really is a set of unrelated items.
- Describe behaviour, not file names. The diff already says which files moved.
- Group related work into one commit; split unrelated work into separate ones.

## Git workflow

- **Work directly on `main`.** Do not create feature branches.
- **Commit only when asked.** Leave changes in the working tree otherwise.
- History rewriting is acceptable while nothing has been pushed; confirm first
  once the remote has commits.

## Design

The sibling project `../world-cup-prediction` is the design reference for both
the participant and admin interfaces.

- **Dark only.** There is no light theme and no theme switch. Inputs, dropdowns,
  dialogs and toasts all have to stay legible on the dark surface.
- Style through the CSS variables in `client/src/styles/main.css` and the
  PrimeVue preset in `client/src/theme/preset.ts`. Avoid one-off colours.
- PrimeVue is the component library; override its tokens rather than fighting
  it. Icons come from `@lucide/vue`.
- **This is a game, not a dashboard.** Lean on the pitch metaphor, motion and
  the Champions League marks in `client/src/assets`. Prefer direct manipulation
  (drag a club to the bench) over forms and buttons.
- Interactions save on their own. Do not add a separate "save" button for a
  choice the user already made.
- Responsive down to phone widths; the hamburger menu is mobile-only. A table
  wider than the screen sits in a `.table-scroll` box, so the page itself never
  moves sideways.
- **Direct manipulation has to work with a finger.** The `draggable` attribute
  and its drag events never fire on touch, so drags go through
  `client/src/composables/usePointerDrag.ts`: a mouse picks the card up after a
  few pixels, a finger after a short hold, and drop targets mark themselves with
  `data-drop-zone`. A drag is never the only way to reach a move either. Every
  one of them also has a button on the card that does the same thing.

## Copy

- The game speaks **Turkish and English**. Code identifiers, comments and
  commit messages are **English** whatever the interface says.
- **No string a person reads is written where it is used.** Interface copy
  lives in `client/src/i18n/{tr,en}.ts`; anything the API produces in words
  (error messages, and the labels it derives rather than stores) lives in
  `server/src/i18n/messages.ts`. Both catalogues carry the same keys, and a
  change to one is a change to both in the same commit.
- Turkish is the fallback. A key missing from English falls back to it, which
  is a bug to fix rather than a feature to lean on.
- The two languages are written, not translated. Say the same thing the way
  each language would say it; a sentence that reads like a translation is
  wrong even when every word is right.
- Write like a person. No filler that states the obvious ("Değişikliklerin
  anında kaydediliyor"), no robotic explanations, no internal jargon or spec
  section symbols in the interface. If a label already says what a thing is,
  the sentence under it can go.
- **No em dashes, and no swapping one for a semicolon.** A sentence built
  around a dash reads like a machine wrote it, and putting a semicolon in the
  same slot just gives you a machine sentence with a semicolon in it. Rewrite
  the thought instead. Two short sentences beat one long one nearly every
  time, and the clause on the far side of the dash usually turns out not to be
  worth keeping.
- **Keyboard characters only, in interface strings and in code.** A hyphen
  `-`, a straight apostrophe `'`. No en dash, no minus sign, no curly quotes:
  editors flag them as look-alikes and nobody reading the app can tell the
  difference anyway. Ranges are `2026-27` and `9-24`; an empty cell is `-`.
- Nothing stays in English in the interface just because English is what we
  call it in the code. Sync is "skor çekme", an override is "elle girilen
  skor", the mock provider is "simülasyon". Never print a raw enum value
  (`finished`, `football_data`, `success`) where a person will read it.
- The player is addressed as **sen** everywhere, error messages included, and
  as plainly in English. The rules page is the one exception in both: it
  explains the game the way a rulebook does, in the passive voice ("seçilir",
  "kilitlenir", "iade edilir") and impersonally in English.
- The language belongs to the account, not the browser: it is a column on
  `users`, so a switch on a phone shows up on the desktop. `localStorage` and
  the browser's own setting only cover a session that has not signed in yet.

## Testing

- The repository owner runs the browser tests. Explain what to click and what
  to expect rather than driving the UI.
- Agents are still responsible for verifying their own work: `npm run typecheck`
  and `npm run test` on the server, `vue-tsc` and a build on the client, plus
  API-level checks against a running server where behaviour is non-obvious.
- Cover domain rules with unit tests. The pure logic in `server/src/domain`
  should be testable without a database, and stay that way.

## Code

- Migrations in `supabase/migrations` are forward-only and immutable once
  applied. Add a new one instead of editing an old one.
- The structural constants in `server/src/domain/constants.ts` (squad size, one
  club per pot, the five-minute lock) are fixed rules, not settings. Never move
  them into admin config.
- Scoring is integers only, and rule values are per pot.
- Keep the score provider behind the interface in
  `server/src/services/score-provider.ts` so the data source stays swappable.

## Feedback loop

`.claude/notes.md` collects the owner's running notes and complaints. Read it,
work through the items, and fix them in focused commits.
