# Read this before touching anything

This file is loaded automatically at the start of every session. The two files
it points at are not, which is exactly why this one exists: the working
agreement used to live only in `AGENTS.md`, and a rule nobody loads is a rule
nobody follows.

@AGENTS.md

## The short version, in case the import above ever fails

1. **[PLAN.md](PLAN.md) is the product spec and it is authoritative.** When the
   code and the plan disagree, the plan wins, unless the plan is being changed
   on purpose in the same commit.
2. **[AGENTS.md](AGENTS.md) governs how to work**: commit format, git workflow,
   design language, copy rules, testing split.
3. **No commit that changes behaviour ships without the doc edit that describes
   it.** PLAN.md first, then README.md, AGENTS.md and `.env.example` as they
   apply. Same commit, not a follow-up pass. A `pre-commit` hook in `.githooks`
   checks this and refuses commits that skip it.
4. **`.claude/notes.md` is the owner's running list of complaints.** Read it,
   work through it, one focused commit per item.
