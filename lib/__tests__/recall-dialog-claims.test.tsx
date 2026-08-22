/**
 * The dialog behind the recall tile, rendered.
 *
 * ── The defect, and why a scan was not enough ───────────────────────────────
 *
 * `HealthSummary` computes the three-state recall claim correctly and renders
 * a grey question mark with "We have not checked this vehicle for recalls
 * yet… This is not a clear result."
 *
 * **That tile is this dialog's trigger.** So an owner read the honest hedge,
 * clicked it to find out more, and arrived at a green icon, "No recalls to
 * date", and "This vehicle has a clean safety record" — for a vehicle whose
 * NHTSA record had never been fetched.
 *
 * ⚠ The component received only `recalls: any[]`, so it was **structurally
 * incapable** of telling "checked, none found" from "never checked". The fix
 * was to pass the evidence, not to reword the copy.
 *
 * `absence-is-not-an-all-clear.test.ts` catches a file that states a clean
 * result without the rule in scope. It cannot catch a file that imports the
 * rule and renders the wrong branch anyway — which is what this covers.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import RecallHistoryModal from '@/components/RecallHistoryModal';

function open(props: { recalls: unknown[]; checked: boolean }) {
  render(
    <RecallHistoryModal
      recalls={props.recalls as never[]}
      checked={props.checked}
      trigger={<button type="button">Recall Status</button>}
    />
  );
  fireEvent.click(screen.getByText('Recall Status'));
}

describe('the recall dialog, rendered', () => {
  const { render, screen, fireEvent } = require('@testing-library/react') as typeof import('@testing-library/react');
  const RecallHistoryModal = require('@/components/RecallHistoryModal').default;

  function open(props: { recalls: unknown[]; checked: boolean }) {
    render(
      <RecallHistoryModal {...props} trigger={<button type="button">Recall Status</button>} />
    );
    fireEvent.click(screen.getByText('Recall Status'));
  }

  it('does not call an unchecked vehicle clean', async () => {
    /*
      ⚠ The exact sentence that shipped. It is a claim about the *car* rather
      than about NHTSA's list, which makes it stronger than the copy
      `health-claims.ts` was written to undo — and it sat behind a tile that
      correctly said nothing had been checked.
    */
    open({ recalls: [], checked: false });

    expect(await screen.findByText(/Recalls not checked yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/clean safety record/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No recalls to date/i)).not.toBeInTheDocument();
  });

  it('still reassures when the lookup actually ran', async () => {
    // Anti-vacuous: the reassuring answer is one people are entitled to when
    // it is true, and a dialog that never gave it would be its own defect.
    open({ recalls: [], checked: true });

    /*
      Two elements say it — the dialog's description and the body beneath the
      tick — so this asserts on both rather than picking one and pretending the
      other is not there.
    */
    expect((await screen.findAllByText(/no recalls to date/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/clean safety record/i)).toBeInTheDocument();
    expect(screen.queryByText(/Recalls not checked yet/i)).not.toBeInTheDocument();
  });
});
