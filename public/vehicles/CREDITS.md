# Vehicle photography — sourcing manifest

Answers `PHOTOGRAPHY_SPEC.md` (shipped in `design_handoff_v6_hero/`). Sourced 26 July 2026.

Everything here is derived from five licensed masters. `build_assets.py` regenerates
every derived file from `masters/` — the crops are reproducible, not hand-edited.

---

## Licence

All five masters are **Pexels**. The Pexels licence permits commercial use with no
attribution required, and explicitly covers use in a commercial product. Photographer
credit is recorded below as good practice, not obligation.

Relevant restrictions, all of which we satisfy:

- Cannot sell unaltered copies as prints or on physical products — we don't.
- Cannot redistribute on another stock platform — we don't.
- Cannot use the imagery as part of a trade mark or business name — we don't.
- Cannot imply endorsement by people or brands shown.

**One caveat worth a decision, not a fix.** That last restriction interacts with the fact
that every photo shows a recognisable marque. Using a BMW in App Store marketing screenshots
for a paid app is a different posture from using it as demo content inside the product.
It is common practice and low risk, but it is a trademark question rather than a copyright
one, and the Pexels licence does not resolve it either way. Worth a look before store assets
are finalised.

| Master | Photographer | Source | Native |
|---|---|---|---|
| `pexels-introspectivedsgn-16685577.jpg` | Erik Mclean | [pexels.com/photo/…16685577](https://www.pexels.com/photo/a-blue-subaru-wrx-parked-in-the-port-16685577/) | 4099×2738 (3:2) |
| `pexels-introspectivedsgn-16685604.jpg` | Erik Mclean | [pexels.com/photo/…16685604](https://www.pexels.com/photo/a-blue-subaru-wrx-parked-in-the-port-16685604/) | 2832×4240 (3:4) |
| `pexels-introspectivedsgn-16685592.jpg` | Erik Mclean | [pexels.com/photo/…16685592](https://www.pexels.com/photo/tail-light-in-a-blue-subaru-wrx-16685592/) | 2727×4083 (3:4) |
| `pexels-umutraw-19785432.jpg` | UMUT RAW | [pexels.com/photo/…19785432](https://www.pexels.com/photo/a-gray-bmw-m3-parked-on-the-side-of-a-street-in-city-19785432/) | 3834×5751 (3:4) |
| `pexels-bylukemiller-19316798.jpg` | Luke Miller | [pexels.com/photo/…19316798](https://www.pexels.com/photo/modified-silver-honda-accord-ex-parked-on-a-country-road-at-sunset-19316798/) | 4672×7008 (3:4) |

---

## Set A — product imagery

Nine files, three frames per demo vehicle. All meet or exceed the spec's minimums
(hero ≥2400px wide, portrait ≥1600px, detail ≥1600px). No grade, tint or vignette
applied — `.photo-hero` applies its own.

| Vehicle | hero-3x2 | portrait-3x4 | detail-4x3 | `--focal-y` |
|---|---|---|---|---|
| `wrx` | 2400×1599 | 1600×2133 | 1600×1199 | `58%` |
| `m3` | 2400×1600 | 1600×2133 | 1600×1199 | `56%` |
| `accord` | 2400×1599 | 1600×2133 | 1600×1200 | `72%` |

`--focal-y` is the vertical centre of the car, read off a gridded contact sheet by eye.
It is the per-vehicle override the v6 CSS expects; the `80%` default is wrong for all
three of these because none is a phone snapshot with the car at the bottom.

### What matched the spec, and what didn't

**WRX — clean.** Erik Mclean shot the same car in one session at a foggy harbour: a 3:2
landscape, a 3:4 portrait with the car low, and a tail-light detail. Flat overcast light,
a working dock rather than a showroom, bottom third free of critical detail. This is what
the whole set should look like.

- *Verified against spec:* light, environment, composition, resolution, no plate, no people.
- *Deviation:* it is a **VB-generation WRX (2022+)**, and the seed says 2020. The photo
  currently live on the demo is the same car, so this mismatch already exists — it is not
  introduced here.

**M3 — good environment, uncertain model.** Grey, overcast, parked on a city street with
the car in the lower two-thirds. Art direction is right.

- *Verified:* light, environment, composition, resolution. Registration `32 FB 748` is
  blurred in every derived file, including the fixtures.
- *Not verified:* **whether this is actually an M3.** The photographer titled it "gray BMW
  M3". The front bumper is consistent with an F80 M3, but it is also consistent with an F30
  with the M-Sport package, and no M badge is visible from the front. Worth your eye before
  it becomes a store capture.

**Accord — the weak one, and it's already live.** Two problems, one of them pre-existing.

1. **It fails the spec's art direction outright.** A hard orange sunset, which the spec
   rules out by name: *"Not midday sun, not orange-sunset skies — the grade fights them and
   they read as stock."* The `.photo-hero` grade (`saturate(.62)`) does knock a lot of the
   orange back, so it survives *behind the hero treatment*. It should not be used for a
   marketing screenshot or a store capture, where nothing tames it.
2. **It is the wrong generation of car.** This is an **8th-generation Accord (2008–2012)**.
   The seed vehicle is a **2018 Sport 2.0T**, tenth generation, and its hand-written
   knowledge base is specific to that car — 2.0T fuel dilution, the CVT flush interval.
   A ten-year generation gap is visible to anyone who knows the car. This photo is what the
   demo serves today; the mismatch is inherited, not introduced.

   Free stock has thin tenth-gen Accord coverage. Options, in rough order of cost: keep it
   and accept the gap; commission or shoot one Accord; or re-seed the demo vehicle to a car
   with good stock coverage — which means rewriting the knowledge base entry, so it is more
   expensive than it looks.

A silhouetted figure appears at the right edge of the Accord frames. Not identifiable,
so it clears the spec's bar, but noted.

---

## Set B — owner-photo test corpus

Sixteen fixtures covering all ten failure cases the spec enumerates, plus six more.

**These are manufactured, not collected.** The spec asks for real photos — *"Collect, don't
shoot… their value is that they are bad."* We don't have a real corpus. These are the good
masters degraded programmatically, which means they are bad in *predictable* ways: they will
catch geometry, exposure and aspect-ratio bugs, but not the long tail of real phone-camera
mess. Treat this as unblocking the v6 hero work, not as closing the item. Collecting real
owner photos stays open ahead of submission.

| File | Case | Size |
|---|---|---|
| `01-portrait-car-low.jpg` | 3:4, car in the bottom half — **the case broken today** | 900×1200 |
| `02-tall-9x16-car-small.jpg` | 9:16, car small in frame | 720×1280 |
| `03-car-far-away.jpg` | car occupies under 30% of the frame | 1600×1600 |
| `04-car-at-edge.jpg` | subject hard right, not centred | 2200×1500 |
| `05-night-underexposed.jpg` | night, badly underexposed | 1800×1200 |
| `06-blown-highlights.jpg` | direct sun, clipped whites | 1800×1200 |
| `07-car-cut-off.jpg` | vehicle clipped by the frame edge | 1500×1000 |
| `08-foreground-clutter.jpg` | heavy foreground obstruction | 1800×1200 |
| `09-square-social-crop.jpg` | near-square crop from a social app | 1080×1080 |
| `10-low-res-540px.jpg` | under 800px wide | 540×720 |
| `11-portrait-sky-heavy.jpg` | 3:4 with a large empty sky above the car | 900×1200 |
| `12-tilted-horizon.jpg` | handheld tilt | 900×1240 |
| `13-motion-blur-soft.jpg` | out of focus | 1600×1066 |
| `14-dark-portrait.jpg` | dark *and* portrait, two failures at once | 900×1200 |
| `15-wide-letterbox.jpg` | very wide, car in a thin band | 1920×1080 |
| `16-car-clipped-bottom.jpg` | car runs off the bottom edge | 780×1040 |

Never use these for marketing. Never retouch them.

---

## Regenerating

```
cd photography && python3 build_assets.py     # needs pillow
```

Crop anchors, focal-Y values and plate-blur boxes all live in the `VEHICLES` dict at the
top of `build_assets.py`. Adjust there rather than editing images by hand.
