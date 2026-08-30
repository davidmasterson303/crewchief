# Runbook — put Well Kept on `crewchief.davidmasterson.co`

**For: Cowork.** Everything here is browser work in David's own accounts. Nothing
in this runbook touches the repository — the app-side change is Claude Code's and
is described at the end so you know what you are unblocking, not so you do it.

**Status: interim.** David expects to move Well Kept to a different domain before
launch. Do not buy a domain, do not rename anything, and do not tidy up adjacent
DNS records. This is the smallest change that gets a real hostname in front of
the App Store listing.

---

## Why this is being done

The mobile app builds its Terms and Privacy links from one setting, `apiBaseUrl`,
which currently reads `https://effulgent-blancmange-6adfdf.netlify.app`. That
host **works** — both `/privacy` and `/terms` return 200, so Apple's requirement
is already met. This is not a compliance fix.

It is a credibility fix. That string appears in the App Store listing's privacy
policy URL and in every in-app legal link, and it reads as a preview deploy
because it is one.

---

## ⚠ The one thing that can go wrong, read this first

`davidmasterson.co` **is already live and already on Netlify.** Its apex resolves
to `75.2.60.5`, and the response carries a `server: Netlify` header. That is
David's personal site, and it is a *different* Netlify site from Well Kept.

So:

- **Do not touch the apex `@` record, and do not touch `www`.** Changing either
  takes the personal site down. You are adding one new record for one new
  subdomain, alongside what is already there.
- **Do not add `crewchief.davidmasterson.co` to the personal site** in Netlify.
  It goes on the Well Kept site — the one that serves
  `effulgent-blancmange-6adfdf.netlify.app`. Confirm you are on the right site
  before adding anything; the site list will show the generated URL.
- If Netlify offers to **manage DNS for the whole domain** (it will suggest
  moving nameservers to Netlify DNS), **decline it.** DNS is at Namecheap —
  the nameservers are `dns1.registrar-servers.com` / `dns2.registrar-servers.com`
  — and moving the zone is a much larger change than this task, affecting the
  personal site and any email on the domain. A CNAME is all that is needed.

---

## Steps

### 1. Add the domain alias in Netlify

1. Netlify → **Sites** → open the site whose URL is
   `effulgent-blancmange-6adfdf.netlify.app`. Verify the URL before continuing.
2. **Domain management** → **Domains** → **Add a domain**.
3. Enter `crewchief.davidmasterson.co` exactly. Subdomain only — not the apex.
4. Netlify will detect that it does not control the domain's DNS and show the
   record to create. It will normally ask for a **CNAME** pointing at the site's
   Netlify hostname. **Write down the exact target it gives you** — use its
   value, not the one guessed in step 2 below, if the two differ.

### 2. Create the record at Namecheap

1. Namecheap → **Domain List** → `davidmasterson.co` → **Manage** →
   **Advanced DNS**.
2. **Add New Record**:
   - Type: **CNAME Record**
   - Host: `crewchief`  ← just the label, not the full hostname
   - Value: the target Netlify gave you, expected to be
     `effulgent-blancmange-6adfdf.netlify.app`
   - TTL: **Automatic**
3. Save. Leave every existing record alone.

### 3. Let the certificate issue

Back in Netlify → **Domain management** → **HTTPS**. Netlify provisions a Let's
Encrypt certificate automatically once the CNAME resolves. This is usually a few
minutes and can take up to an hour.

If it does not appear, use **Verify DNS configuration** / **Renew certificate**
rather than removing and re-adding the domain.

---

## How you know it worked

All three must be true:

1. `https://crewchief.davidmasterson.co` loads Well Kept — **not** David's
   personal site, and not a Netlify 404.
2. `https://crewchief.davidmasterson.co/privacy` returns **200** and shows the
   privacy policy.
3. `https://crewchief.davidmasterson.co/terms` returns **200** and shows the
   terms.

Then re-check the thing you must not have broken:

4. `https://davidmasterson.co` still loads David's personal site.

⚠ Certificate warnings count as failure. A hostname serving the right content
over a bad certificate is worse than the Netlify URL, because the app will
refuse the connection outright rather than degrade.

---

## What to report back

- Whether all four checks above pass.
- The exact CNAME target Netlify asked for, if it was not
  `effulgent-blancmange-6adfdf.netlify.app`.
- Whether Netlify pushed to take over the domain's DNS, and confirmation that
  you declined.

---

## What happens next, so you know where the line is

Once the hostname is live, **Claude Code** changes one line —
`expo.extra.apiBaseUrl` in `apps/mobile/app.json` — from the Netlify preview host
to `https://crewchief.davidmasterson.co`, and verifies both legal links from the
app.

⚠ That setting is **not only** the legal links: it is the base URL for every API
call the phone makes. It cannot be changed until the new hostname is serving the
app over a valid certificate, which is exactly what this runbook establishes. So
please do not edit `app.json`, and do report back rather than assuming the
handover happened.
