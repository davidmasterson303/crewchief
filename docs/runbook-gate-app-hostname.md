# Runbook — put `crewchief.davidmasterson.co` behind the release gate

**For: Cowork.** Netlify dashboard only. No repo changes — the code side is
Claude Code's and is already committed.

**What changes:** which Netlify project serves the hostname. **The hostname
itself does not change**, so nothing in the mobile app, the App Store listing or
DNS needs editing. `app.json` already points at `crewchief.davidmasterson.co`
and stays exactly as it is.

---

## Why

Answering Cowork's own Q13. Right now `crewchief.davidmasterson.co` is served by
the project that builds `main`, so **anything pushed to `main` is instantly live
at the URL App Review reads** and at the URL every installed copy of the app
talks to. That is the wrong risk profile for a store listing, and Q13 is right
that it is far harder to change after submission.

`crewchief-demo` already builds `demo-live`, which only moves through
`scripts/promote-demo.mjs` — a gate that typechecks, runs both suites, verifies
the candidate build, the share card, the demo contract and a live consultant
round trip *before* anything is published. Putting the App Store hostname behind
that gate reuses machinery that already exists and is already trusted.

---

## ⚠ Verify this is still true before you start

Checked 17 Aug and it is what makes the move a no-op rather than a deploy:

- `crewchief-demo.davidmasterson.co/api/version` → `demo-live`, commit
  `85775e48`, which is a merge **containing** `b9f804e9`.
- `crewchief.davidmasterson.co/api/version` → `main`, commit `b9f804e9`.
- Both answer `POST /api/v1/consultant` with a real 200 in ~5s, so the demo
  project has working Gemini and Supabase credentials — not just static pages.

Main has moved one commit since (`94c40d4`), and it touched only mobile files
and a test, so the **deployed web app is identical on both**. If
`/api/version` now shows a bigger gap, say so and stop — a promote should
happen first so the move stays a no-op.

---

## Steps

1. Netlify → **Sites** → the **`crewchief-demo`** project (the one whose URL is
   `crewchief-demo.netlify.app`). Confirm under *Build settings* that it deploys
   the **`demo-live`** branch before continuing.
2. **Domain management** → **Add a domain** → `crewchief.davidmasterson.co`.
   Netlify will report it is already in use by another site and offer to move
   it. Accept that — moving is the intent.
3. Go to the **`effulgent-blancmange-6adfdf`** project and confirm
   `crewchief.davidmasterson.co` is **gone** from its domain list, and that its
   own `*.netlify.app` URL is primary.
4. Certificate: the new project needs its own Let's Encrypt cert for this
   hostname. Netlify usually issues it automatically; if not, use **Verify DNS
   configuration** / **Renew certificate**.

⚠ **Do not touch DNS.** The CNAME at Namecheap already points at Netlify and
does not care which project serves it. Decline any DNS-takeover offer, as before.

---

## How you know it worked

1. `https://crewchief.davidmasterson.co/api/version` reports **`branch:
   "demo-live"`** — the single decisive check.
2. `https://crewchief.davidmasterson.co/privacy` and `/terms` still return 200
   on a valid certificate for that hostname.
3. `https://crewchief-demo.davidmasterson.co` still works — it is the same
   project, now serving two names.
4. `https://effulgent-blancmange-6adfdf.netlify.app` still returns 200 and
   reports `branch: "main"`. It stays the promote gate's candidate target and
   must keep working.
5. `https://davidmasterson.co` still serves the personal site.

⚠ A certificate warning on the new hostname counts as failure and is worse than
not moving: the mobile app will refuse the connection outright rather than
degrade, and every API call it makes will fail.

---

## What this changes for everyone afterwards

**A promote is no longer only a demo update.** After this, `promote-demo.mjs`
publishes the API that the shipped mobile app talks to. Same gate, higher
stakes — worth knowing before running it casually to show someone a new screen.

**And the app now depends on promoted routes.** A mobile build that needs a new
`/api/v1/*` route must have that route promoted first, or it will call an
endpoint that is not there yet. Claude Code has written that rule into
`apps/mobile/src/config.ts` and into the promote script's own output.
