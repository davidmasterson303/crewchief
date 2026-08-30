/**
 * Deciding a recall is worth raising, and not raising it twice.
 *
 * @jest-environment node
 *
 * Recall notification is a polling feature, which makes the dangerous bug the
 * quiet one. Without a record of what was sent, **every poll re-notifies every
 * open recall on every vehicle** — three recalls become three pushes an hour,
 * forever, about work the owner may have had done a year ago. That does not
 * degrade the feature; it trains people to switch notifications off, and it
 * takes the one recall that matters with it.
 *
 * The opposite failure is worse and quieter still: suppressing a notice that
 * was never actually delivered. Both directions are covered here.
 */

export {};

const from = jest.fn();
const sendToAccount = jest.fn();

jest.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from }) }));
jest.mock('@/lib/push-send', () => ({ sendToAccount: (...args: unknown[]) => sendToAccount(...args) }));
jest.mock('@wellkept/core/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { recallsWorthRaising } from '@/lib/notification-triggers';
import { normaliseRecalls } from '@wellkept/core/recalls';

const RAW = [
  {
    NHTSACampaignNumber: '20V123000',
    Summary: 'The fuel pump may fail.',
    Component: 'FUEL SYSTEM',
    ReportReceivedDate: '06/15/2020',
  },
  {
    NHTSACampaignNumber: '19V098000',
    Summary: 'The rearview camera image may fail to display.',
    Component: 'BACK OVER PREVENTION',
    ReportReceivedDate: '03/02/2019',
  },
];

/*
  `raw` is deliberately loose. These are NHTSA payloads, which arrive over the
  network in whichever shape that service is sending this year — narrowing it to
  the fixture's own keys would make every partial-record case below a type error
  rather than the test it is meant to be.
*/
function raise(
  alreadyRaised: Array<{ campaign_number: string; severity: string }>,
  raw: Array<Record<string, unknown>> = RAW
) {
  return recallsWorthRaising({
    vehicleId: 'v1',
    vehicleName: '2015 BMW M235i',
    recalls: normaliseRecalls(raw),
    alreadyRaised: alreadyRaised as never,
  });
}

beforeEach(() => jest.clearAllMocks());

describe('recallsWorthRaising', () => {
  it('raises everything on a vehicle nobody has been told about', () => {
    expect(raise([]).map((n) => n.campaignNumber)).toEqual(
      expect.arrayContaining(['20V123000', '19V098000'])
    );
  });

  it('says nothing about a recall already raised', () => {
    // The whole point. Three recalls must not become three pushes an hour.
    const notices = raise([
      { campaign_number: '20V123000', severity: 'standard' },
      { campaign_number: '19V098000', severity: 'standard' },
    ]);

    expect(notices).toEqual([]);
  });

  it('raises only the one it has not mentioned', () => {
    const notices = raise([{ campaign_number: '19V098000', severity: 'standard' }]);

    expect(notices.map((n) => n.campaignNumber)).toEqual(['20V123000']);
  });

  describe('a severity upgrade', () => {
    it('re-raises when NHTSA escalates to do-not-drive', () => {
      // The case that makes deduplicating on campaign number alone dangerous:
      // the most urgent notice this product can send would be the exact one it
      // stays silent about, because it already mentioned that campaign calmly.
      const notices = raise([{ campaign_number: '20V123000', severity: 'standard' }], [
        { ...RAW[0], parkIt: true },
      ]);

      expect(notices).toHaveLength(1);
      expect(notices[0].severity).toBe('do-not-drive');
    });

    it('re-raises on standard → park-outside', () => {
      const notices = raise([{ campaign_number: '20V123000', severity: 'standard' }], [
        { ...RAW[0], parkOutSide: true },
      ]);

      expect(notices).toHaveLength(1);
      expect(notices[0].severity).toBe('park-outside');
    });

    it('does NOT re-raise when NHTSA softens a notice', () => {
      // A de-escalation is not worth a push.
      const notices = raise([{ campaign_number: '20V123000', severity: 'do-not-drive' }], [RAW[0]]);

      expect(notices).toEqual([]);
    });

    it('does not re-raise an unchanged escalated recall', () => {
      const notices = raise([{ campaign_number: '20V123000', severity: 'do-not-drive' }], [
        { ...RAW[0], parkIt: true },
      ]);

      expect(notices).toEqual([]);
    });
  });

  it('skips a recall with no campaign number rather than raising it forever', () => {
    // It cannot be deduplicated, so raising it means raising it on every poll.
    // A notice nobody can silence is worse than one nobody receives.
    const notices = raise([], [{ Summary: 'Something', Component: 'BRAKES' }]);

    expect(notices).toEqual([]);
  });

  it('carries a deep link the mobile client will accept', () => {
    const [notice] = raise([], [RAW[0]]);

    expect(notice.content.url.startsWith('crewchief://')).toBe(true);
    expect(notice.content.title).toContain('M235i');
  });

  it('falls back to the component when a recall has no summary', () => {
    // Better than an empty body. `normaliseRecalls` has already dropped
    // anything with neither.
    const [notice] = raise([], [{ NHTSACampaignNumber: '21V001000', Component: 'STEERING' }]);

    expect(notice.content.body).toContain('STEERING');
  });

  it('is unaffected by an unrecognised stored severity', () => {
    // A row written by a future version. It must not crash the poll, and the
    // safe reading is "we said something", so an unchanged recall stays quiet.
    const notices = raise([{ campaign_number: '20V123000', severity: 'whatever-comes-next' }], [
      RAW[0],
    ]);

    expect(notices).toEqual([]);
  });
});
