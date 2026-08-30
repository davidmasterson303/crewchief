/**
 * A notification's destination is a contract between two codebases.
 *
 * @jest-environment node
 *
 * The server writes `data.url`; `apps/mobile`'s `linking` config resolves it.
 * **Nothing at runtime checks that they agree.** A push whose url names a route
 * the navigator does not register opens the app to whatever screen was last on
 * top — no error, no log, no crash. It reads as "the notification is broken"
 * and is invisible until someone taps a real one on a real phone.
 *
 * This reads both sides. It is the same shape as `mobile-push-routing.test.ts`,
 * which holds the *scheme* allowlist on the receiving side; this one holds the
 * *routes* across the boundary.
 *
 * The other half of the contract is the scheme itself. `push.ts` accepts only
 * `crewchief://` — an `https://` url in that field would turn a notification
 * from someone's garage into an open redirect — so a url built with anything
 * else is silently dropped rather than followed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  advisorUrl,
  recallNotification,
  recallsUrl,
  serviceDueNotification,
  serviceUrl,
  vehicleUrl,
} from '@wellkept/core/notifications';

const ROOT = join(__dirname, '..', '..');

const navigator = readFileSync(
  join(ROOT, 'apps', 'mobile', 'src', 'navigation', 'RootNavigator.tsx'),
  'utf8'
);

/**
 * The routes the navigator actually registers, read out of its `linking`
 * config rather than restated here.
 *
 * Restating them is what this file exists to prevent: a second copy of the
 * table drifts, and the direction it drifts in is the silent one.
 */
function registeredRoutes(): string[] {
  const screens = navigator.match(/screens:\s*\{([\s\S]*?)\}/);
  if (!screens) throw new Error('linking.config.screens not found in RootNavigator');

  return Array.from(screens[1].matchAll(/:\s*'([^']+)'/g)).map((m) => m[1]);
}

/** `vehicle/:vehicleId/advisor` → a matcher for `vehicle/<anything>/advisor`. */
function asPattern(route: string): RegExp {
  return new RegExp(`^${route.replace(/:[A-Za-z]+/g, '[^/?]+')}$`);
}

/** The path a built url resolves to, with the scheme and query removed. */
function pathOf(url: string): string {
  return url.replace(/^crewchief:\/\//, '').split('?')[0];
}

const routes = registeredRoutes();

function isRegistered(url: string): boolean {
  return routes.some((route) => asPattern(route).test(pathOf(url)));
}

describe('the navigator registers the routes notifications point at', () => {
  it('reads a non-empty route table, so a silent regex miss cannot pass this file', () => {
    // Without this, a rename in RootNavigator that broke the match would make
    // `routes` empty and every assertion below vacuously... fail, in fact —
    // but `.some()` on an empty array is false, and a green suite for the
    // wrong reason is the failure mode worth naming explicitly.
    expect(routes).toEqual(expect.arrayContaining(['vehicle/:vehicleId', 'vehicle/:vehicleId/advisor']));
  });

  it('routes the advisor url', () => {
    expect(isRegistered(advisorUrl('abc'))).toBe(true);
  });

  it('routes the advisor url when it carries a question', () => {
    // `?ask=` is why the param exists — a recall notice promises an answer and
    // should deliver the question rather than an empty composer.
    expect(isRegistered(advisorUrl('abc', 'What does this recall mean?'))).toBe(true);
  });

  it('routes the vehicle url', () => {
    expect(isRegistered(vehicleUrl('abc'))).toBe(true);
  });

  it('routes the recalls url', () => {
    // Added 7 Aug with `RecallDetailScreen`. This is the assertion that fails
    // if the screen is registered under a different path than the notification
    // points at — the silent break this whole file exists for.
    expect(isRegistered(recallsUrl('abc'))).toBe(true);
    expect(routes).toContain('vehicle/:vehicleId/recalls');
  });
});

describe('recallNotification', () => {
  const notice = recallNotification({
    vehicleId: 'abc',
    vehicleName: '2018 Honda Accord',
    recallSummary: 'The rearview camera image may fail to display, reducing visibility.',
  });

  it('opens the recall screen, because the point is to act rather than only understand', () => {
    // Until 7 Aug this opened the advisor with the question pre-typed, which
    // explained a notice well and gave nobody a way to do anything about it.
    // The destination now carries the remedy, the severity and the fact that
    // the repair is free — and the advisor is one tap from there, per recall.
    expect(isRegistered(notice.url)).toBe(true);
    expect(pathOf(notice.url)).toBe('vehicle/abc/recalls');
  });

  it('carries no query string, because the screen loads the car’s own recalls', () => {
    // The `?ask=` payload belonged to the advisor destination. Leaving it on a
    // url the recall screen ignores is a parameter that looks meaningful and
    // is not.
    expect(notice.url).not.toContain('ask=');
  });

  it('names the owner’s car, not the model', () => {
    // A title about a model is indistinguishable from marketing.
    expect(notice.title).toContain('2018 Honda Accord');
  });

  it('survives an id that needs escaping', () => {
    // Ids come from the database, not from a literal. A url built by
    // concatenation breaks at the first character that means something in one.
    const url = advisorUrl('a b/c?d');
    expect(pathOf(url)).toBe('vehicle/a%20b%2Fc%3Fd/advisor');
  });
});

describe('serviceDueNotification', () => {
  const notice = serviceDueNotification({
    vehicleId: 'abc',
    vehicleName: 'Accord',
    serviceName: 'Oil change',
    reason: 'Due at 60,000 miles — you are at 60,300.',
  });

  it('opens the milestone screen, not the car and not the advisor', () => {
    // It opened `vehicle/:id` until 7 Aug, on the reasoning that "your oil
    // change is due" needs no explaining. True — and it left nowhere to act.
    // The milestone screen confirms the odometer, states what is due, and
    // offers each job to the wishlist, which is the chain the advisor prices.
    expect(pathOf(notice.url)).toBe('vehicle/abc/service');
    expect(isRegistered(notice.url)).toBe(true);
  });

  it('is routed by the navigator', () => {
    expect(routes).toContain('vehicle/:vehicleId/service');
    expect(isRegistered(serviceUrl('abc'))).toBe(true);
  });
});

describe('a long recall summary', () => {
  it('is cut to a whole word rather than mid-syllable', () => {
    const summary = 'x'.repeat(20) + ' ' + 'word '.repeat(60);

    const { body } = recallNotification({
      vehicleId: 'abc',
      vehicleName: 'Accord',
      recallSummary: summary,
    });

    expect(body).toContain('…');
    expect(body).not.toContain('wor…');
    expect(body).toContain('Tap to see what it means');
  });

  it('leaves a short summary alone', () => {
    const { body } = recallNotification({
      vehicleId: 'abc',
      vehicleName: 'Accord',
      recallSummary: 'Brake line corrosion.',
    });

    expect(body).toBe('Brake line corrosion. Tap to see what it means and what to do.');
  });
});

describe('a car with more than one recall', () => {
  /*
    ⚠ 22 Aug: a 2003 Accord's NHTSA record arrived with 24 campaigns on it, and
    the sweep had them queued as 24 separate pushes for one evening. The digest
    makes that one notification; this is what it is allowed to say.
  */
  const many = recallNotification({
    vehicleId: 'abc',
    vehicleName: '2003 Honda Accord',
    recallSummary: "The driver's air bag inflator may rupture.",
    campaignCount: 24,
  });

  it('leads with the count, because that is the actionable fact', () => {
    expect(many.title).toContain('24');
    expect(many.title).toContain('2003 Honda Accord');
  });

  it('says the recalls match the car rather than affect it', () => {
    /*
      ⚠ CLAUDE.md §10 — recalls match on **year, make and model, not VIN**.
      "24 recalls affect your car" claims this specific vehicle was checked
      against each campaign, which is the overclaim `health-claims.ts` was
      written to undo one screen over. The count is true; the stronger verb is
      not.
    */
    expect(many.title).toMatch(/match/i);
    expect(many.title).not.toMatch(/affect/i);
    expect(many.body).not.toMatch(/affect/i);
  });

  it('still names one of them, so the notice is not abstract', () => {
    expect(many.body).toContain('inflator may rupture');
  });

  it('lands on the same screen as a single recall', () => {
    expect(pathOf(many.url)).toBe('vehicle/abc/recalls');
  });

  it('leaves the single-recall copy exactly as it was', () => {
    /*
      Anti-vacuous. The common case is one recall, and a digest of one would be
      a regression in the ordinary path — "1 recalls match your Accord".
    */
    const one = recallNotification({
      vehicleId: 'abc',
      vehicleName: 'Accord',
      recallSummary: 'Brake line corrosion.',
      campaignCount: 1,
    });

    expect(one.title).toBe('Recall notice — Accord');
    expect(one.body).toBe('Brake line corrosion. Tap to see what it means and what to do.');
  });
});
