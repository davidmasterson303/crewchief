# ⚠ SUPERSEDED — do not follow this runbook

**Written 17 Aug, retracted the same day, before anyone acted on it.**

It told Cowork to move `crewchief.davidmasterson.co` onto the `crewchief-demo`
project so the App Store hostname would sit behind `demo-live`. **Following it
now would undo a better fix that is already applied**, and would collapse two
gates that exist for different reasons.

## What is true instead

`NETLIFY_DEPLOY_COST_FIX_2026-08-17.md` (Cowork) reached the same goal by a
better route, from evidence this runbook did not have: the Netlify bill. The
production branch on `effulgent-blancmange-6adfdf` was changed from `main` to
**`web-live`**, so:

```
effulgent-blancmange-6adfdf   deploys web-live    crewchief.davidmasterson.co
crewchief-demo-live           deploys demo-live   crewchief-demo.davidmasterson.co
```

Nothing deploys from `main`.

## Why that is better than what this file proposed

**It keeps the two gates separate.** This runbook would have put the App Store
hostname and the recruiter demo on one branch, so promoting the demo to show
someone a new screen would also have moved the API under every installed app.
The last section of the original file flagged that coupling as something to
revisit later; the applied fix simply does not create it.

**It also fixes the bill, which this runbook did not know about.** 111 builds in
17 days on that one site — 1,665 credits, 99% of a $34 month against a $9 plan.
A hostname move would have left the deploy-on-every-push behaviour intact.

**It is a dropdown, not a DNS change.** Lower risk, and reversible in one step.

## What Claude Code did instead

- Created `web-live` from `main` and pushed it — without it the hostname stays
  frozen on whatever last published.
- Repointed the promote gate's candidate: the gate verifies the exact build
  about to become the demo, which needs that commit live somewhere, and the site
  that auto-deployed `main` no longer exists. The order is now
  `main → web-live → verify → demo-live`.
- Corrected `apps/mobile/src/config.ts` and `CLAUDE.md`, which had said
  `demo-live` for a day.

Kept rather than deleted, because "a written fix is not a shipped fix" cuts both
ways: a retracted runbook that silently disappears is one somebody finds in
their history and follows.
