# Working rules for this repo

Short on purpose. These are the rules that have already cost time — each one is
here because it was learned expensively, and each names where the evidence is.

Everything else lives in the code: this repo's docblocks carry the reasoning,
and they are the primary documentation. `docs/roadmap.md` is a plan of record,
not a rulebook.

---

## 1. Verify against the artefact, never the board

The roadmap drifts in both directions and has been wrong in every direction
available:

- It **contradicted itself** — its status section said RP2 was closed while
  every one of that block's item bodies still read as open, three as CRITICAL.
  Someone scanning for the next CRITICAL would have rebuilt a consultant layout
  that already carried an `R4.` comment explaining its own fix.
- **"David's list"** carried two dead instructions: `brew install cocoapods`
  (never possible on this machine) and a metering migration that had been
  applied for a fortnight — under a ⚠ heading calling it the item that gets
  worse by waiting.
- A **docblock cited a test file that has never existed**
  (`cluster-geometry.test.ts`). The guard is real and lives in
  `build-progress.test.ts`. Checking the claim and finding nothing nearly
  produced a "fix" the same paragraph asks you not to make.

So: read the code, query the database, hit the endpoint. Then fix the board —
a stale board is not neutral, it buys work that is already done and hides what
is left.

## 2. The database and the migrations folder disagree, both ways

Never state what the schema does from a file read. Query it:

```
SUPABASE_SECRET_KEY from .env  →  PostgREST at NEXT_PUBLIC_SUPABASE_URL
```

⚠ The `SERVICE_ROLE` key in `.env` is stale and 401s. `SUPABASE_SECRET_KEY` is
the one that works. PostgREST cannot see `information_schema` and there is no
`exec_sql` RPC, so grant-level facts need the SQL editor — which is David's.

A column that does not exist returns `42703`. That is the cheapest applied/not
check there is.

## 3. Only the diff proves the commit

Running the suites proves your **working tree**. It says nothing about what you
committed.

⚠ `git add` fails **atomically**: one unmatched pathspec and *nothing* is
staged. A `git commit` with no pathspec after that takes whatever happened to be
staged before. That shipped a "verified" commit containing 4 of 21 files, and
left `main` importing packages absent from `package.json` — unbuildable on a
fresh clone — for four commits.

- Always `git commit -- <explicit paths>`; it takes the working-tree state of
  those paths regardless of staging.
- Never send `git add` errors to `/dev/null`.
- `git status --porcelain` empty afterwards is the actual proof.

## 4. Another session shares this working tree

Commit with a pathspec so you cannot take someone else's work. **Never stash.**
Check `git worktree list` before assuming work is missing — a day's work was
once found stranded in one.

## 5. Check what a guard actually asserts, not that it is green

Every one of these passed while checking nothing:

- `expect(gauge).toContain('A ${R} ${R}')` matched the **template text**, so it
  passed for any value of `R`. The web dial could have moved to 68 while staying
  green.
- A scan anchored to `.tap-target-44` found the string in a **comment 600 lines
  above the rule**.
- A suite whose walker silently returned nothing reported a clean app forever.

So every scanner here carries an anti-vacuous case ("can still detect one") and
an assertion that it found sources at all. Add both.

⚠ And a guard that cries wolf is worse than none: a spurious failure on an
invisible rule gets *made to pass*. When one fires, first ask whether it is
right — `file:text-sm` styles a file-picker button, not a field.

## 6. The defects that matter here are silent

Prefer the loud failure. The expensive bugs in this codebase have no error:

- **React Native does not synthesise font weights.** `fontWeight: '600'` without
  a `fontFamily` renders San Francisco, not semibold Inter. Half-applied, it
  reads as a design choice. See `lib/__tests__/mobile-font-faces.test.ts`.
- **Forced colors overrides SVG fill and stroke.** The dial once showed a full
  ring at every score — it did not break, it lied. Rename a `.gauge-*` class and
  the stylesheet keeps reviewing perfectly while applying to nothing. See
  `inclusive-affordances.test.ts`.
- **A monitor that is not running reads as good news.** See rule 7.
- `null` is never `0`. A missing score, odometer or schedule is "we cannot say",
  and must never render as a reading.

## 7. Scheduled things need checking that they are scheduled

- **GitHub Actions only fires `schedule` from the default branch.** The
  consultant canary sat on a side branch and had never run once — visible in
  `ai_usage_events` as `surface = 'canary'` rows on exactly two days.
- **Secrets are usually needed in two places**, and setting one looks done.
  `CONSULTANT_HEALTH_SECRET` is required as a GitHub Actions secret *and* as a
  Netlify env var, with matching values.
- The nightly sweep is a **Netlify scheduled function** (`0 17 * * *`), not
  Actions. Confirm it ran by looking at `recall_notifications.notified_at`.

## 8. There are two Netlify projects, and the names invite the wrong guess

```
effulgent-blancmange-6adfdf   deploys web-live    crewchief.davidmasterson.co
                                                  App Store URL + the app's API
crewchief-demo-live           deploys demo-live   crewchief-demo.davidmasterson.co
glowing-hotteok-d2e57e        deploys main        davidmasterson.co (personal)
```

**Nothing deploys from `main`.** Pushing to `main` costs nothing and publishes
nothing; both CrewChief hostnames move only when someone merges into their
release branch. That is a **gate, not a filter**, and it was chosen over an
ignore rule for a reason worth keeping: a filter fails silently toward stale
deploys, an ignore rule needs an inverted exit code to be right, and one
`netlify.toml` is shared across sites. The gate is a dropdown with no silent
failure mode. `demo-live` had been running the pattern correctly all along —
9 builds against 111 from the same commit stream.

This is a **promote gate**, not drift: `scripts/promote-demo.mjs` is the only
way `demo-live` moves, so what is public is deliberately behind `main`. Run the
dry run first; it verifies the exact build that is about to become public.

⚠ **`crewchief.davidmasterson.co` is gated behind `web-live`** — it is the App
Store listing's privacy-policy URL and the origin the mobile app talks to
(`app.json` → `extra.apiBaseUrl`). Before that, anything pushed to `main` was
instantly live at a URL App Review reads, and every push cost a build: 111
builds in 17 days, 99% of a $34 bill.

Two things follow, and both are workflow rules rather than trivia:

- **A promote publishes the API shipped apps depend on.** It is not a cosmetic
  act; do not run it to show someone a new screen.
- **A mobile build needing a new `/api/v1/*` route must be promoted first**, or
  it ships calling an endpoint that is not there — a 404 on a path that exists
  perfectly well on `main`, which is the most confusing shape a bug can take.

⚠ After promoting, `/api/version` reports the **merge commit** on `demo-live`,
never the `main` commit named in the message. Checking for the latter and
concluding the deploy failed has already cost real time.

## 9. Costs are bounded, and builds are scarce

- EAS: ~15 iOS cloud builds a month. **JS changes are free**; a native module
  costs a build. Check whether a dependency is already transitive before
  assuming a build is needed — `expo-font` was, so bundling Inter cost nothing.
- **CocoaPods cannot be installed on this machine** (Ruby 2.6 vs ≥3.0, no
  Homebrew). Never propose it. EAS cloud builds route around it.
- Cap every spending path, and make exhaustion degrade the feature rather than
  break it.

## 10. Do not invent precision

The product's standing position, and it is load-bearing in the copy as well as
the code: ranges over verdicts, `unknown` over a guessed default, and no claim
the data cannot support. Recalls match on **year/make/model, not VIN** — saying
otherwise tells an owner their specific car is clear when only its model was
checked. `advice-range.ts` carries the full argument.
