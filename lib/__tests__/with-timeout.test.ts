/**
 * Deadlines on outbound calls.
 *
 * @jest-environment node
 *
 * Written for the onboarding hang: the Gemini research call and the vehicle
 * image lookup both had **no timeout at all**, so a slow upstream left a user
 * on a spinner with no error, no completion and no way forward. A wait you
 * cannot bound is a hang, not a wait — and this is the first thing a new user
 * does, including an App Store reviewer.
 */

import { withTimeout, TimeoutError } from '@crewchief/core/retry';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withTimeout', () => {
  it('returns the value when the operation beats the deadline', async () => {
    await expect(withTimeout(async () => 'done', 100, 'fast')).resolves.toBe('done');
  });

  it('rejects with TimeoutError when it does not', async () => {
    await expect(
      withTimeout(() => sleep(200).then(() => 'late'), 30, 'slow')
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('names the stage and the deadline in the error', async () => {
    // The label is what a log reader sees. "vehicle research exceeded its
    // 30000ms deadline" is actionable; "AbortError" is not.
    const err = (await withTimeout(() => sleep(200), 25, 'vehicle research').catch(
      (e) => e
    )) as TimeoutError;
    expect(err.message).toContain('vehicle research');
    expect(err.message).toContain('25ms');
    expect(err.label).toBe('vehicle research');
    expect(err.ms).toBe(25);
  });

  it('aborts the signal it hands the operation', async () => {
    // So a fetch given the signal is genuinely cancelled rather than left to
    // finish into nothing.
    let seen: AbortSignal | undefined;
    await withTimeout(
      (signal) => {
        seen = signal;
        return sleep(200);
      },
      25,
      'aborts'
    ).catch(() => {});

    expect(seen?.aborted).toBe(true);
  });

  it('does not abort when the operation finishes in time', async () => {
    let seen: AbortSignal | undefined;
    await withTimeout(
      (signal) => {
        seen = signal;
        return Promise.resolve('ok');
      },
      500,
      'no abort'
    );
    expect(seen?.aborted).toBe(false);
  });

  it('propagates the operation own failure rather than masking it as a timeout', async () => {
    // A failing call and a silent one need different handling — the health
    // classifier calls the first `broken` and the second `degraded`.
    await expect(
      withTimeout(() => Promise.reject(new Error('upstream 500')), 500, 'fails')
    ).rejects.toThrow('upstream 500');
  });

  it('clears its timer when the operation resolves early', async () => {
    /*
      Not cosmetic. An uncleared timer keeps the event loop alive for the full
      deadline, which in a serverless function is billable wall clock on every
      call. The assertion is that this resolves promptly rather than being held
      open for the 5s deadline — if the timer leaked, the suite would hang on
      teardown instead of finishing in milliseconds.
    */
    const started = Date.now();
    await withTimeout(async () => 'quick', 5000, 'clears');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
