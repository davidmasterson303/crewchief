import { render } from '@testing-library/react-native';

import { AdvisorScreen } from '../AdvisorScreen';
import { askAdvisor } from '../../api/consultant';
import { auditText, belowFloor } from '../../test-support/contrast';

/**
 * The advisor's answer, rendered.
 *
 * ── The defect this covers shipped and was found by eye ─────────────────────
 *
 * A real reply displayed literal `**$1,461**` and `* **Front Brakes &
 * Rotors:**` on screen. The web had a bold renderer; the phone had none, so
 * the flagship screen of a portfolio app showed its own markup.
 *
 * `lib/__tests__/answer-markup.test.ts` covers the tokeniser and is worth
 * keeping — it holds the parsing rules, including that a lone asterisk in
 * "25 ft-lb * 2" is arithmetic and must survive. But a correct tokeniser
 * wired to nothing renders exactly the same asterisks. **Only mounting the
 * screen tests the thing the user sees**, and nothing did until now.
 */

jest.mock('../../api/consultant', () => {
  const actual = jest.requireActual('../../api/consultant');
  return { ...actual, askAdvisor: jest.fn() };
});

const ask = askAdvisor as jest.MockedFunction<typeof askAdvisor>;

/** The shape of a real answer, including the exact strings that shipped raw. */
const ANSWER = [
  'That last trip to Blackmarket Motorsports ran you **$1,461** all-in.',
  '',
  '* **Front Brakes & Rotors:** $678',
  '* **NGK Spark Plugs:** $294',
].join('\n');

function renderAdvisor(question = 'What did my last service cost?') {
  return render(
    <AdvisorScreen
      vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
      initialQuestion={question}
      onSignOut={jest.fn()}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

describe('an answer is rendered, not printed', () => {
  it('shows no markup syntax anywhere on screen', async () => {
    ask.mockResolvedValue({ sessionId: 's1', response: ANSWER, contextKinds: ['service'] });

    const view = await renderAdvisor();
    await view.findByText(/Blackmarket Motorsports/);

    /*
      The whole assertion, and the one that would have failed on 5 Aug: no
      rendered string may still contain `**`. Walking the audit rather than
      querying for a phrase, because the defect was *everywhere* in the answer
      rather than in one line.
    */
    for (const audit of auditText(view)) {
      expect(audit.text).not.toContain('**');
    }
  });

  it('emphasises the figure rather than showing its asterisks', async () => {
    ask.mockResolvedValue({ sessionId: 's1', response: ANSWER, contextKinds: [] });

    const view = await renderAdvisor();

    // The bold run is its own Text node with the amount as plain content.
    expect(await view.findByText('$1,461')).toBeTruthy();
    expect(view.queryByText(/\*\*\$1,461\*\*/)).toBeNull();
  });

  it('draws a bullet glyph instead of the asterisk the model wrote', async () => {
    ask.mockResolvedValue({ sessionId: 's1', response: ANSWER, contextKinds: [] });

    const view = await renderAdvisor();
    await view.findByText(/Blackmarket/);

    // The marker is consumed by the parser and redrawn, so it must appear
    // exactly once per bullet — not as a leading "*" as well.
    expect(view.getAllByText('•')).toHaveLength(2);
  });

  it('keeps a lone asterisk, because it is arithmetic', async () => {
    // "25 ft-lb * 2" is a multiplication sign. Stripping it would be a worse
    // failure than showing it, and only a render proves which happened.
    ask.mockResolvedValue({
      sessionId: 's1',
      response: 'Torque them to 25 ft-lb * 2 passes.',
      contextKinds: [],
    });

    const view = await renderAdvisor();
    expect(await view.findByText('Torque them to 25 ft-lb * 2 passes.')).toBeTruthy();
  });
});

describe('a link can arrive with its question', () => {
  it('asks it once, without anyone typing', async () => {
    // The notification promises an answer, so it carries the question. This is
    // also the only way this screen can be exercised without a human: synthetic
    // keystrokes do not reach a React Native TextInput.
    ask.mockResolvedValue({ sessionId: 's1', response: 'It cost $1,461.', contextKinds: [] });

    const view = await renderAdvisor('What did my last service cost?');

    expect(await view.findByText('It cost $1,461.')).toBeTruthy();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'What did my last service cost?' })
    );
  });

  it('asks nothing when the link carried no question', async () => {
    const view = await render(
      <AdvisorScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
      />
    );

    await view.findByText('Ask about this car');
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('provenance', () => {
  it('names its sources under the answer', async () => {
    ask.mockResolvedValue({
      sessionId: 's1',
      response: 'Looks fine.',
      contextKinds: ['service', 'recalls'],
    });

    const view = await renderAdvisor();
    await view.findByText('Looks fine.');

    // "Based on", never "Sources" — the claim is what was put in front of the
    // model, not what it used.
    expect(view.getByText('Based on')).toBeTruthy();
    expect(view.getByText('Service records')).toBeTruthy();
    expect(view.getByText('Recall data')).toBeTruthy();
  });

  it('claims nothing when the server sent no kinds', async () => {
    ask.mockResolvedValue({ sessionId: 's1', response: 'Looks fine.', contextKinds: [] });

    const view = await renderAdvisor();
    await view.findByText('Looks fine.');

    expect(view.queryByText('Based on')).toBeNull();
  });
});

describe('contrast', () => {
  it('holds the AA floor with an answer on screen', async () => {
    ask.mockResolvedValue({
      sessionId: 's1',
      response: ANSWER,
      contextKinds: ['knowledge', 'service'],
    });

    const view = await renderAdvisor();
    await view.findByText(/Blackmarket/);

    expect(belowFloor(auditText(view))).toEqual([]);
  });
});
