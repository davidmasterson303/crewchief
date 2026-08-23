# Design system ↔ build: drift register

**Raised:** 23 Aug 2026, against the `CrewChief Design System` export (readme v8,
`tokens.json` v6.0.0 generated 8 Aug).

This file exists because of a standing instruction from David:

> the mobile details in current design system need to be adhered to, unless
> we're intentionally overriding, in which case we need to inform Design to
> update design system (ie need build and design system to avoid drift)

So: **§1 is for Design to resolve** — places the export contradicts *itself*, which
the build cannot settle unilaterally. **§2** is what the build changed to match the
system. **§3** is where the build knowingly differs, with the reason, for Design
to either bless or overrule. **§4** is the state of the export's own lint rules.

Every claim below was checked against the artefact — the spec file, the token
file, or the live database — rather than read off a summary. Where something was
not checkable, it says so.

---

## 1. The export contradicts itself — Design's call

These are not build decisions. In each case two files in the same export give
different answers, and an implementer reaching for the obvious one gets the
wrong value.

### 1.1 The filled primary. `tokens.json` is two versions stale — ⚠ highest impact

| Source | Fill | Ink | Stated ratio |
|---|---|---|---|
| `tokens.json` → `color.brand.button` | `#0891B2` | `#06181C` | — |
| `readme.md` → Overrides table | **`#0E7490`** | **`#F2FBFD`** | 5.36:1 |
| Shipped in `apps/mobile/src/theme` | `#0E7490` | `#F2FBFD` | 5.10:1 measured |

`tokens.json` carries a `$rule` explaining that white on `#0891B2` measures
3.68:1 and fails AA — so it is aware of the problem and still ships the failing
fill as the token. The readme's override table supersedes it and the app
implements the readme.

**Why this one matters more than the others:** `tokens.json` describes itself as
*"the real RN-consumable token layer, with adoption rules"*, and the readme says
it *"shipped for real — claimed since v2, never present"*. It is the file an
implementer is told to import. It is also the only file in the export a build
could consume mechanically, and it is the one that is wrong.

**Ask:** regenerate `tokens.json` at v8, or mark it superseded in the index.

### 1.2 `semantic.attention` has collided with the health ramp

| Source | Value |
|---|---|
| `tokens.json` → `color.semantic.attention.default` | `#FB923C` |
| Shipped `status.attention` | `#E0A468` |

`#E0A468` is **the health band's `warn` hex**, from `color.health.bands` in the
same token file. So the shipped app uses one value for two things the system
explicitly separates — `$rules.semanticsAreNotShared` is in `tokens.json` and
says the ramps are separate on purpose.

**Ask:** which is the attention colour? If it is `#FB923C`, the app has a real
fix to make. If the collision is intended, the rule needs an exception written
into it, because as stated the code is violating it.

### 1.3 The text ramp is built on a different white

| Token | `tokens.json` | Shipped |
|---|---|---|
| `text.primary` | `#F5F3F0` | `#F5F3F0` ✅ |
| `text.secondary` | `rgba(245,243,240,0.72)` | `rgba(255,255,255,0.72)` |
| `text.muted` | `rgba(245,243,240,0.5)` | `rgba(255,255,255,0.5)` |

The app's primary ink is the warm off-white and its secondary and muted inks are
pure white at the same alphas — so the ramp changes hue as it gets quieter. The
token file is self-consistent; the app is not.

**Ask:** confirm the warm base, and this becomes a two-line change plus a
re-measure. Both directions still clear AA, so nothing is failing today — it is
a coherence defect, which is exactly the class the token layer exists to close.

---

## 2. Brought into adherence, 23 Aug

Recorded so Design can see the specs are being implemented rather than
reinterpreted.

| Spec | What changed |
|---|---|
| `native-vehicle-detail` — *"a hub, not tabs"* | Vehicle detail is now photo → identity → score → recall → one list of destinations → one filled primary. The health drivers, the score history and the build dial left the screen and became pushed routes. |
| `native-vehicle-detail` — *"one filled primary per screen, and it is this one"* | "Ask the advisor" is the only filled control. The recall banner is a card affordance. |
| `native-vehicle-detail` — subtitle *"61,240 mi · xDrive"* | The odometer moved from a "Details" card five rows down into the identity line. |
| `native-vehicle-detail` — *"2 open recalls / One is a fuel pump that can cut power"* | The banner names the worst open recall instead of describing itself. |
| `native-recall-detail` — *"Find a dealer near me" / "Mark as repaired"*, above the explanation | Both built. `/api/v1/recalls` is new; `recall_actions` already existed and web already wrote to it. |
| `progression-ladder` — rows with role, difficulty and the sentence | The ladder now renders `nextRungs`' full output. It was rendering `rungs[0].role` and discarding name, purpose, difficulty and rationale. |
| `native-wishlist` — *"a count that disagrees with what is on screen…"* | The recall chip counts what the recall screen will actually draw, minus what the owner has marked. |
| `native-add-vehicle` — VIN leads, year/make/model under an *"or"* | Was a collapsed "Have the VIN?" row above a primary year/make/model form. Now inverted to match. |

---

## 3. Deliberate differences — for Design to bless or overrule

### 3.1 Two routes the hub spec does not list

`native-vehicle-detail` names five destinations: RecallDetail, Wishlist,
InvoiceScan, ServiceMilestone, Advisor. The build adds **Health** and **Build**.

Both are the spec's own logic applied one step further: the drivers and the
chart needed room to explain themselves, and the build could not be made useful
in a card — which is the case David made directly ("let's make Build its own
page that you tap into, so we have real estate to house the functionality we
want"). If the hub is right, these are hub rows; the spec simply predates the
question.

### 3.2 Recall banner position — followed the spec, flagging the counter-argument

The spec's order is score → recall banner. The shipped code had the banner
**first**, with a comment arguing that a recall is the one time-critical thing
on the screen and that burying it under the mileage inverted the screen's
priorities. `native-recall-detail` separately says *"critical outweighs
attention … so a scan lands on red first."*

The build now follows the spec. Both orderings keep the banner above the fold.
**Design should confirm** — this is the one place where two of the system's own
statements point in different directions and the build picked one.

### 3.3 `native-add-vehicle`: "Scan an invoice instead" is **not built**

The spec puts it beside the VIN field, on the reasoning that a typed VIN and a
scanned one are the same fidelity and the scan returns the service record in the
same pass.

Not a disagreement — a sequencing constraint. It needs vehicle extraction with
no vehicle to attach to; `/api/v1/upload-document` requires a `vehicleId` and
authorizes against it. That is a new route, and per `CLAUDE.md` §8 a mobile build
depending on a new route has to wait for a `web-live` promote. It is queued with
the VIN-storage change so one promote carries both.

### 3.4 The garage bay carries one reading, not two

`native-garage-bay` shows **Health** *and* **Build / Modified** side by side on
the bay. The build ships Health only.

Deliberate, and the reason is data rather than design: `modification_tracking`
holds **no rows anywhere in the product** — re-confirmed against the live
database on 23 Aug — so a Build reading on the garage home screen would say
"Stock" on every car, for every user, permanently. It is on the Build route
where there is room to explain what that means.

### 3.5 The bay's photo treatment is not verifiable from the export

The garage bay spec is a live prototype; the text extraction carries its
content, not its geometry. The build moved the bay photo from a 112pt inset
panel to a full-bleed hero (168–240pt, clamped to window height) using
**contain-over-blur**, lifted from web's `VehicleIdentity` rather than invented.

Flagging rather than claiming drift: **Design should check the prototype against
the built screen**, because a 112pt room and a full-bleed hero are different
designs and only one of them is in the repository.

### 3.6 Icons: Lucide geometry, no Lucide package

The rule is *"real Lucide icons only · no emoji, no glyph stand-ins"*. There is
no icon package in `apps/mobile`. The one mark the app needs — a disclosure
chevron — is drawn in `react-native-svg` from **Lucide's own path**
(`m9 18 6-6-6-6`), unmodified.

Complies in geometry, not in dependency. When a second icon is needed,
`Chevron.tsx` becomes `Icon.tsx` with a path map, which is the point at which
adding the package should be reconsidered.

### 3.7 No spec exists for the typeahead

`Suggest` — a text field with an inline suggestion panel — was added on 23 Aug
for make/model/year on the add-a-car screen. There is no spec for it.

Design note worth carrying into one: it is deliberately **a field with a list**
and not a picker, because a picker asserts its list is complete and neither the
make catalogue nor NHTSA's model list is. Every field still accepts free text.

---

## 4. The export's five adherence rules, against what this repo already runs

`specs/adherence-rules.spec.html` proposes five oxlint rules and says *"ship them
into `.oxlintrc.json` in the app repo"*. Four already have Jest equivalents that
run on every `npm test`; they are scans rather than lint rules, which the spec's
own argument permits — *"a rule a build enforces is a rule"*.

| Proposed rule | Status here |
|---|---|
| `cc/no-color-literal` | ✅ `lib/__tests__/mobile-color-literals.test.ts` |
| `cc/type-floor` | ✅ `lib/__tests__/mobile-type-floor.test.ts` |
| `cc/touch-target-floor` | ✅ `lib/__tests__/viewport-floors.test.ts` (mobile side); the wrapped-row qualifier is enforced by review, not by the scan |
| `cc/hover-parity` | ✅ `lib/__tests__/inclusive-affordances.test.ts`, `touch-parity.test.ts` |
| `cc/md-without-sm` | ⬜ **not automated.** RB0 rule 1 is documented and unchecked |
| `cc/container-scale` | ⬜ **not automated.** RB0 rule 2, same |

Two additional scans exist that the spec does not propose and that have caught
real defects: `mobile-font-faces.test.ts` (a `fontWeight` with no `fontFamily`
renders San Francisco, not Inter — silently) and `mobile-busy-controls-named.test.ts`
(a control that swaps its label for a spinner loses its accessible name). Both
fired during this session's work. Worth adding to the system's rule set.

---

## 5. One thing the system got right that the build had lost

Not drift — a note, because it is the kind of finding that argues for keeping
this file.

`GarageBay` has drawn a "next service" row since it was built, and every car in
the product rendered its **unknown** branch. The component's docblock said the
migration adding `next_service_*` was *"written and not applied, verified against
the live database"*.

That was true when written and had stopped being true. The columns are applied
and carry data — the 2003 Accord reads `Engine Oil and Filter Change` at 170,000
miles. What was actually missing was the **route's column list**: neither
`GARAGE_COLUMNS` nor `VEHICLE_COLUMNS` selected them, so the payload never
carried an answer.

Fixed on 23 Aug. The note that named the wrong blocker is corrected in place —
a docblock pointing at a migration that already ran sends the next reader to
write it again.
