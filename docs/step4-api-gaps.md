# The three API gaps behind the designed screens — proposals, 15 Aug 2026

Design specced three things §0.16 records the endpoints as unable to feed.

Written as proposals because the roadmap asks for the shape first. **Since
then, one turned out not to be a gap at all (§1) and one has been built (§2).**
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

**There is no way to add a vehicle photo from the phone, and it is not a missing
button.** `uploadVehiclePhoto` is a Next server action on the cookie session;
there is no bearer-capable route, so mobile has nothing to point a CTA at.
Adding one is a new endpoint plus a picker — `expo-image-picker` is already
installed and `media/pick-invoice-image.ts` is the template — at roughly 1 ed.
**Web's CTA is fine, including on touch**: `@media (hover: none)` pins the photo
overlay visible, so the M235i re-upload can be done in a browser today.

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

## Order I would build them in

1. **Nothing** — #1 is already served; the hero just needs drawing, and David
   needs to re-upload one photo.
2. **#3**, because it is half a day and unblocks a designed row.
3. **#2**, last, because the "compute or generate" decision changes what gets
   built and the follow-on question about `health_score` deserves a real answer
   rather than a default.
