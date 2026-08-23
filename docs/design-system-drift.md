# Design system ↔ build: drift register

**Raised:** 23 Aug 2026 · **last updated:** 23 Aug, after Design's rulings.

**⚠ Before reading a value out of any export, check `$meta.version`.** Design
added `$meta.$selfCheck` — six identifying values — for exactly this, because a
stale copy is otherwise invisible: a v2 file says `#0B0E12` where v8 says
`#100F0D`. The copy this repository was last shown stamps **6.0.0**; Design has
shipped **8.1.0**. Anything below marked ⬜ was not verifiable against that
newer file.

This file exists because of a standing instruction from David:

> the mobile details in current design system need to be adhered to, unless
> we're intentionally overriding, in which case we need to inform Design to
> update design system (ie need build and design system to avoid drift)

So: **§1** is the three conflicts and how each was settled — one fixed in the
export, one fixed in the app, one accepted with its reasoning written down.
**§2** is what the build changed to match the specs. **§3** is where the build
knowingly differs, with the reason, for Design to bless or overrule. **§4** is
the state of the export's own lint rules.

Every claim below was checked against the artefact — the spec file, the token
file, or the live database — rather than read off a summary. Where something was
not checkable, it says so.

---

## 1. The three conflicts — resolved 23 Aug

Design's rulings came back the same day. Two were the export's to fix, one was
mine to fix, and one was accepted rather than fixed.

⚠ **The export in this machine's Downloads still stamps `$meta.version` 6.0.0.**
Design has shipped 8.1.0. So §1.1 and the wording changes in §1.2 are recorded
here **as reported, not as verified** — checking them needs the new zip. This is
the first use of the rule Design added for exactly this: check `$meta.version`
before copying anything out of a token file. It took two seconds and stopped a
stale copy being read as current.

### 1.1 The filled primary — fixed in the export ⬜ not yet verified here

`tokens.json` never received the pairing the readme's override table decided. It
kept `#0891B2` and the stale `$rule` justifying it, so **the file that calls
itself the real token layer was arguing against the readme.**

Now `button: #0E7490` / `onBrandFill: #F2FBFD`, carrying a `$pairing` note
stating that the fill and the ink move together or not at all, and a `$citation`
recording that 5.36 was measured against pure white.

The app already shipped that pair, so there is nothing to change here — the
error was that an implementer importing the token file would have got the
failing one.

### 1.2 The collision was real, and it was in the **app**, not the export ✅ fixed

I reported this as a conflict between the export and the app. Design's read is
sharper and correct: **the export never had them equal.** `semantic.attention`
has always been `#FB923C` and the health ramp's `warn` has always been
`#E0A468`. What collides in the *system* is the **word** — the `warn` band
abbreviates to "Attention", so a reviewer meets that word twice in two different
ambers and reasonably reads one as a bug. Both families now carry an
anti-collision note naming both hexes.

**What that leaves is a real defect in this repository**, and it was worse than
one token:

| Token | Was | Is | Note |
|---|---|---|---|
| `status.attention` | `#E0A468` | **`#FB923C`** | `#E0A468` *is* the health ramp's `warn`. Live in eight places. |
| `status.critical` | `#E08882` | **deleted** | `#E08882` *is* the ramp's `bad`. **Zero call sites** — the critical chip reads `dangerText` (`#F87171`, already the system's value). |
| `status.attentionWash` | `rgba(251,191,36,…)` | `rgba(251,146,60,0.14)` | amber-400 was a **third** amber in the family; chips drew orange type on a yellow tint. |
| `status.attentionWashBorder` | `rgba(251,191,36,0.35)` | `rgba(251,146,60,0.35)` | follows the ink. |

The docblock above those tokens said they *"happen to share hues with two
bands"*. They did not share hues — they were the same hex, and the sentence
asserting otherwise sat directly above the values. That is the shape §5 of
`CLAUDE.md` is about: a claim that stops the next reader checking.

Design's reason is the argument for fixing it rather than documenting it: *a
gauge reading and a status chip are different claims, and sharing a colour makes
a 61 look like something you can dismiss.* The garage bay had it live — a dial
reading in warn amber, with a recall chip beside it in the same amber the dial
uses for Critical.

`status.critical` was **deleted rather than recoloured**. A dead token holding a
colliding hex is how a collision comes back.

⚠ **Now guarded.** `lib/__tests__/status-ramps-distinct.test.ts` fails if any
status ink equals any health band hex, and separately if the attention wash
drifts off the attention ink's hue. It samples the ramp through `healthBandHex`
rather than a private table, and carries its own anti-vacuous case. Mutation-
tested: restoring `#E0A468` fails it with *"status.attention (#E0A468) is the
health ramp's warn"*.

The solid banner pair (`attentionFill` `#4A3308` / `attentionBorder` `#854D0E`)
is deliberately exempt and stays — this app's own measured values, with white
already measured on them, documented at the token.

### 1.3 The text ramp — accepted, not fixed ✅ closed

Design's ruling, and it is better than the fix I proposed. Every step below
primary is `#F5F3F0` at an alpha, so **hue holds at ~36° but chroma collapses
under 2%**: quiet text composites to neutral grey, not warm. Now documented in
the export with the composited values.

The reason not to substitute a solid warm hex is the one that already made
`border.field` translucent: a hex sampled against one surface goes wrong on the
other four. Nothing to change in the app.

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
| `native-vehicle-detail` — the hub's **rows** | ⚠ Rebuilt 23 Aug after David's *"still really bad UI and UX, ugly and uninviting"*. The first attempt fixed the ink ramp and shipped no icons. Reading the **rendered** spec rather than its text: every row carries a Lucide mark, the group is an inset block with the label *outside* it, and the dividers are inset to the label column. All three now match. |
| `icons` — *"real Lucide icons only"* | `Icon.tsx` ports the export's own path map to `react-native-svg`. Geometry copied unaltered, per that component's rule: *"do not redraw or approximate."* |
| `native-wishlist` — the whole screen | Was a free-text box. Now the summary line, divided rows with neutral-unless-urgent chips, and Add in the nav bar. |
| `native-wishlist` — suggestions | New `WishlistAddScreen`: the three knowledge-base sources as a filterable catalogue with Add and Learn more per row. |

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

### 3.7 The wishlist spec's own render disagrees with its own note ⚠ Design

Not a build decision — a defect **inside** `native-wishlist.spec.html`, and it
is the one the spec's own note warns about.

The note reads: *"The total sums to $4,980 and the four rows are all four rows.
Stated because this system has shipped 'Wishlist · 4 items' over three rows
before; a count that disagrees with what is on screen is the fastest way to lose
a user's trust in every other number."*

The render above it shows **three rows**, headed **`4 ITEMS · ESTIMATED $4,180`**.
The three visible prices sum to $4,660. The note is right — $1,140 + $2,200 +
$1,320 + $320 is $4,980 with the Charge pipe row included — so the render is
missing a row *and* carries a total that matches neither count.

The build follows the note, not the render: the count and the total are derived
from the same array in one pass, which is the only version where they cannot
disagree.

**Ask:** re-render the spec. It is a small thing, and it is the exact failure the
spec exists to prevent, in the spec.

### 3.8 Buttons are pills on native, not `radius.md`

The system's five-step radius map assigns `full` to chips, filter pills, status
badges and avatars, and `md` to buttons. **Every native spec draws a full-width
primary as a pill** — the vehicle hub's "Ask the advisor", the recall screen's
two actions, the wishlist's add.

The build now follows the native specs, so `Button` is `radius.pill`. A 12pt
corner on a 52pt-tall full-bleed control reads as a web form submit; the phone's
idiom is the pill.

**Ask:** confirm the map should carry a native exception, or that the native
specs should be redrawn at `md`.

### 3.9 No spec exists for the typeahead

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
