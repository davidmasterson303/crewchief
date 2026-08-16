import { render } from '@testing-library/react-native';

import BayRoom from '../../components/BayRoom';
import ClusterGauge from '../../components/ClusterGauge';
import HealthDrivers from '../../components/HealthDrivers';
import Plinth from '../../components/Plinth';
import { auditText, belowFloor } from '../../test-support/contrast';
import { bay, surface } from '../../theme';

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

  it('keeps the add-photo control legible where it sits', async () => {
    // A solid fill, never a wash, precisely because this sits over an unknown
    // photograph. Measured against the room anyway — the control's own fill is
    // what has to carry it, not the backdrop.
    const view = await render(<BayRoom make="Subaru" onAddPhoto={jest.fn()} />);
    const audits = auditText(view, bay.roomNear);

    // Both the wordmark and the control, not just whichever walked first.
    expect(audits.length).toBeGreaterThan(1);
    expect(belowFloor(audits)).toEqual([]);
  });

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
