/**
 * The anonymous front door's abuse controls. Phase 2.97a, decision D8.
 *
 * @jest-environment node
 *
 * Three controls, in this order of authority: the daily spend ceiling with its
 * kill switch (primary), per-IP bucketing on a platform-supplied address
 * (secondary), and no dossier generation on this path ever (D6).
 *
 * The ordering is erratum **T1** and it is the substance rather than the
 * presentation. The original 2.97a wording named IP bucketing primary;
 * `cc-tech-0003` at high confidence forbids exactly that, because a bucket
 * keyed on a caller-supplied header counts to one forever while reporting that
 * it works. Most of what is asserted below is that the *unsound* control cannot
 * quietly become the load-bearing one.
 */

import {
  FRONT_DOOR_BUDGET,
  FRONT_DOOR_DISABLED_ENV,
  decideFrontDoor,
  frontDoorClosedMessage,
  WARN_AT,
} from '@crewchief/core/ai/budget';
import {
  PLATFORM_IP_HEADERS,
  SPOOFABLE_IP_HEADERS,
  platformClientIp,
} from '@crewchief/core/client-ip';

const LIMIT = FRONT_DOOR_BUDGET.dailyOutputTokens;

describe('decideFrontDoor — the primary control', () => {
  it('allows an ordinary request', () => {
    const d = decideFrontDoor({ usedToday: 0, manuallyDisabled: false });
    expect(d.allowed).toBe(true);
    expect(d.state).toBe('ok');
    expect(d.shouldAlert).toBe(false);
  });

  it('closes at the ceiling, inclusive', () => {
    // Spending exactly the ceiling means spending it.
    const d = decideFrontDoor({ usedToday: LIMIT, manuallyDisabled: false });
    expect(d.allowed).toBe(false);
    expect(d.state).toBe('exhausted');
  });

  it('warns before it closes, without closing', () => {
    const d = decideFrontDoor({ usedToday: Math.ceil(LIMIT * WARN_AT), manuallyDisabled: false });
    expect(d.state).toBe('approaching');
    expect(d.allowed).toBe(true);
  });

  it('alerts when shut, and stays quiet at the warn threshold', () => {
    /*
      Paging at 80% on a surface whose entire purpose is attracting strangers
      would train whoever carries it to ignore the page. An alert that is
      ignored is worse than no alert, because it is believed to exist.
    */
    expect(decideFrontDoor({ usedToday: LIMIT, manuallyDisabled: false }).shouldAlert).toBe(true);
    expect(
      decideFrontDoor({ usedToday: Math.ceil(LIMIT * WARN_AT), manuallyDisabled: false }).shouldAlert
    ).toBe(false);
  });

  it('never reports above 100% used', () => {
    expect(decideFrontDoor({ usedToday: LIMIT * 5, manuallyDisabled: false }).fractionUsed).toBe(1);
  });

  it('treats junk usage as zero rather than propagating NaN', () => {
    for (const junk of [NaN, -1, undefined as unknown as number]) {
      const d = decideFrontDoor({ usedToday: junk, manuallyDisabled: false });
      expect(d.usedToday).toBe(0);
      expect(d.allowed).toBe(true);
    }
  });

  it('an unconfigured ceiling means no ceiling, not a closed door', () => {
    /*
      Same rule as decideBudget and decideDemoBudget. The direction is
      uncomfortable on an unauthenticated endpoint and is chosen deliberately:
      a typo that closes the acquisition surface is found weeks later by
      wondering why the funnel is empty, where a typo that leaves it open is
      bounded by the per-IP bucket and visible in the meter the next morning.
    */
    const d = decideFrontDoor({
      usedToday: 10_000_000,
      manuallyDisabled: false,
      budget: { dailyOutputTokens: 0 },
    });
    expect(d.allowed).toBe(true);
  });
});

describe('the kill switch', () => {
  it('shuts the door regardless of usage', () => {
    expect(decideFrontDoor({ usedToday: 0, manuallyDisabled: true }).allowed).toBe(false);
    expect(decideFrontDoor({ usedToday: 0, manuallyDisabled: true }).state).toBe('disabled');
  });

  it('cannot be overridden by an unconfigured ceiling', () => {
    /*
      The assertion worth having. The "no ceiling configured" branch above
      returns allowed, and if it were reachable while the switch is on then the
      one control someone reaches for mid-incident would be defeated by a
      config typo — at the only moment it matters.
    */
    const d = decideFrontDoor({
      usedToday: 0,
      manuallyDisabled: true,
      budget: { dailyOutputTokens: 0 },
    });
    expect(d.allowed).toBe(false);
    expect(d.state).toBe('disabled');
  });

  it('does not alert — someone turned it off on purpose', () => {
    expect(decideFrontDoor({ usedToday: 0, manuallyDisabled: true }).shouldAlert).toBe(false);
  });

  it('is named as an env var, so flipping it needs no deploy', () => {
    expect(FRONT_DOOR_DISABLED_ENV).toBe('FRONT_DOOR_DISABLED');
  });
});

describe('the closed-door message', () => {
  const message = frontDoorClosedMessage();

  it('never mentions money, budgets or limits', () => {
    /*
      A stranger who came to find out whether their quote was fair does not
      care why. "We have hit our daily spending cap" invites both "so you are
      broke" and someone measuring how fast they can hit it tomorrow.
    */
    for (const leak of ['budget', 'limit', 'cap', 'spend', 'cost', '$', 'quota', 'exhaust']) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });

  it('points at the path that still works', () => {
    expect(message.toLowerCase()).toContain('account');
  });
});

describe('platformClientIp — the secondary control', () => {
  const from = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;

  it('reads the platform header', () => {
    expect(platformClientIp(from({ 'x-nf-client-connection-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('ignores every spoofable header, even when it is the only one present', () => {
    /*
      The whole erratum, as an assertion. Each of these is a value the caller
      writes. A limiter keyed on one counts to one forever: a new value per
      request is a new bucket per request.
    */
    for (const header of SPOOFABLE_IP_HEADERS) {
      expect(platformClientIp(from({ [header]: '198.51.100.4' }))).toBeNull();
    }
  });

  it('prefers the platform header over a spoofed one claiming otherwise', () => {
    const ip = platformClientIp(
      from({
        'x-forwarded-for': '198.51.100.4',
        'x-real-ip': '198.51.100.5',
        'x-nf-client-connection-ip': '203.0.113.7',
      })
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('returns null rather than falling back when the platform says nothing', () => {
    /*
      The tempting fallback — use X-Forwarded-For if the platform header is
      absent — reintroduces the entire problem, because an attacker can *cause*
      the absence by not transiting the edge. Null is a real answer: the bucket
      does not apply and the spend ceiling carries the request, which is the
      correct division of labour between a primary and a secondary control.
    */
    expect(platformClientIp(from({}))).toBeNull();
    expect(platformClientIp(from({ 'x-forwarded-for': '198.51.100.4' }))).toBeNull();
  });

  it('does not collapse a list into one bucket key', () => {
    expect(platformClientIp(from({ 'x-nf-client-connection-ip': '203.0.113.7, 198.51.100.4' }))).toBe(
      '203.0.113.7'
    );
  });

  it('treats blank and whitespace as absent', () => {
    expect(platformClientIp(from({ 'x-nf-client-connection-ip': '   ' }))).toBeNull();
    expect(platformClientIp(from({ 'x-nf-client-connection-ip': '' }))).toBeNull();
  });

  it('keeps the two lists disjoint', () => {
    // A header appearing in both would make the allowlist a lie, and the
    // spoofable list is what a future reader will check before trusting one.
    for (const safe of PLATFORM_IP_HEADERS) {
      expect(SPOOFABLE_IP_HEADERS).not.toContain(safe);
    }
  });
});
