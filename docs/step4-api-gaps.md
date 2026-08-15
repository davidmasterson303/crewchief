# The three API gaps behind the designed screens — proposals, 15 Aug 2026

Design specced three things §0.16 records the endpoints as unable to feed. Each
is proposed here rather than built, because the roadmap asks for the shape
first and because **one of the three turns out not to be a gap at all**.

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

One real caveat, and it is the one that stopped the garage card: the signed URL
points at the **original** upload. `GarageScreen`'s `PHOTO_TIMEOUT_MS` comment
documents a 3000×4000 / 2.3 MB object that never decodes on device. New uploads
cannot repeat it — `47af5c4` put a 1.5 MB ceiling at the one upload chokepoint —
but the M235i's existing photo is still that file. A 196pt hero pointed at it
will show the fallback, not a photo, and that will read as a bug in the hero.

**The fix is thirty seconds of David's time, not engineering: re-upload the
M235i photo in the web app and it downscales on the way in.**

---

## 2. The health card's three score drivers — a real gap, and the largest

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

### Proposed shape

Three integers on `vehicle_health_summary`, on the same 1–100 scale as
`health_score`, nullable:

```
maintenance_score  integer  CHECK (BETWEEN 1 AND 100)
recall_score       integer  CHECK (BETWEEN 1 AND 100)
mileage_load_score integer  CHECK (BETWEEN 1 AND 100)
```

Returned by adding them to the two existing embedded selects — one string each
in `load-vehicle/route.ts` and `vehicles/route.ts`. **No new query and no new
round trip**, because the table is already joined on both endpoints.

### The decision this needs from David, and it is not a small one

**Where do the three numbers come from?** Two answers, and they are different
products:

| | The model produces them | The server computes them |
|---|---|---|
| **How** | Add three fields to the health-summary prompt | `evaluateSchedule` already grades every interval; recalls are a count; mileage load is `current_mileage` against `avg_miles_per_month` and age |
| **Cost** | Nothing per row — same call, longer response | Nothing per row for maintenance and recalls. Mileage load is arithmetic |
| **Honest?** | ⚠ A model asked for a number will produce one whether or not it has grounds. The prose above is a judgement about real data; a 73 would be a judgement about nothing | Yes. Every input is a fact the database holds |
| **Consistent with the sub-scores summing to the whole?** | No guarantee | Yes, if `health_score` is later derived from them |

**Recommendation: compute them.** Two of the three are already computable from
code that exists — `packages/core/src/service-due.ts` grades intervals today and
`nhtsa_data(recalls)` is a count. Only mileage load is new, and it is a formula
rather than a judgement.

The reason is the one this codebase keeps returning to: the product's claim is
that it shows you *why*. A driver score the model invented cannot be explained
when the owner taps it, and the health card's whole purpose is to be tapped.

⚠ **This also raises a question the card will make unavoidable**: if three
drivers are shown next to a total, a reader will expect them to explain it. They
will not, because `health_score` comes from the model and these would not. That
is defensible for one release and awkward forever. Worth deciding now whether
`health_score` eventually becomes a function of the three.

**Estimate:** ~1 ed for the migration, the two selects and the mileage-load
formula, *if* the answer is "compute". Roughly double if the score has to be
re-derived from the drivers at the same time.

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
