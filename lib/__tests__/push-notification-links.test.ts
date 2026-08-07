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
  serviceDueNotification,
  vehicleUrl,
} from '@crewchief/core/notifications';

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
});

describe('recallNotification', () => {
  const notice = recallNotification({
    vehicleId: 'abc',
    vehicleName: '2018 Honda Accord',
    recallSummary: 'The rearview camera image may fail to display, reducing visibility.',
  });

  it('opens the advisor, because a recall notice is the thing nobody can read', () => {
    // "FMVSS 111 rear visibility" tells an owner nothing. Explaining it is the
    // one thing this product does that a recall lookup does not, so the
    // notification opens the surface that explains it.
    expect(isRegistered(notice.url)).toBe(true);
    expect(pathOf(notice.url)).toBe('vehicle/abc/advisor');
  });

  it('arrives with the question already asked', () => {
    expect(notice.url).toContain('ask=');
    expect(decodeURIComponent(notice.url.split('ask=')[1])).toContain('Accord');
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

  it('opens the car, not the advisor', () => {
    // The asymmetry with the recall is the point: "your oil change is due" is
    // already understood, and opening a chat to be told what an oil change is
    // would be worse than opening the car.
    expect(pathOf(notice.url)).toBe('vehicle/abc');
    expect(isRegistered(notice.url)).toBe(true);
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
    expect(body).toContain('Tap to ask the advisor');
  });

  it('leaves a short summary alone', () => {
    const { body } = recallNotification({
      vehicleId: 'abc',
      vehicleName: 'Accord',
      recallSummary: 'Brake line corrosion.',
    });

    expect(body).toBe('Brake line corrosion. Tap to ask the advisor what it means.');
  });
});
