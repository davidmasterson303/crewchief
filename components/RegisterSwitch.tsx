'use client';

import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { toast } from 'sonner';

import { setModificationsVisible } from '@/app/actions';

/**
 * The way back — v8 §6.
 *
 * Onboarding asks a single yes/no about modifications in the first sixty
 * seconds, and "not interested" hides an entire surface. **That answer has to
 * be reversible in both directions**, which is what lets the question stay a
 * yes/no rather than something that must be got right first time.
 *
 * A one-way version of this already existed here — an underlined text link
 * reading "Interested in modifications for this car? Turn them on", shown only
 * while the surface was hidden. It was right about the problem and incomplete
 * in three ways: it could not turn the surface back OFF, it was an 11px
 * underline rather than a control, and it read as an advertisement rather than
 * a capability.
 *
 * ── Why this is not in the garage header ────────────────────────────────────
 *
 * The design system asks for this in the garage header and the account screen.
 * **Neither fits this data model**: the setting is `vehicles
 * .performance_mindedness`, so it is per-CAR, not per-person. A garage header
 * carries no vehicle, and in a two-car garage a single switch there would
 * silently mean one of them. The dossier is the only surface where the
 * question "show modifications for *this* car" is well-formed, so that is
 * where it lives until the column moves to the profile.
 *
 * ── The copy rule ───────────────────────────────────────────────────────────
 *
 * `stock` is "not now", never "never" — so the label states the action rather
 * than pitching it, and is symmetrical in both directions.
 */
interface RegisterSwitchProps {
  vehicleId: string;
  /** Whether the modifications surface is currently shown. */
  visible: boolean;
  /**
   * Applied immediately, and applied AGAIN with the previous value if the
   * server refuses. The caller owns everything that has to move with it — in
   * the dossier that includes the selected tab, because turning the surface
   * off while standing on it would leave a tab that no longer exists.
   */
  onApply: (visible: boolean) => void;
  className?: string;
}

export default function RegisterSwitch({
  vehicleId,
  visible,
  onApply,
  className,
}: RegisterSwitchProps) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className={`register-switch ${className ?? ''}`}
      disabled={pending}
      onClick={async () => {
        const next = !visible;

        /*
          Optimistic, because the tab it reveals should appear on the tap. A
          surface that waits for a round trip reads as the button not having
          worked, which is how somebody presses it twice.
        */
        setPending(true);
        onApply(next);

        const result = await setModificationsVisible(vehicleId, next);
        setPending(false);

        if (!result.success) {
          /*
            Put it back. Leaving the optimistic state would show a surface that
            vanishes on the next load — a silent revert is worse than an error,
            because nothing tells you it did not take.
          */
          onApply(visible);
          toast.error(
            result.error || `Could not ${next ? 'show' : 'hide'} modifications`
          );
        }
      }}
    >
      <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" />
      {visible ? 'Hide modifications' : 'Show modifications'}
    </button>
  );
}
