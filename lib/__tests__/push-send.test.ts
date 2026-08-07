/**
 * Sending a notification, and noticing when the address is dead.
 *
 * @jest-environment node
 *
 * The send path has one failure mode that is worse than the others and it is
 * not the loud one. A 502 from Expo is visible, counted and retried next run.
 * `DeviceNotRegistered` is quiet: an uninstalled app leaves a row that is
 * attempted on every notification forever, for a handset that will never
 * receive one, and nothing in the system reports it. Most of this file is about
 * that row being removed — and about *only* that row being removed, because
 * retiring a live device's address on a transient error is the opposite bug and
 * a worse one.
 */

export {};

const from = jest.fn();

jest.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({ from }),
}));

jest.mock('@crewchief/core/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  EXPO_PUSH_ENDPOINT,
  chunk,
  deliver,
  interpretTickets,
  retireTokens,
  sendToAccount,
  toExpoMessages,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from '@/lib/push-send';

const CONTENT = {
  title: 'Recall notice — Accord',
  body: 'Something about brakes. Tap to ask the advisor what it means.',
  url: 'crewchief://vehicle/abc/advisor?ask=What%20does%20this%20mean',
};

function token(n: number): string {
  return `ExponentPushToken[device-${n}]`;
}

function message(to: string): ExpoPushMessage {
  return { to, ...CONTENT, data: { url: CONTENT.url }, sound: 'default' };
}

/** Expo's response envelope. Tickets are index-aligned with the messages sent. */
function expoResponds(tickets: ExpoPushTicket[], ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 502,
    json: () => Promise.resolve({ data: tickets }),
  } as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('toExpoMessages', () => {
  it('puts the deep link in data.url, where the client reads it', () => {
    // `push.ts` reads `data.url` and nothing else. A payload that carries the
    // url anywhere else opens the app to whatever screen was last on top.
    const [msg] = toExpoMessages([token(1)], CONTENT);

    expect(msg.data.url).toBe(CONTENT.url);
    expect(msg.to).toBe(token(1));
    expect(msg.title).toBe(CONTENT.title);
  });
});

describe('chunk', () => {
  it('splits at 100, which is Expo’s hard limit rather than a preference', () => {
    const messages = Array.from({ length: 250 }, (_, i) => message(token(i)));
    const batches = chunk(messages, 100);

    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it('returns nothing for nothing, rather than one empty batch', () => {
    // An empty batch would be a POST to Expo carrying `[]` — a round trip that
    // can only fail or do nothing.
    expect(chunk([], 100)).toEqual([]);
  });
});

describe('interpretTickets', () => {
  it('retires a token Expo says no longer addresses a device', () => {
    const messages = [message(token(1)), message(token(2))];

    const outcome = interpretTickets(messages, [
      { status: 'ok', id: 'ticket-1' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    ]);

    expect(outcome).toEqual({ delivered: 1, failed: 1, retire: [token(2)] });
  });

  it.each(['MessageTooBig', 'MessageRateExceeded', 'MismatchSenderId', 'InvalidCredentials'])(
    'does not retire a live device on %s',
    (error) => {
      // Every one of these is a fault in this system or transient. Deleting an
      // address because a payload was oversized once loses a working device.
      const outcome = interpretTickets([message(token(1))], [
        { status: 'error', details: { error } },
      ]);

      expect(outcome.failed).toBe(1);
      expect(outcome.retire).toEqual([]);
    }
  );

  it('counts a missing ticket as failed, not as sent', () => {
    // Expo returns one ticket per message. Fewer means the messages past the
    // end were acknowledged by nothing, and calling that a delivery reports a
    // send nobody promised.
    const outcome = interpretTickets([message(token(1)), message(token(2))], [{ status: 'ok' }]);

    expect(outcome).toEqual({ delivered: 1, failed: 1, retire: [] });
  });

  it('reports an error with no details as failed but keeps the token', () => {
    // Absent details are not evidence the device is gone.
    const outcome = interpretTickets([message(token(1))], [{ status: 'error' }]);

    expect(outcome).toEqual({ delivered: 0, failed: 1, retire: [] });
  });
});

describe('deliver', () => {
  it('posts to Expo and reads the tickets back', async () => {
    (global.fetch as jest.Mock).mockReturnValueOnce(expoResponds([{ status: 'ok' }]));

    const outcome = await deliver([message(token(1))]);

    expect(global.fetch).toHaveBeenCalledWith(EXPO_PUSH_ENDPOINT, expect.objectContaining({ method: 'POST' }));
    expect(outcome.delivered).toBe(1);
  });

  it('carries on to the next batch when one is rejected', async () => {
    // A fan-out is per-device. One request failing must not silently drop the
    // notification for every device in a later batch.
    const messages = Array.from({ length: 150 }, (_, i) => message(token(i)));

    (global.fetch as jest.Mock)
      .mockReturnValueOnce(expoResponds([], false))
      .mockReturnValueOnce(expoResponds(Array.from({ length: 50 }, () => ({ status: 'ok' as const }))));

    const outcome = await deliver(messages);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ delivered: 50, failed: 100, retire: [] });
  });

  it('counts a thrown request as failed rather than propagating', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(deliver([message(token(1))])).resolves.toEqual({
      delivered: 0,
      failed: 1,
      retire: [],
    });
  });
});

describe('retireTokens', () => {
  it('deletes each dead token once, however many tickets named it', async () => {
    const inFilter = jest.fn().mockResolvedValue({ error: null, count: 1 });
    from.mockReturnValue({ delete: () => ({ in: inFilter }) });

    await retireTokens([token(1), token(1)]);

    expect(inFilter).toHaveBeenCalledWith('expo_push_token', [token(1)]);
  });

  it('does not call the database when there is nothing to retire', async () => {
    await retireTokens([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('survives a failed delete — the notification was already sent', async () => {
    from.mockReturnValue({
      delete: () => ({ in: jest.fn().mockResolvedValue({ error: { message: 'nope' }, count: null }) }),
    });

    await expect(retireTokens([token(1)])).resolves.toBe(0);
  });
});

describe('sendToAccount', () => {
  it('sends to every registered device and retires the dead ones', async () => {
    const inFilter = jest.fn().mockResolvedValue({ error: null, count: 1 });

    from.mockImplementation(() => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ expo_push_token: token(1) }, { expo_push_token: token(2) }],
            error: null,
          }),
      }),
      delete: () => ({ in: inFilter }),
    }));

    (global.fetch as jest.Mock).mockReturnValueOnce(
      expoResponds([
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ])
    );

    const outcome = await sendToAccount('user-1', CONTENT);

    expect(outcome.delivered).toBe(1);
    expect(inFilter).toHaveBeenCalledWith('expo_push_token', [token(2)]);
  });

  it('is not an error for an account with no registered device', async () => {
    // Most accounts have none — the web app registers nothing — so a caller
    // iterating vehicles must not read this as a failed send.
    from.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }));

    await expect(sendToAccount('user-1', CONTENT)).resolves.toEqual({
      delivered: 0,
      failed: 0,
      retire: [],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
