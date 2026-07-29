/**
 * The round-trip classifier — what blocks a promotion, and what can be waived.
 *
 * @jest-environment node
 *
 * This is the decision `promote-demo.mjs` acts on, so getting the boundary
 * between `broken` and `degraded` right *is* the feature. `broken` blocks with
 * no override; `degraded` blocks but can be waived on the command line with
 * the reason written into the merge commit.
 *
 * Two assertions here are the ones that matter, and both encode an outage this
 * project actually had:
 *
 *   - A **200 carrying the client's own error string** is `broken`. §25: the
 *     consultant was dead in production while the page returned 200, and every
 *     gate passed. A 200 was treated as proof once already.
 *   - A **200 with a generic answer** is `broken`. "The model replied" and
 *     "the model replied about this car" are different claims, and only the
 *     second means the consultant works.
 */

import {
  classifyRoundTrip,
  isRetryable,
  CLIENT_ERROR_FALLBACK,
} from '@crewchief/core/consultant-health';
import { CONSULTANT_ROUND_TRIP } from '@crewchief/core/demo-contract';

const TOKENS = CONSULTANT_ROUND_TRIP.expectedTokens;
const good = (answer: string) => classifyRoundTrip({ httpStatus: 200, answer }, TOKENS);

describe('a working consultant', () => {
  it('is good when the answer carries a seeded vehicle fact', () => {
    const result = good('That WRX is sitting at 41,200 miles on a Stage 1 tune.');
    expect(result.status).toBe('good');
    expect(result.reason).toBe('OK');
  });

  it('accepts any one of the expected tokens, not all of them', () => {
    expect(good('It has a Stage 1 tune.').status).toBe('good');
    expect(good('Mileage is 41200.').status).toBe('good');
  });
});

describe('our fault — blocks absolutely', () => {
  it('treats a 200 carrying the client error string as broken', () => {
    // The §25 failure exactly: request succeeded, feature dead.
    const result = good(CLIENT_ERROR_FALLBACK);
    expect(result.status).toBe('broken');
    expect(result.reason).toBe('CLIENT_ERROR_STRING');
  });

  it('treats a generic answer as broken, not good', () => {
    const result = good('Great question! Regular maintenance is important for any vehicle.');
    expect(result.status).toBe('broken');
    expect(result.reason).toBe('NO_VEHICLE_FACTS');
  });

  it('treats an empty answer as broken', () => {
    expect(good('   ').reason).toBe('EMPTY_ANSWER');
  });

  it('treats our own authorization refusing the call as broken', () => {
    // Cause 1 of the outage: a demo vehicle rejected as read-only by a route
    // that should have been reading it.
    expect(classifyRoundTrip({ httpStatus: 403 }, TOKENS).reason).toBe('AUTHORIZATION_REFUSED');
    expect(
      classifyRoundTrip({ httpStatus: 500, errorText: 'Demo vehicles are read-only' }, TOKENS).reason
    ).toBe('AUTHORIZATION_REFUSED');
  });

  it.each(['UNAUTHENTICATED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED', 'API_KEY_INVALID', 'PERMISSION_DENIED'])(
    'treats %s from Google as broken',
    (marker) => {
      const result = classifyRoundTrip({ httpStatus: 500, errorText: `err: ${marker}` }, TOKENS);
      expect(result.status).toBe('broken');
      expect(result.reason).toBe('CREDENTIAL_REJECTED');
    }
  );

  it('does not try to tell a stale credential from a malformed one', () => {
    /*
      §22 records this project mis-diagnosing exactly this 401 twice, because
      both return the same UNAUTHENTICATED text. The gate does not need to
      distinguish them — the response to both is "do not promote" — and a
      classifier that tried would be guessing.
    */
    const stale = classifyRoundTrip({ httpStatus: 500, errorText: 'UNAUTHENTICATED' }, TOKENS);
    const wrongType = classifyRoundTrip(
      { httpStatus: 500, errorText: 'UNAUTHENTICATED ACCESS_TOKEN_TYPE_UNSUPPORTED' },
      TOKENS
    );
    expect(stale.status).toBe('broken');
    expect(wrongType.status).toBe('broken');
  });
});

describe("someone else's outage — blocks, but waivable", () => {
  it.each([429, 500, 502, 503, 504])('treats HTTP %i from Gemini as degraded', (status) => {
    expect(classifyRoundTrip({ httpStatus: status }, TOKENS).status).toBe('degraded');
  });

  it('treats a timeout as degraded', () => {
    expect(classifyRoundTrip({ httpStatus: 0, timedOut: true }, TOKENS).reason).toBe('TIMEOUT');
  });

  it('puts the upstream status in the machine token, not just the prose', () => {
    // promote-demo.mjs branches on `reason`; `detail` may quote upstream
    // wording and must never be parsed.
    expect(classifyRoundTrip({ httpStatus: 503 }, TOKENS).reason).toBe('UPSTREAM_503');
  });

  it('classifies a credential rejection ahead of the upstream status', () => {
    // A 500 whose body says UNAUTHENTICATED is ours, not Google's outage.
    // Getting this precedence backwards would make a dead key waivable.
    const result = classifyRoundTrip({ httpStatus: 500, errorText: 'UNAUTHENTICATED' }, TOKENS);
    expect(result.status).toBe('broken');
  });
});

describe('retry policy', () => {
  it('retries degraded only', () => {
    expect(isRetryable('degraded')).toBe(true);
    expect(isRetryable('broken')).toBe(false);
    expect(isRetryable('good')).toBe(false);
  });

  it('never retries broken, because the answer would be identical', () => {
    // A 403 from our own authorization returns the same 403 the second time.
    // Retrying only makes the log ambiguous about whether it was intermittent.
    expect(isRetryable(classifyRoundTrip({ httpStatus: 403 }, TOKENS).status)).toBe(false);
  });
});

describe('the anchors come from the seed contract', () => {
  it('does not hardcode expectations in the classifier', () => {
    // §23 is a worked example of demo seed data being corrected. A gate that
    // fails because the seed was *fixed* is a gate people learn to distrust,
    // so the tokens travel with the ids they describe.
    expect(TOKENS.length).toBeGreaterThan(0);
    expect(CONSULTANT_ROUND_TRIP.vehicleId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is answerable from data the demo model actually receives', () => {
    // Per §22's related finding the demo consultant is given the knowledge
    // base and recall data. The WRX's mileage and Stage 1 tune live there, so
    // these are answerable rather than hopeful.
    expect(TOKENS).toEqual(expect.arrayContaining(['41,200', 'Stage 1']));
  });
});
