import { render } from '@testing-library/react-native';

import BayRoom from '../../components/BayRoom';
import ClusterGauge from '../../components/ClusterGauge';
import HealthDrivers from '../../components/HealthDrivers';
import Plinth from '../../components/Plinth';
import { auditText, belowFloor, type TextAudit } from '../../test-support/contrast';
import { bay, surface } from '../../theme';

/**
 * Contrast for the surfaces that are **not** the page.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * ⚠ `contrast.test.tsx` has a landmine at its foot: every `render` after its
 * last case comes back with a null tree, so an audit there is empty and — since
 * every assertion in that file reads `expect(belowFloor(...)).toEqual([])` — an
 * empty audit passes. These four cases were written there first and all four
 * went green while measuring nothing. See the warning at the end of that file.
 *
 * A separate file is a separate module registry and a separate renderer, which
 * is the cheap and honest fix while that stays undiagnosed.
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
    ⚠ Every assertion below is `belowFloor(...) === []`, which **passes on an
    empty audit**. §0.16 records exactly this going wrong: removing the colour
    literals blinded the source scanner, "has no text below the AA floor" kept
    passing on an empty scan, and only its own anti-vacuous guard noticed.

    So each case asserts it actually measured something first.
  */
  const measured = (audits: TextAudit[]): TextAudit[] => {
    expect(audits.length).toBeGreaterThan(0);
    return audits;
  };

  it('keeps the bay wordmark legible against the lit end of the room', async () => {
    /*
      `bay.roomNear` is the gradient's lightest stop and therefore the worst
      case for white ink — the far end only gets darker, which only helps.
    */
    const view = await render(<BayRoom make="Subaru" />);
    // eslint-disable-next-line no-console
    console.log('DEBUG json:', JSON.stringify(view.toJSON())?.slice(0, 300), 'bay:', bay.roomNear);

    expect(belowFloor(measured(auditText(view, bay.roomNear)))).toEqual([]);
  });

  it('keeps the add-photo control legible where it sits', async () => {
    // A solid fill, never a wash, precisely because this sits over an unknown
    // photograph. Measured against the room anyway — the control's own fill is
    // what has to carry it, not the backdrop.
    const view = await render(<BayRoom make="Subaru" onAddPhoto={jest.fn()} />);
    const audits = measured(auditText(view, bay.roomNear));

    // Both the wordmark and the control, not just whichever walked first.
    expect(audits.length).toBeGreaterThan(1);
    expect(belowFloor(audits)).toEqual([]);
  });

  it('keeps a driver s reading legible on the card it sits on', async () => {
    /*
      The drivers are banded on the health ramp, so every colour
      `healthBandHex` can return lands here — including `warn` and `bad`, the
      two that have historically been closest to the floor.
    */
    const view = await render(
      <HealthDrivers
        drivers={SCORES.map((score, index) => ({
          key: (['maintenance', 'recalls', 'mileage-load'] as const)[index % 3],
          label: 'Maintenance',
          score,
          detail: 'Two services overdue, across nine tracked services.',
        }))}
      />
    );

    expect(belowFloor(measured(auditText(view, surface.card)))).toEqual([]);
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

    expect(belowFloor(measured(auditText(view, surface.card)))).toEqual([]);
  });
});
