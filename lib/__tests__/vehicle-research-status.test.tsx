/**
 * The "still learning about this car" state.
 *
 * Onboarding no longer waits ~23s for research before letting the user into
 * their garage. That trade is only honest if the gap is visible and
 * recoverable, which is what this component is for — a vehicle showing a blank
 * dossier with no explanation is the §21 provenance problem in a new costume,
 * a UI implying data it does not have.
 *
 * Rendered rather than reasoned about, and with `enrichVehicle` mocked so the
 * suite never spends a Gemini token.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VehicleResearchStatus } from '@/components/VehicleResearchStatus';

const enrichVehicle = jest.fn();
const getResearchStatus = jest.fn();

jest.mock('@/app/actions', () => ({
  enrichVehicle: (...args: unknown[]) => enrichVehicle(...args),
  getResearchStatus: (...args: unknown[]) => getResearchStatus(...args),
}));

const VEHICLE = 'b2000000-0000-4000-8000-000000000001';

beforeEach(() => {
  enrichVehicle.mockReset();
  enrichVehicle.mockResolvedValue({ success: true });
  getResearchStatus.mockReset();
  getResearchStatus.mockResolvedValue({ success: true, status: 'pending' });
});

describe('a vehicle whose research has landed', () => {
  it('renders nothing at all', () => {
    const { container } = render(
      <VehicleResearchStatus vehicleId={VEHICLE} status="completed" onComplete={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('does not start enrichment', () => {
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="completed" onComplete={() => {}} />);
    expect(enrichVehicle).not.toHaveBeenCalled();
  });
});

describe('a vehicle still being researched', () => {
  it('says so, rather than showing an unexplained empty dossier', async () => {
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={() => {}} />);
    expect(await screen.findByText(/still learning about this car/i)).toBeInTheDocument();
  });

  it('tells the user the rest of the dashboard works', async () => {
    // The difference between "this is broken" and "this part is not ready".
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={() => {}} />);
    expect(await screen.findByText(/the rest of the dashboard works now/i)).toBeInTheDocument();
  });

  it('starts enrichment exactly once', async () => {
    /*
      The guard that matters. React 18 StrictMode double-invokes effects, and
      without the ref this would fire two ~23s Gemini research calls per
      dashboard visit — the unmetered-spend bug §3 already records once.
    */
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={() => {}} />);
    await waitFor(() => expect(enrichVehicle).toHaveBeenCalledTimes(1));
    expect(enrichVehicle).toHaveBeenCalledWith(VEHICLE);
  });

  it('tells the dashboard to refetch once research lands', async () => {
    const onComplete = jest.fn();
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={onComplete} />);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });
});

describe('when research fails', () => {
  it('offers a retry the user can actually reach', async () => {
    // Not a silent empty dossier. The ticket is explicit that failure needs a
    // route forward.
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="failed" onComplete={() => {}} />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText(/could not finish researching/i)).toBeInTheDocument();
  });

  it('does not auto-retry a failure', async () => {
    // An automatic retry loop on a Gemini call is a spend loop. The user asks.
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="failed" onComplete={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled());
    expect(enrichVehicle).not.toHaveBeenCalled();
  });

  it('runs enrichment when the button is pressed', async () => {
    render(<VehicleResearchStatus vehicleId={VEHICLE} status="failed" onComplete={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(enrichVehicle).toHaveBeenCalledWith(VEHICLE));
  });

  it('shows the failure state when the record says the research failed', async () => {
    enrichVehicle.mockResolvedValue({ success: false, error: 'upstream exploded' });
    getResearchStatus.mockResolvedValue({ success: true, status: 'failed' });

    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={() => {}} />);

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('a call that never came back', () => {
  /*
    ⚠ These two replaced assertions that a thrown or unsuccessful
    `enrichVehicle` means failure. That was the contract until 22 Aug, when a
    live run wrote a complete dossier and 24 NHTSA recalls in about sixty
    seconds while this component showed the failure state and a retry button.

    The request had outlived its response, the action returned no body, and
    `result.success` threw on `undefined`. The work was never the problem —
    the answer had nowhere to arrive.

    So the action's return value is a hint and `research_status` is the
    verdict. The old tests were not wrong about the code; they were pinning a
    contract that turned out to describe the wrong thing.
  */

  it('completes when the record says so, even though the call rejected', async () => {
    const onComplete = jest.fn();
    enrichVehicle.mockRejectedValue(new Error('gateway gave up'));
    getResearchStatus.mockResolvedValue({ success: true, status: 'completed' });

    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={onComplete} />);

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('completes when the record says so, even though the call reported failure', async () => {
    /*
      The other half, and the less obvious one. A *returned* failure is a
      server that reached the end and said so — but `enrichVehicle` can report
      failure for a dossier that completed on an earlier attempt, which is the
      exact state a retry lands in.
    */
    const onComplete = jest.fn();
    enrichVehicle.mockResolvedValue({ success: false, error: 'enrichment failed' });
    getResearchStatus.mockResolvedValue({ success: true, status: 'completed' });

    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={onComplete} />);

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('keeps waiting rather than declaring failure while the record still says pending', async () => {
    /*
      Anti-vacuous in the direction that matters. A component that never showed
      the failure state would pass both assertions above while stranding
      everybody whose research genuinely failed — so this pins that a pending
      record produces neither an early completion nor an early retry button.
    */
    const onComplete = jest.fn();
    enrichVehicle.mockRejectedValue(new Error('gateway gave up'));
    getResearchStatus.mockResolvedValue({ success: true, status: 'pending' });

    render(<VehicleResearchStatus vehicleId={VEHICLE} status="pending" onComplete={onComplete} />);

    await waitFor(() => expect(getResearchStatus).toHaveBeenCalledWith(VEHICLE));

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByText(/still learning about this car/i)).toBeInTheDocument();
  });
});
