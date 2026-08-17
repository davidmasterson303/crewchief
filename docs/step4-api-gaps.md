# The three API gaps behind the designed screens — proposals, 15 Aug 2026

Design specced three things §0.16 records the endpoints as unable to feed.

Written as proposals because the roadmap asks for the shape first. **Since
then: §1 turned out not to be a gap at all, §2 and §4 are built, and §3 is the
only one still open.** §4 was not in the original three — it was found on 16 Aug
while looking at the advisor, which is the reason the title says three and the
document has four.

Each section says which it is at its heading; where the built shape differs from
the proposed one, both are kept so the change of mind is readable.

Every claim below was checked against the live database with
`SUPABASE_SECRET_KEY`, not read off a migration. `supabase/migrations` and the
live schema drift in both directions here, and the roadmap's own standing rule
is to read the artefact rather than the source.

---

## 1. `photo_url` on the vehicle-detail payload — **already there**

⚠ **This is not an API gap.** `app/api/v1/load-vehicle/route.ts` resolves
`custom_image_url` through `resolveVehiclePhoto` and returns
`vehicle: { ...vehicle, photo_url }`. It has done since `2eb172a`.

What is actually missing is on the client, and it is deliberate —
`VehicleDetailScreen.tsx` says so in its own header: *"This screen deliberately
does not draw that photo yet."*

**So the 196pt photo hero is unblocked and needs no server work.** It is screen
work, and it belongs with the plinth in step 4's deferred half rather than on
this list.

### ⚠ Two things found on 15 Aug when David opened the app

**The mobile fallback was a placeholder, not a design.** The garage card
rendered a grey box reading "No photo". Web settled this in CC-142 — the
no-photo state is a deterministic make-derived field with the car named on it —
and mobile never got it. Now built as `VehiclePlate`, with the field coming from
`vehicleFieldStops` in core so a make is the same colour on both clients.

**There was no way to add a vehicle photo from the phone — ✅ built 15 Aug.**
`uploadVehiclePhoto` is a Next server action on the cookie session, so there was
no bearer route and mobile had nothing to point a CTA at. `POST
/api/v1/upload-photo` is that route, on `upload-document`'s shape: authorize
through `lib/api-auth` for the **status code**, then delegate to the action.
The picker seam widened rather than multiplying — `media/pick-image.ts` is still
the only module importing `expo-image-picker`.

⚠ **One limit, and it is a decision waiting for David.** The web path downscales
in the browser before upload; the phone has no canvas and **`expo-image-manipulator`
is not in this build**, so it can only lower encoder quality (0.45) and cannot
cap a dimension. A 12MP capture lands under the 1.5 MB ceiling in the ordinary
case — but that is a probability, not a guarantee, so the flow is built to fail
legibly: the server returns its refusal with the numbers in it and the garage
shows that sentence.

**Raising the ceiling is not the fix.** It exists because this account still
holds a 2.3 MB original that has never decoded on a device; raising it
reintroduces that bug for the next car. The guarantee costs
`expo-image-manipulator` and **one of the month's cloud builds**.

**Web's CTA was never broken, including on touch**: `@media (hover: none)` pins
the photo overlay visible.

One real caveat, and it is the one that stopped the garage card: the signed URL
points at the **original** upload. `VehiclePlate`'s `PHOTO_TIMEOUT_MS` comment
documents a 3000×4000 / 2.3 MB object that never decodes on device. New uploads
cannot repeat it — `47af5c4` put a 1.5 MB ceiling at the one upload chokepoint —
but the M235i's existing photo is still that file. A 196pt hero pointed at it
will show the fallback, not a photo, and that will read as a bug in the hero.

**The fix is thirty seconds of David's time, not engineering: re-upload the
M235i photo in the web app and it downscales on the way in.**

---

## 2. The health card's three score drivers — ✅ **built 15 Aug, computed**

**What exists.** `vehicle_health_summary` carries `health_score`,
`maintenance_status`, `recall_status`, `issues_overview`, `recommendations`.
Confirmed live, all twelve columns.

**Why it does not satisfy the spec.** `maintenance_status` and `recall_status`
are *free-text prose written by the model*, not sub-scores. The three live rows
read:

> "Several intervals coming due. Prioritize CVT fluid and brake fluid."
> "Open recall: Engine bearing assembly - check for completion."

There is no numeric maintenance score, no recall score, and **no mileage-load
field of any kind**. The card's three drivers cannot be derived from what is
stored, and they cannot be parsed out of the prose without inventing precision.

### ✅ What was built — and it is not what this section proposed

David chose **compute** on 15 Aug. Building it changed the shape, and the change
is worth stating rather than burying:

**No migration. No stored columns. The drivers are derived at read.**

`packages/core/src/health-drivers.ts` computes all three, and
`app/api/v1/load-vehicle/route.ts` returns them as a top-level `health_drivers`
array. Every input was either already on that response or is one extra row.

The proposal above wanted three integers on `vehicle_health_summary`, written by
the nightly sweep. That was wrong for the same reason the generated option was
wrong, one step down: **stored numbers need a writer, go stale between sweeps,
and can disagree with the schedule they were derived from.** A driver that
contradicts the service list two cards below it is worse than no driver.

| Driver | Computed from | When it cannot be scored |
|---|---|---|
| **Maintenance** | `evaluateSchedule` over the knowledge base's schedule and the vehicle's line items, weighted by the priority the KB already assigns | No schedule on record → `null` |
| **Recalls** | `nhtsa_data(recalls)`, already embedded, through `normaliseRecalls` so NHTSA's severity flags are read correctly | Embed absent → `null`. **Absent is not empty** |
| **Mileage load** | `current_mileage` against model-year age at the 12,000/yr US average | Missing odometer or year → `null` |

**Cost:** one extra query on a single-vehicle detail read, issued in parallel
with the two that were already there. ⚠ **The garage list must not copy this** —
that is exactly the per-row cost §3 argues against.

### The four judgements inside it, and why each went the way it did

- **`null`, never 0, for anything unmeasured.** The rule the garage card already
  follows for a missing health score.
- **An `unknown` service costs nothing.** A time-only service with no date to
  count from is a gap in *our records*, not a fault in the car. Charging for it
  would let a car with no invoices score worse than one with a genuine overdue
  brake fluid. The gap is reported in the driver's sentence instead.
- **A do-not-drive recall is capped, not scored.** No amount of otherwise-good
  news may lift that card out of the alarming range.
- **The mileage ramp is gentle.** 12k/yr lands at 85, 30k at 40. A steeper one
  made an ordinary high-mileage car read as a wreck. ⚠ It is linear and floors
  at about 3.8x the average; above that it stops discriminating.

### ⚠ Still open, and it is yours

**The drivers do not add up to `health_score`, and the card must not imply they
do.** `health_score` comes from the model; these do not. A reader shown three
numbers next to a total will expect them to explain it.

Defensible for one release, awkward forever. Whether `health_score` eventually
becomes a function of the three is a product decision — the module's header
carries the warning until it is taken.

**Not built:** the health card itself. That is screen work in step 4's deferred
half, and the endpoint now feeds it.

---

## 3. Next service on the garage list payload — the expensive one

**Why it is not there.** `GARAGE_COLUMNS` selects from `vehicles` plus two
embedded one-to-ones. The maintenance schedule is not in either — it lives in
`vehicle_knowledge_base.maintenance_schedule`, a JSON dossier, and the garage
list does not join that table at all.

**Why the obvious fix is the expensive one.** Adding
`vehicle_knowledge_base(maintenance_schedule)` to the embedded select pulls the
whole schedule array for **every car in the garage**, on every list load and
every pull-to-refresh, to render one line of text per card. Today that is one
real vehicle and the cost is invisible. At ten cars it is ten dossiers over a
mobile connection for ten short strings.

### Proposed shape — store the answer, do not ship the inputs

Two columns on `vehicles`, written when the schedule is evaluated rather than
read:

```
next_service_label     text         -- "Engine oil and filter"
next_service_at_miles  integer      -- the odometer reading it falls due at
```

Then `GARAGE_COLUMNS` grows by two scalars and the payload grows by about forty
bytes a row. No join, no dossier, no per-row work.

**Where they get written.** `notify-sweep` already runs nightly, already loads
each vehicle's schedule, and already calls `evaluateSchedule` — the numbers are
computed there and thrown away. Writing them back is a few lines inside a job
that is already doing the work.

⚠ **The staleness this accepts, stated plainly.** The value is as fresh as the
last sweep, so a mileage update entered at noon shows yesterday's next service
until 17:00 UTC. On the garage *summary card* that is fine — it is a glance, and
vehicle detail computes live from the real schedule. It would not be fine on a
screen that told someone whether to drive the car.

**The alternative if that is unacceptable**: a `garage_next_service` view that
does the join server-side. It moves the cost rather than removing it, but the
freshness is exact. I would not start there.

**⚠ There is also a coverage question**: `vehicle_knowledge_base` has a row for
some vehicles and not all, and `C4`'s lazy regeneration branch **has never
executed** — the one real car already had a schedule. A car with no schedule has
no next service, so the card's third row needs a defined empty state before this
is worth building. "No schedule yet" is not the same as "nothing due", and the
card must not imply the second.

**Estimate:** ~0.5 ed for the migration, the sweep write-back and the two
columns. The empty state is a design question, not engineering time.

---

## 4. The advisor's estimate — ✅ **built 16 Aug** (found the same day)

§0.16 flagged three. There is a fourth, and it is the reason the `Well`
primitive still has no caller.

**What the board specifies.** Screen 04 is the advisor, and its own summary
line is *"Answers are unboxed; **the estimate is a well**; provenance is a
claim, never a badge."* The drawn screen carries a structured estimate:

> Estimated, for this vehicle in your area:
> Fluid flush — $110 – $160
> Master cylinder, if needed — $380 – $520
> Most likely total — $110 – $160

**What the API returns.** `POST /api/v1/consultant` responds with exactly
`{ sessionId, response, contextKinds }`. `response` is **prose**. There is no
structured estimate on either client — web's `CostEstimateBreakdown` is fed by
`QuoteDetailDialog` from the quote flow, not by the advisor.

So the estimate well cannot be built. Parsing ranges back out of the model's
prose is the obvious shortcut and it is the wrong one: this codebase's standing
position is that it does not invent precision, and a mis-parsed dollar range
shown as a priced line item is exactly the overclaim the provenance work exists
to prevent.

### The pieces already exist, which makes this smaller than it looks

`packages/core/src/advice-range.ts` already holds `AdviceRange`,
`widenToHonestSpread`, `formatRange` and `positionAgainstRange`, and
`quote-check.ts` uses them for the front door. None of it is wired into the
consultant's response.

### ✅ What was built, and the one place it differs from the proposal

**Proposed shape:** an optional
`estimate?: { lines: Array<{ label: string; range: AdviceRange }>; likely: AdviceRange }`
alongside `response`.

**Built shape:** the same, except **`likely` is optional too, and it is not a
total.** That change is worth stating rather than burying.

The board's own example prices two lines at $110–$160 and $380–$520 and then
gives "Most likely total" as **$110–$160**. The second line is "Master
cylinder, *if needed*", and the likely case is that it is not. Summing the lines
would charge the owner for every contingency the advisor was careful to mark as
one — turning a considered answer into a worst case and reporting it as the
expected one. Only the model knows which lines are conditional, so only the
model can say this, and when it does not say it the field is absent. The screen
labels it **"Most likely"**, never "Total", so a reader who adds up the rows and
gets a different number is seeing the feature rather than a bug.

**How the numbers travel:** tags, on the pattern `consultant-commands.ts`
already established — `[ESTIMATE: label|low|high]` per line and an optional
`[ESTIMATE_TOTAL: low|high]`. `packages/core/src/consultant-estimate.ts` parses
them and `app/actions.ts` strips them from the prose alongside the wishlist and
status tags.

**Three judgements inside it:**

- **`widenToHonestSpread` is applied at the parse boundary**, not in the
  renderer, so every reader of a `ConsultantEstimate` gets an honest spread
  without having to ask. A range of $1,000–$1,010 claims 1% precision that no
  estimate from a language model over an unseen job has.
- **A line label is advice copy** and runs through `statesVerdict`. "Fluid
  flush, they're overcharging" set in a styled panel next to a price is a
  statement about a named local business — the exact exposure `cc-design-0003`
  exists to prevent. The line is dropped, not the whole estimate.
- **Parsed outside the `!isDemoVehicle` block.** Everything in that block
  writes; this only reads the answer already given. A stranger trying the demo
  car sees the same estimate an owner would, rather than the well becoming a
  paid feature by accident.

⚠ **Optional remained the load-bearing part.** Most advisor answers are not
quotes. The route omits the field rather than sending `[]`, the mobile client
narrows it to `undefined` rather than an empty shell, and the screen renders
nothing at all — a well showing no lines, or a total of $0, on ordinary advice
would be the product asserting a price it never inferred.

**`Well` now has its caller**: `apps/mobile/src/components/EstimateWell.tsx`.
Its header has been corrected — it said "no caller yet, and that is not an
oversight", which stopped being true the moment this landed.

⚠ **Still open, and it is a product call.** The board's copy reads "Estimated,
for this vehicle **in your area**". This app has no location — the consultant
prompt receives no postcode and no region — so the phrase is dropped rather
than defaulted, the same rule `describeQuote` already follows. Adding it back
means collecting a location, which is a product decision and not a small one.

⚠ **And one thing no test can settle:** whether the model actually emits these
tags well. The parser, the widening and the well are all verified; the quality
of the numbers is a prompt question that needs real answers looked at. The
plumbing was the smaller half, as predicted — the estimate of ~1 ed was right
about where the work was.

---

## Where this stands, 16 Aug

**#3 is the only one left**, and its blocker is not engineering time. The
migration adding `next_service_label` and `next_service_at_miles` is written and
**unapplied**, deliberately: nothing selects those columns yet, and the coverage
question in §3 has to be answered before the row is worth drawing. A car with no
`vehicle_knowledge_base` entry has no next service, and *"No schedule yet"* is
not the same as *"nothing due"* — the card must not imply the second. That empty
state is a design question.

Two things carried over that are David's rather than mine:

- **The M235i's photo** needs re-uploading through the web app, which downscales
  it on the way in. Thirty seconds, and it is what unblocks the 196pt hero
  reading as a photo instead of a fallback (§1).
- **Whether `health_score` should become a function of the three drivers** (§2).
  Defensible for one release that it is not; awkward forever.

The original order — build #3, then #2, then nothing for #1 — is left below for
the record, since #2 was in fact built first and the reasoning for that ordering
turned out not to survive David choosing "compute".

<details>
<summary>The order as first proposed, 15 Aug</summary>

1. **Nothing** — #1 is already served; the hero just needs drawing, and David
   needs to re-upload one photo.
2. **#3**, because it is half a day and unblocks a designed row.
3. **#2**, last, because the "compute or generate" decision changes what gets
   built and the follow-on question about `health_score` deserves a real answer
   rather than a default.

</details>
