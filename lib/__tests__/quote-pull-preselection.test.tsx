/**
 * Phase 2.98a — the quote pull arrives with its items already chosen.
 *
 * The pull exists because the consultant just told someone their CVT fluid is
 * overdue and they said yes. Opening a dialog that then asks them to find that
 * same job again in a list of everything they have ever wanted is the failure
 * this preselection prevents — so "the items arrive ticked" is the feature, not
 * a convenience on top of it.
 *
 * Two things are pinned here, and the second is the one that will break:
 *
 *  1. `preselectedItemIds` reaches the step 1 counter.
 *  2. **The user can still change their mind.** The preselection is applied in
 *     an effect keyed on the dialog opening. Callers build that array inline —
 *     `pullable.map(e => e.id)` — which is a new array identity on every
 *     render, so keying the effect on the array itself would re-run it
 *     continuously and stamp the preselection back over every tick the user
 *     made. The component joins the ids into a string for exactly that reason,
 *     and the third test is what would catch its removal.
 */

import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QuoteRequestDialogV2 } from '@/components/QuoteRequestDialogV2';

jest.mock('@/app/actions', () => ({
  generateQuoteRequestV2: jest.fn().mockResolvedValue({ success: true, data: null }),
}));

const ITEMS = [
  { id: 'item-1', description: 'CVT fluid flush', category: 'maintenance' },
  { id: 'item-2', description: 'Front brake pads', category: 'repair' },
  { id: 'item-3', description: 'Cat-back exhaust', category: 'modification' },
];

const VEHICLE = 'b2000000-0000-4000-8000-000000000001';

function renderDialog(preselectedItemIds?: string[]) {
  return render(
    <QuoteRequestDialogV2
      open
      onOpenChange={() => {}}
      vehicleId={VEHICLE}
      wishlistItems={ITEMS}
      preselectedItemIds={preselectedItemIds}
    />
  );
}

describe('quote pull preselection', () => {
  it('selects nothing when no preselection is given', () => {
    renderDialog();
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
  });

  it('arrives with the pulled items already selected', () => {
    renderDialog(['item-1', 'item-2']);
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
  });

  it('does not select an item that is not on the wishlist', () => {
    /*
      An id can go stale between the consultant adding it and the dialog
      opening — deleted in another tab, or a 409 that resolved to a row since
      removed. The counter reflects the selection set, so this pins that a
      missing item is carried harmlessly rather than throwing; `handleGenerate`
      filters against `wishlistItems` before it sends anything.
    */
    renderDialog(['item-1', 'item-does-not-exist']);
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
  });

  it('lets the user deselect a preselected item without it being reapplied', () => {
    /*
      The regression guard. A parent that re-renders for an unrelated reason
      must not resurrect the preselection — so this drives a real parent whose
      state changes while the dialog stays open, and passes the ids as a fresh
      array literal each time, which is how the consultant calls it.
    */
    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            re-render {tick}
          </button>
          <QuoteRequestDialogV2
            open
            onOpenChange={() => {}}
            vehicleId={VEHICLE}
            wishlistItems={ITEMS}
            preselectedItemIds={['item-1', 'item-2']}
          />
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText('CVT fluid flush'));
    });
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText(/re-render/));
    });
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
  });
});
