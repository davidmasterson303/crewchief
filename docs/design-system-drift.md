# Design system ↔ build: drift register

**Raised:** 23 Aug 2026 · **last updated:** 23 Aug, after Design's rulings and
the v8.3 ten-screen UI review (§2b).

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
| `native-hero-pullback` — the whole screen | The vehicle hero is pinned at 62% of the display with the sheet rising over it. Four planes in render order (never `zIndex`), the dial climbing at 1.6× so it docks before the sheet edge arrives, and a crossfade to a nav chip rather than a shrink. Constants mirrored into `theme/hero-motion.ts` from `tokens/hero.css`. |
| `native-hero-pullback` §4.4 — the compact branch | Below a 500pt hero the dial drops to `card` @104 in a 124pt plinth and the title to 28pt. Only the 4.7″ display takes it; the mini clears by 3pt. |

---

## 2b. The v8.3 UI review, 23 Aug — what landed and what did not

A full ten-screen review came back the same day this file was raised. Its
findings are cited by number throughout the code (`R1`, `R28`, `R57`…) so the
argument sits beside the change rather than in a document that drifts from it.

**Three of the four ship blockers were real, and the fourth was not in the app.**

- **R1** — the dev access-token block on the garage. Already `__DEV__`-gated and
  already guarded; the placement was the finding. Moved to `Account`.
- **R2** — a floating gear on every screen. **Not in the app** — see §3.18.
- **R3** — the health verdict contradicting the service history. **Real, and
  confirmed against the live database**: the M235i's summary row was generated
  30 Jul, its five line items were filed 6 Aug, and `last_generated` is a
  `2000-01-01` sentinel. Nothing on the mobile read path recomputes, so it had
  been stale for three weeks with no mechanism that would ever fix it. The
  screen no longer presents an out-of-date verdict as a current one; the
  recompute itself is §6 below.
- **R12** — back buttons reading `‹ VehicleDetail`. Real, and caused by
  `headerShown: false` landing on 23 Aug with no `title` beside it. Fixed, with
  a guard.

**Two findings did not reproduce**, and both are recorded rather than quietly
dropped: R2 above, and R5's contrast claim (§3.22 — measured on every surface,
nothing off-token).

**R44 also did not reproduce.** The build dial's redline *is* painted on the
unlit face from 82 to 100 at `--build-redline-track`'s 0.22, exactly as
specified — visible at a reading of zero. It is faint by design, which is
presumably why a screenshot read as missing it.

**R23 likewise.** `HeroBed` is present, it is the fixed contrast floor the hero
title sits on, and it is a **sibling** of the scaled photograph rather than a
child — so the pullback's transform cannot take it with it.

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

### 3.10 The docked chip's arc — `variant="row"` differs between the two systems ⚠ Design

`HERO_PULLBACK_PROMPT.md` §4.4 specifies the docked chip as *"a 26pt arc
(`variant="row"` geometry, no needle, no readout) plus the numeral at 16pt"*,
and §6 says not to change `ClusterGauge`'s internals because *"you need
`variant="hero"` at a custom `size` and `variant="row"`; both already exist."*

They exist, but this repo's `row` is **text only** — a 30pt numeral over a 12pt
verdict, no arc at all. It is that way because of `DIAL_MIN`: *"below this a
dial stops being a dial. Under ~88pt the ticks stop resolving and the instrument
is decoration."* A 26pt `ClusterGauge` resolves to `row` and returns two lines
of text at the wrong size for a nav bar.

The build draws the arc in `DialChip` from `@wellkept/core/cluster-geometry` —
the same `TRACK` path and viewBox the real dial uses, so it cannot drift — and
does not touch `ClusterGauge`. `DIAL_MIN` is not being dodged: that floor
governs a dial somebody reads a value *from*, and this arc has no needle, no
ticks and no readout by design, with the numeral beside it carrying the value.

**Ask:** either the design system's `row` variant should be reconciled with this
one, or the chip's spec should stop naming `row` and describe the mark directly.

### 3.11 The hero's settings control has no destination ⚠ Design

`native-hero-pullback` and `native-vehicle-detail` both draw a settings gear at
the hero's top right, and §4.6 lays the nav row out around it — *"left of the
settings control, at `right: 56`"*.

There is no vehicle-settings screen in the app and nothing for that control to
open. The build ships the back pill and the score chip and leaves the slot out
rather than shipping a gear that does nothing.

**Ask:** what does it open? If it is the account surface, that already lives one
tap from the garage and duplicating it here needs an argument; if it is
per-vehicle settings, that is a screen nobody has specified.

### 3.12 Buttons on native are pills, and the hero made that visible

Already logged at §3.8 and repeated here only because the hero pullback is where
it shows: every native spec draws the full-width primary as a pill, and the
system's radius map assigns `md` to buttons. `Button` is `radius.pill` on
native.

### 3.14 The hero dial is removed ⚠ Design — this is a real departure

`native-hero-pullback.spec.html` is built around the health dial's flight: it
belongs to neither plane, climbs at 1.6× so it docks before the sheet edge
arrives, and crossfades to a nav chip. That is the spec's hardest idea and the
one the exploration got wrong twice.

**It is gone.** David, 23 Aug, after using it on a device:

> we can lose the dial with health score overlaying car image. The animation is
> fun but info is redundant and it might cover important part of car image
> people care about.

Both halves hold. The redundancy was partly self-inflicted — the health card
gained its own reading earlier the same day, so the score appeared three times —
but the covering is the deciding argument: the photograph is the only place in
the product an owner sees their own car, and a 160pt plinth sat over the
roofline of most 3:4 phone snapshots. An instrument that obscures the subject it
reports on has its priorities inverted.

What went with it: `HERO_DIAL_RATE`, `dialFlight`, `dialClearsSheet`, the
crossfade, and **the layering invariant** — the regression test that caught the
bug the design itself had twice. There is no travelling instrument left to
collide with the sheet, so those guards would be assertions that can never fail,
which reads as coverage and is not.

What remains is the pullback: a pinned hero drifting at a third of scroll speed
under a rising sheet, the score persisting as the nav chip.

**Ask:** the spec should either drop the dial's flight or state where a score
belongs when the photograph is the hero. The compact branch survives on its own
merits — it still sizes the title — but its dial half is dead.

### 3.15 The wishlist's Add lives in two places, by state

`native-wishlist.spec.html`: *"Add is in the nav bar, not a floating action
button."* On an **empty** list that leaves a 22pt glyph in the corner as the only
way in, which David flagged as the wrong resolution of a redundancy I had fixed
backwards.

Now: empty list → the empty state's filled button, and the nav `+` stands down.
Populated list → the `+`, and no empty state to compete. One control per state
rather than one per screen.

**Ask:** the spec does not cover the empty state. Worth adding, since "Add is in
the nav bar" reads as absolute and is wrong on a blank screen.

### 3.16 No spec exists for the typeahead

`Suggest` — a text field with an inline suggestion panel — was added on 23 Aug
for make/model/year on the add-a-car screen. There is no spec for it.

Design note worth carrying into one: it is deliberately **a field with a list**
and not a picker, because a picker asserts its list is complete and neither the
make catalogue nor NHTSA's model list is. Every field still accepts free text.

---

### 3.17 The white filled primary is retired ✅ fixed in the app

Raised by the v8.3 UI review as **R4**, and it was a real conflict rather than
an oversight.

The readme's override register says *"Advisor CTA — white fill → `.btn-primary`;
a white button is a foreign colour here."* The app shipped a `Button` variant
called `inverse` that was exactly that white fill, and it was the CTA on **six**
screens — sign-in, add-a-car, the wishlist, the advisor, the invoice scan and
the service milestone — while `See suggestions` on the empty wishlist was
correctly cyan. Two filled primaries in one product, and the commoner one was
the one the register forbids.

**The build's side of the argument was not nothing**, and it is worth recording
because it is why this took a ruling rather than a find-and-replace.
`theme/index.ts` carried four tokens that existed for this treatment alone —
`surface.inverse`, `surface.inverseDisabled`, `text.onInverse`,
`text.onInverseMuted` — one of which was moved to 0.60 to fix a **measured**
4.47:1 failure that no source scan could see. `Button`'s docblock already stated
that `inverse` and `primary` share the one-filled-per-screen rule. Until 15 Aug
the treatment lived as six diverging private copies, and the primitive was built
to end that.

**Design is the authority, so it went.** Every filled control is
`brand.primary` `#0E7490` with `text.onPrimary` `#F2FBFD`. The four tokens are
**deleted rather than left unused** — the same rule `status.critical` was
removed under: a dead token holding a retired treatment is how the treatment
comes back, one call site at a time, with its argument already written beside
it. The selected states on the profile, add-a-car and wishlist type chips moved
with it.

`primitives.test.tsx` now asserts the absence directly, so restoring the variant
fails a test rather than passing review.

### 3.18 §3.11's gear was independently read as *shipped* ✅ no change

Recorded because it is evidence that the entry above it is doing its job. The
v8.3 review's **R2** reports "a floating gear button overlays content on all ten
screens" and files it as a ship blocker.

Checked: `apps/mobile/src` contains no gear, cog or settings control of any kind
— the whole tree greps clean — which is §3.11's decision holding. What is in the
captures is not the app's; it belongs to the device or the capture, and the most
likely candidate is iOS AssistiveTouch, which floats a round grey control at a
fixed right-centre position over every screen.

The review's underlying point still stands and is already this file's: **the
system draws a control the app has nothing to open.** That ask is §3.11.

### 3.19 The recall card's action order ⚠ Design — two of the system's own statements

The same shape as §3.2, and it deserves the same treatment.

`native-recall-detail` says this card's *"job is to drive an action, not to
explain a notice"*, and the build put `Find a dealer` and `Mark as repaired`
immediately under the component name. The v8.3 review's **R27** reads that as a
defect: *"the user is offered 'mark as repaired' before being told what could
happen."*

**Both are right, and they are about different things** — the spec is about
prominence, the review is about sequence. The card now leads with the component
name, then three lines of the notice, then the two actions, then the rest behind
one disclosure. The actions are still above every detail section and above the
advisor row; what is above *them* is one paragraph saying what is wrong.

**Design should confirm.** If the spec means the actions must be the first thing
under the title with nothing between, say so and the summary moves below them.

### 3.20 The tab bar is hand-rolled ⚠ Design and Code — R13

**R13** is built: three destinations — Garage, Advisor, Account — on a bar that
is a sibling of the navigator rather than a child of any screen. That is what
makes App Store 5.1.1(v) structural instead of something `GarageScreen` has to
remember on every return path.

⚠ It is **not** `@react-navigation/bottom-tabs`. That package is JS-only and
would cost no EAS build, but installing it runs an install across this
workspace, and `package.json`'s own notes record what that has cost: a full
workspace install hoists `apps/mobile`'s jest 29 to the root and splits the web
app's jest 30 across two trees, which killed every web suite before its first
test.

What bottom-tabs buys over the hand-rolled bar is **per-tab stacks** — each tab
remembering its own history. That is real and it is not what R13 is about. When
a tab genuinely needs its own history, that is the moment to spend the install
and verify it with `rm -rf node_modules && npm ci`.

### 3.21 R26's inline mileage edit is **not built** ⚠ Design

**R26** asks for the hero's meta line — `66,000 mi · xDrive · Daily Driver` — to
make the mileage an `InlineEdit`, "so the one thing that changes looks
changeable".

Not built, and the reason is a collision with a design this file already
records. The hero's identity block is `pointerEvents="none"` and **fades out on
scroll** (§3.14, the pullback): a text field there cannot be tapped, and if it
could, it would fade while somebody was typing into it.

The half of R14 that depends on it *is* built, and it is the half that removes a
screen: `Service → Due` now carries a confirm banner with the field and `That is
right` inline, so the odometer question is answered where the answer is used.
`ServiceMilestoneScreen` no longer gates the whole screen on it.

**Ask:** does the mileage belong on the hero at all, given it cannot be
interactive there? The alternatives are an editable row on `What you told us`,
or the meta line linking to `Service → Due` where the edit already lives.

### 3.22 R5's contrast finding did not reproduce ✅ measured, no change

**R5** reported five strings across four screens as "materially lighter-weight
than `--text-muted`" and asked for an audit. Every one of them is `text.muted`
exactly — `EmptyState`'s body, the advisor's examples, `RecallDetailScreen.meta`,
`ServiceHistoryScreen.meta`. Nothing is off-token and nothing is composited by a
parent `opacity`; that trap was closed app-wide on 7 Aug and every remaining
`opacity` in the tree is a scroll-driven hero transform.

Measured on every surface and pinned in `surface-contrast.test.tsx`:

| | page | nav | raised | card | well |
|---|---|---|---|---|---|
| `text.muted` | 5.34 | 5.34 | 5.24 | **5.13** | **4.99** |
| `text.secondary` | 10.07 | 10.15 | 9.57 | 9.21 | 8.79 |
| `text.nonText` | 3.81 | 3.80 | 3.82 | 3.78 | 3.72 |

The reviewer's own figure for the floor — 5.13:1 — is `muted` on a **card**, so
they measured it correctly and read the render as lighter than the number.

Two things follow. `muted` on `well` is **4.99:1**, the thinnest margin in the
app and the reason `well` must never gain a lighter value without re-running
that suite. And `nonText` fails on every surface, which is exactly why there is
no step between it and `muted` to reach for.

⚠ What is real in R5 is not contrast, it is **hierarchy**: a lot of this app's
content sits on the ramp's floor because the floor is where descriptions,
provenance and intervals all landed. R41's ladder — description at
`--text-secondary`, interval at `--text-muted` — is the fix, and it is applied.

### 3.23 R48's camera-first scan is **not built** — a native module

**R48** asks `Scan an invoice` to open the **camera preview** with `Take a photo`
as the shutter, rather than offering two ways to start. It is right: it removes a
tap and makes the screen's purpose self-evident.

A live preview needs `expo-camera`. The current flow uses `expo-image-picker`'s
`launchCameraAsync`, which hands the OS camera UI over and takes a file back —
there is no preview to embed. `expo-camera` is a **native module**, so adopting
it costs an EAS build out of a monthly allowance of about fifteen (§9).

Queued with the next build that is being spent anyway, alongside
`expo-document-picker` (§3.3's PDF gap) and `react-native-gesture-handler` for
swipe-to-delete on service history (R9). Three findings, one build.

What did land on that screen: the duplicate H1 is gone (R47), the block is
optically centred (R57), and it now says what the model is about to do with the
photograph (R49) — in words that are true, which the review's suggested line was
not: line items are written as soon as extraction succeeds, and only a vehicle
mismatch is held back for confirmation.

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

---

## 6. One thing this review found that is not a design question

**R3's other half, and it needs David's call because it spends money.**

The vehicle detail screen no longer presents a stale health verdict as a current
one — it says what the reading predates, and names its inputs. That makes the
contradiction impossible to ship silently. It does **not** make the number
right.

Nothing on the mobile read path recomputes a health summary.
`generateVehicleHealthSummary` learned to read `maintenance_line_items` on
5 Aug, and `uploadInvoice` fires a best-effort refresh — but
`/api/v1/load-vehicle` and `/api/v1/vehicles` only ever **select** the stored
row. So a summary that went stale before that fix, or whose fire-and-forget
refresh failed, stays stale forever. The M235i is that case.

The fix is one call, and the precedent is already in `uploadInvoice`: fire
`generateVehicleHealthSummary(vehicleId, true)` best-effort from the read path
when the stored row predates the newest filed record.

⚠ **It puts a Gemini call on a route hit every time a car is opened.** §9 says
cap every spending path and make exhaustion degrade the feature rather than
break it. `last_generated` only advances on success, so a persistently failing
generation would retry on every read — `checkRateLimit(userId, 'ai')` bounds
that, and it is the same limiter `uploadInvoice` uses before recomputing stats.

Not implemented on a review line. It is a cost decision, not a design one.

---

## 7. The rename — two things Design owns, added 30 Aug

The product became **Well Kept** on 30 Aug. The name is drawn in two places and
only one of them was safe to change without Design.

**7.1 · The wordmark is now two words in a slot cut for one.** `Logo.tsx` on
both clients renders the name as real text beside the mark, so it now reads
"Well Kept". The tracking beside it does not follow: `-0.035em` horizontal and
`-0.03em` stacked were cut for *CrewChief* — one nine-letter word with two
capital humps and no space to hold open. They are untouched rather than
re-guessed, because tightening a two-word mark is the decision that closes the
gap between the words, and that is a drawing judgement.

**7.2 · ⚠ `public/brand/crewchief-lockup-{horizontal,stacked}.svg` still spell
the old name, and are unchanged on purpose.** Both draw the wordmark as vector
outlines, not text, so there is no string to rename — the letters are paths.
Their `aria-label` is left saying "CrewChief" with them: relabelling artwork
that visibly reads *CrewChief* would make the accessible name disagree with the
render, which is the one failure this project keeps paying for.

The five mark-only assets (`mark`, `mark-small`, `mark-mono`, `favicon`,
`icon-1024`) draw the dial and no letterforms, so their labels moved to
"Well Kept" and nothing about them is stale.

**What Design owns:** a new lockup in the new name, and the tracking that goes
with it. Until then the app's own `Logo` is correct and the two lockup files in
`public/brand` are the old brand.

### 7.3 · Design answered both, 30 Aug

**The lockups are replaced, not edited.** Design's `REBRAND_PROMPT.md` §7: both
current files draw "CrewChief" as vector outlines, so there is nothing to
rename — they are deleted and `lockup-full.svg` / `lockup-short.svg` from the
brand package take their place. Design makes the same point this register did,
from the other side: *"outlined type is also why the rename cannot be a
find-and-replace: grep will report those files clean."*

**The tracking goes back to 0.1em and is not optical.** It was cut to fit one
nine-letter word; "Well Kept" is nine characters including the space and sets at
0.1em small caps without touching the plate's inner step. Design's rule, worth
keeping because it settles the question rather than answering it once: *"a plate
carries engraved type — the letterspacing is the engraving, and it does not get
tuned per word. If a longer string ever has to fit, the plate widens; the
tracking does not close."*

So §7.1 and §7.2 are closed. What replaces them is a build task rather than a
drift: one `BrandLockup` component, the plate mark at 28px with Newsreader small
caps beside it, and the type outlined at PNG-export time because every SVG in
the package declares `Newsreader, Georgia, serif` and a rasteriser without the
webfont silently substitutes Georgia.

### 7.4 · ⚠ Reversed again — David overruled both, recalls are paid

**Final, 30 Aug: recalls sit behind the subscription.** Design gated them, then
reversed and endorsed `paid-features.ts`; David overruled both. `PaidFeature`
carries `recalls` now and the test asserts it in the opposite direction.

⚠ The argument against is deliberately kept in the module and in the test rather
than deleted, because it is the instinct the next reader will have: a federal
defect notice an owner cannot see because their card expired. What it costs, in
one sentence, is that a lapsed owner stops getting new recall notifications for a
car they still own and keeps every recall already stored against it.

Design's §4.5 gate list is otherwise unchanged. The three sections below record
how the question moved, because a decision that reversed twice is one somebody
will try to reverse a third time.

### 7.4b · Design's second pass, 30 Aug — superseded within the hour

Design revised `REBRAND_PROMPT.md` the same afternoon and reversed this one
themselves: *"Recalls are free, and `paid-features.ts` is right. The first pass
of this document gated them; that was wrong and the shipped argument is the
correct one… It is also the one item on the list that is not ours to sell: NHTSA
publishes it. Keep the test that asserts it."*

The added reason is better than the one the code carried. `paid-features.ts`
argues from consequence — an owner who cannot see a defect notice because their
card expired. Design argues from ownership: it is a federal record, and selling
access to it is selling something that is not ours. Both hold; the second is
harder to talk yourself out of.

**Nothing in the build changes.** The gate list becomes AI consultant, invoice
scanning, second vehicle, factory build specs and full history — recalls out of
it, which is where the code already had them.

The original entry is kept below, because a disagreement that resolved is worth
being able to see resolve.

### 7.4a · ⚠ The finding as it stood, before Design's second pass

Design's §4.5 lists the paywall's gates as *"AI consultant, invoice scanning,
second vehicle, VIN specs + recalls, full history"*, with free as *"one car,
health score, its recalls, manual log"*.

**That contradicts a shipped decision, and the part that matters is recalls.**
`paid-features.ts` puts recalls in the free tier with an argument the code
states plainly — a federal defect notice an owner cannot see because their card
expired is not a version of this product that should exist — and
`paid-features.test.ts` asserts it rather than trusting the list. Gating the
second vehicle and full history are ordinary product calls; gating recalls is
the one that is not.

Not implemented, not silently reconciled. It is David's call, and it is recorded
here rather than in a commit message because it is a disagreement between two
current documents rather than a defect in either.

### 7.5 · The truck that was not there

Design's first pass said *"retire the truck glyph — it described a crew chief."*
There is no truck in this app: the nav ships the Sweep dial mark, and a grep for
`truck` returns vehicle-illustration prose and nothing else.

Their second pass accepts it and makes the instruction sharper than the
correction was: the car icon is in the **templates**, not the build, so the work
is to replace the dial mark in the nav with the plate lockup and drop the car
icon from template chrome — while keeping it where it means *a car*, on the
consultant composer's vehicle-context line.

Worth recording as a pattern rather than a one-off: Design writes against the
templates, this repo is the build, and the two have drifted before. A "was →
is" table in a handoff is describing the template's *was*.

### 7.2a · ✅ Closed 1 Sep — the old lockups are deleted

Design's §7 said to delete rather than edit them, and they are gone:
`public/brand/crewchief-lockup-horizontal.svg` and `-stacked.svg`, along with
both `Logo.tsx` files that drew the dial. Nothing references any of them.

⚠ **What is left in `public/brand` is the dial's icon masters** — `favicon`,
`icon-1024`, `mark`, `mark-small`, `mark-mono` — and they are still the source
for `app/favicon.ico`, `app/apple-icon.png` and the manifest's two PNGs. Those
binaries have not been regenerated, because doing it needs a rasteriser with
Newsreader loaded (the outlining step the package README describes). `app/icon.svg`
carries the plate as of 1 Sep, so a browser tab shows the new mark while a
pinned shortcut still shows the dial. That is the visible symptom, and it closes
when the export runs.

### 7.6 · The lockup, implemented 30–31 Aug — one departure to bless

The plate is built on both clients from `packages/core/src/brand.ts`, whose
every value `brand.test.ts` asserts against Design's own SVG files. Geometry is
imported rather than copied, for the reason `Icon.tsx` already states about
Lucide: *"do not redraw or approximate."*

**⚠ The one departure: small caps on mobile.** `font-variant: small-caps` has no
`react-native-svg` equivalent. The web renders the name exactly as the package
does; the native lockup sets it in **capitals** at Design's tracking instead.

The alternative was drawing large and small capitals by hand as two font sizes,
which is the approximation this project forbids for glyphs and would drift from
the web the first time either changed. So: same letters, same tracking, same
plate — the small-capital forms are the difference, and they are the part a
rasteriser cannot fake honestly.

For Design: if the distinction matters at nav size, the fix is a drawn wordmark
in the package rather than a runtime approximation here.

**Newsreader 500 was added to the app**, which the mark needed and the app did
not have — it bundled 700 alone, and rendering the plate a weight heavier is
exactly the silent substitution `mobile-font-faces` exists to catch. Free: the
face comes out of a package already installed.

⚠ **Not yet done, and both need the native build:** the app icon set and the
iOS display name. `app.json` names them; Metro cannot move either.

---

## 9. The garage's look, reworked against a design critic — 3 Sep

David asked for the site's look and feel to be raised page by page, judged by an
independent critic that sees only a screenshot. Four rounds on the landing
garage so far: **4 → 6 → 5 → 6**. The dip is the loop working — fixing the data
defect made three new problems visible that a blank card had been hiding.

Most of what changed is ordinary craft and needs nothing from Design. **Three
items touch the design system and are Design's to bless or overrule.**

### 9.1 · ⚠ The sharp photograph is now graded

`VehicleIdentity`'s header states *"nothing is printed over a photograph — no
tint, no scrim, no vignette"*, and `vehicle-identity-component.test.ts` enforced
it as *exactly one filter in the component*.

**A colour grade is now applied to the sharp layer:** `saturate(0.55)
brightness(0.92) contrast(1.06) hue-rotate(-4deg)`.

The rule's stated evidence is a hero that composited six layers and let ~1.7% of
each 700 KB photograph do any visual work — that is about **obscuring**, and it
is still enforced. A grade hides nothing. What it fixes is the thing every one
of the four critiques named first: owner photographs arrive at whatever
temperature they were taken at, and a golden-hour Accord beside a cold
industrial-dock WRX reads as a scrapbook rather than a collection.

Deliberately **not a duotone** — that would make every car the same object and
throw away the one thing a photograph is for. The guard now pins the exact
filter list, so a third treatment or a different grade still fails.

⚠ Writing that assertion found the header **overstates its own rule**: the
component already composites `.machined` over the photograph. That is sanctioned
and long-standing; the sentence is simply absolute where the practice is not.

### 9.2 · ⚠ The batten's bloom is cut and the room runs dim

`.bay-batten`'s outer halo (`70px 16px`) threw cyan a third of the way down the
page; two critiques named it and the wall seams as the most obviously generated
elements on screen. The **line stays** — it is the fixture, and 2b's ambient
hairline collapses into it — the halo does not, and the landing page runs
`.service-bay-dim`, whose `--bay-led` also drops 0.4 → 0.22.

### 9.3 · ⚠ The identity field's chroma is cut by two thirds

`0.048/0.024` → `0.016/0.008`. BMW hashes into the violets, so an unphotographed
card rendered as a **purple wash** — the single most recognisably generated look
on the web, on the one surface of this product that is pure decoration. The hue
survives, so cards still differ by make; it now reads as a lit dark room.

## 10 · The dashboard pass, 3 Sep

Driven by a design critic run against screenshots of the rendered page at 390px
and 1440px, in a fresh context each round, scoring against a studio bar. Three
consecutive rounds raised the same two system-level objections, so they are
changes to the system rather than to the screen.

### 10.1 · ⚠ The serif is licensed for section heads, not one element per screen

The rule read *"for exactly one element per screen — a vehicle title or the
single largest hero number"*. On a dashboard that meant the serif appeared on
the vehicle's name and in the nav wordmark and nowhere else, and the third
critique put it plainly: *"that's not a pairing, it's a veneer. Commit the serif
to section heads, or drop it."*

Now: the page title and its section heads. **Still never UI chrome, never
labels, and never tabular data** — the cluster reading counts up, and Newsreader
would reflow the digits mid-animation.

### 10.2 · ⚠ The `ok` band moves off cyan — `#5FAEC0` → `#B9C77E`

`--ring-ok` was a desaturated cyan, and cyan is the product's accent: the active
tab, links, the focus ring, the batten. So one hue meant both "this is
interactive" and "this car is middling", most visibly as a 48px cyan **61**
sitting under a cyan tab.

The ramp now steps green → yellow-green → orange → red, which a reader can order
without a legend. 10.5:1 on `--background`, the same margin the other three
carry. `packages/core/src/health-band.ts` and `health-band.test.ts`'s React
Native pin move with it — the web token and the value the Expo app reads cannot
drift apart.

### Not design-system changes, listed so Design can see the whole pass

Model as the card's name with year/make as the eyebrow · "67,400 mi mileage" →
"67,400 mi" · the "Daily Driver" chip only for a declared, non-default status ·
the repeated "View Dashboard" row dropped (the card was already a stretch-link)
· the recall ribbon welded to the plate's edge so it stops breaking the grid's
horizontal registers · summaries cut to a whole first sentence instead of a
ragged clamp · garage ordered by attention · the empty plate designed as a plate
rather than a clip-art car · a fleet readout in the hero's dead space.

### The dashboard pass, in the same spirit

The empty photo plate sized to its content rather than to a photograph's height,
and moved below the reading on a phone · the vehicle named once (the heading)
rather than twice · the model's summary printed once, where its "generated by
AI" line is · the breadcrumb score chip reading the band table instead of its
own thresholds · "Reliability" relabelled "Model reliability" with its competing
verdict chip deleted · one block per subject instead of a driver panel and a
tile grid naming the same subjects · the cluster's hub removed and its reading
moved into the well · dial numerals only at the ends and the three points where
the verdict changes · NHTSA's recall text no longer clamped on a phone · all
four tabs fitting a 390px screen · alert capsules becoming hairline rows behind
one rule · chevrons no longer used as bullets.
