import { render } from '@testing-library/react-native';

import BayRoom from '../../components/BayRoom';
import Suggest from '../../components/Suggest';
import ClusterGauge from '../../components/ClusterGauge';
import HealthDrivers from '../../components/HealthDrivers';
import Plinth from '../../components/Plinth';
import { AA_NORMAL, auditText, belowFloor, contrastRatio } from '../../test-support/contrast';
import { bay, surface, text } from '../../theme';

/**
 * Contrast for the surfaces that are **not** the page.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * Originally because it had to be: these four cases were written at the foot of
 * `contrast.test.tsx` on 15 Aug 2026 and all four passed while measuring
 * nothing, and a separate file was a separate module registry and therefore a
 * working renderer. That defect is fixed — three un-awaited `fireEvent` calls
 * leaving React's act scope open, see `jest.setup.js` — so this could now move
 * back.
 *
 * It stays split because the split turned out to be the better shape anyway:
 * every case in `contrast.test.tsx` composites against the page, and every case
 * here names a different surface. Those are two questions, not one file's worth
 * of the same one.
 *
 * ── What these cover that nothing else can ──────────────────────────────────
 *
 * Everything in `contrast.test.tsx` composites against `SCREEN_BACKGROUND`,
 * because until 15 August every screen was ink on the page or on a card darker
 * than it — so the page was the worst case and measuring against it was
 * conservative.
 *
 * The bay broke that. Its room is a gradient whose lit end is **lighter than
 * the page**, so light-on-dark ink measured against the page reads *better*
 * than it renders. An over-optimistic harness is worse than none: it is the
 * same mistake as the 1.09:1 advisor button, which passed by being measured
 * against the wrong backdrop.
 *
 * So each case below names the surface actually behind the ink, and uses the
 * **worst case** of that surface rather than its average.
 */

/** The four bands, so every colour `healthBandHex` can return is measured. */
const SCORES = [92, 74, 55, 28];

describe('surfaces that are not the page', () => {
  /*
    Every assertion below is `belowFloor(...) === []`, which would pass on an
    empty audit. §0.16 records exactly this going wrong: removing the colour
    literals blinded the source scanner, "has no text below the AA floor" kept
    passing on an empty scan, and only its own anti-vacuous guard noticed.

    The guard each case used to carry by hand now lives in `belowFloor`, which
    throws rather than returning `[]` when it is handed nothing.
  */

  it('keeps the bay wordmark legible against the lit end of the room', async () => {
    /*
      `bay.roomNear` is the gradient's lightest stop and therefore the worst
      case for white ink — the far end only gets darker, which only helps.
    */
    const view = await render(<BayRoom make="Subaru" />);

    expect(belowFloor(auditText(view, bay.roomNear))).toEqual([]);
  });

  /*
    ⚠ **R18, 23 Aug: the add-photo control is no longer on the bay**, so the case
    that measured it is gone rather than skipped. A solid "Change photo" pill sat
    on the photograph at the top right — the loudest control on the home screen
    for the least frequent action anyone takes. On the garage the photograph is
    scenery and the affordance is "open this car"; the control lives on the
    vehicle hero, where it is that hero's implied action.

    Its contrast still matters and is still measured — over there, against the
    hero's guaranteed bed rather than against the bay's room.
  */

  /*
    The drivers are banded on the health ramp, so every colour `healthBandHex`
    can return has to land here — including `warn` and `bad`, the two that have
    historically been closest to the floor.

    ⚠ **One render could not do it.** There are only three `HealthDriverKey`
    values and four bands, so mapping the scores onto them cycled the keys and
    handed React a duplicate `key`. React drops the collision, so the fourth
    band was never rendered and never measured — the same "measures less than
    it says" shape as the null tree this file was split out to avoid, and it was
    only visible as a console warning. A render per band, keys left alone.
  */
  it.each(SCORES)('keeps a driver s reading legible on the card at score %i', async (score) => {
    const view = await render(
      <HealthDrivers
        drivers={(['maintenance', 'recalls', 'mileage-load'] as const).map((key) => ({
          key,
          label: 'Maintenance',
          score,
          detail: 'Two services overdue, across nine tracked services.',
        }))}
      />
    );

    expect(belowFloor(auditText(view, surface.card))).toEqual([]);
  });

  it('keeps a suggestion legible on the panel it is offered from', async () => {
    /*
      The panel is `surface.card`, a step **above** the field's well it hangs
      under — so ink measured against the page reads better here than it
      renders, which is the same over-optimism this whole file exists to catch.

      ⚠ `contrast.test.tsx` mounts `AddVehicleScreen` and does reach this
      component, but only ever with an empty list: `fetchModels` cannot resolve
      in a Jest process, so what it measures is the quiet note. The rows
      themselves — the ink somebody actually reads to choose their car — are
      measured here and nowhere else.
    */
    const view = await render(
      <Suggest
        label="Make"
        value="su"
        onChangeText={jest.fn()}
        onPick={jest.fn()}
        suggestions={['Subaru', 'Suzuki']}
        open
        onOpen={jest.fn()}
      />
    );

    const audits = auditText(view, surface.card);

    // The label, the two rows — a walker that found only the label would pass
    // every assertion about rows it never reached.
    expect(audits.length).toBeGreaterThan(2);
    expect(belowFloor(audits)).toEqual([]);
  });

  it('keeps the dial s readout legible on the plinth', async () => {
    /*
      The plinth is the page colour at 92% over a card, so it lands between the
      two. Measured against the card — the lighter of the pair, and therefore
      the worst case for the band colours the readout wears.
    */
    const view = await render(
      <Plinth>
        <ClusterGauge score={55} variant="row" />
      </Plinth>
    );

    expect(belowFloor(auditText(view, surface.card))).toEqual([]);
  });
});

/**
 * ── The text ramp, measured on every surface it can land on ─────────────────
 *
 * Raised as **R5** by the v8.3 review, which read five strings across four
 * screens as "materially lighter-weight than `--text-muted`" and asked for an
 * audit. Every one of them is `text.muted` exactly — `EmptyState`'s body, the
 * advisor's examples, `RecallDetailScreen.meta`, `ServiceHistoryScreen.meta`.
 * Nothing is off-token and nothing is composited by a parent `opacity`; the
 * screens read light because **the ramp's floor is where a lot of this app's
 * content sits**, which is a hierarchy question and not a contrast one.
 *
 * The numbers are pinned here so that answer keeps holding rather than being
 * re-derived by eye every review. Two are load-bearing:
 *
 *   - `muted` on `well` is **4.99:1** — the thinnest margin in the app, and the
 *     reason `well` must never gain a lighter value without re-running this.
 *   - `nonText` is **below 4.5 on every surface**. It is the hairline token and
 *     a string wearing it fails everywhere, which is exactly why there is no
 *     step between it and `muted` to reach for.
 */
describe('the text ramp against every surface', () => {
  const SURFACES: Array<[string, string]> = [
    ['page', surface.page],
    ['nav', surface.nav],
    ['raised', surface.raised],
    ['card', surface.card],
    ['well', surface.well],
  ];

  it.each(SURFACES)('keeps muted above the floor on %s', (_name, ground) => {
    const ratio = contrastRatio(text.muted, ground);

    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(SURFACES)('keeps secondary comfortably clear on %s', (_name, ground) => {
    expect(contrastRatio(text.secondary, ground)!).toBeGreaterThanOrEqual(8);
  });

  it('pins the worst case, because the margin is thin', () => {
    /*
      4.99:1. Not a rounding away from failing, but close enough that a
      half-step lighter `well` would take the quietest string in a field below
      the floor — and a field is where the app's smallest text lives.
    */
    expect(contrastRatio(text.muted, surface.well)!).toBeCloseTo(4.99, 1);
  });

  it.each(SURFACES)('fails nonText as body ink on %s, which is the point', (_name, ground) => {
    /*
      The anti-vacuous half, and a real rule rather than a formality: this is
      the assertion that would break if somebody "fixed" a contrast complaint by
      lightening `nonText` toward `muted`. There is deliberately no step between
      them — "just one step quieter" is how a system accumulates off-token
      sites, and the hairline token has to stay unusable for words.
    */
    expect(contrastRatio(text.nonText, ground)!).toBeLessThan(AA_NORMAL);
  });
});
