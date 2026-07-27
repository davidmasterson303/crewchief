/**
 * Onboarding runs once — but "Add Vehicle" still has to work.
 *
 * @jest-environment node
 *
 * Task 1.6's third done-condition. Two things are being guarded here and only
 * one of them is in the plan's wording.
 *
 * The stated one: a returning user should not be dropped back into the VIN
 * form. The unstated one: `app/garage/page.tsx` links to `/onboard` from its
 * Add-vehicle buttons, so *every* user who clicks one already has a vehicle.
 * A guard keyed on vehicle count alone would redirect them straight back to
 * the garage and make a second car unaddable — a polish task turning into a
 * functional regression on the app's main flow. Hence `?from=garage`.
 *
 * The predicate itself is argued in `packages/core/src/onboarding.ts`: vehicle count, not
 * the profiles row, because the profile is trigger-created on signup and is
 * therefore true of a brand-new user.
 */

import { resolveOnboardingEntry } from '@crewchief/core/onboarding';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

describe('a brand-new user sees onboarding', () => {
  it('shows the form when they own nothing', () => {
    expect(resolveOnboardingEntry({ vehicleCount: 0 })).toEqual({ type: 'onboard' });
  });

  it('shows the form after signup, which arrives with no `from`', () => {
    // app/signup/page.tsx pushes /onboard with no query string.
    expect(resolveOnboardingEntry({ vehicleCount: 0, from: undefined })).toEqual({
      type: 'onboard',
    });
  });

  it('shows the form to someone who came from the demo', () => {
    expect(resolveOnboardingEntry({ vehicleCount: 0, from: 'demo' })).toEqual({
      type: 'onboard',
    });
  });
});

describe('a returning user does not see onboarding again', () => {
  it('redirects a user with one vehicle to the garage', () => {
    expect(resolveOnboardingEntry({ vehicleCount: 1 })).toEqual({
      type: 'redirect',
      location: '/garage',
    });
  });

  it.each([1, 2, 7])('redirects at a count of %i', (vehicleCount) => {
    expect(resolveOnboardingEntry({ vehicleCount })).toHaveProperty('type', 'redirect');
  });

  it('redirects to the garage even when they came from the demo', () => {
    // The reason for the redirect is that they have vehicles of their own, so
    // their own garage is the right destination — not back to /demo.
    expect(resolveOnboardingEntry({ vehicleCount: 3, from: 'demo' })).toEqual({
      type: 'redirect',
      location: '/garage',
    });
  });
});

describe('adding a second vehicle still works', () => {
  it('shows the form to an existing user who clicked Add Vehicle', () => {
    expect(resolveOnboardingEntry({ vehicleCount: 4, from: 'garage' })).toEqual({
      type: 'onboard',
    });
  });

  it('every /onboard link in the garage carries the marker', () => {
    // If someone adds a third Add-vehicle button without `?from=garage`, that
    // button silently becomes a redirect to the page it was clicked from.
    const source = readFileSync(join(ROOT, 'app/garage/page.tsx'), 'utf8');
    const links = source.match(/href="\/onboard[^"]*"/g) ?? [];

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toBe('href="/onboard?from=garage"');
    }
  });
});

describe('the predicate is vehicles, not profiles', () => {
  it('is not derived from the profiles row', () => {
    // supabase/migrations/20260726120000_create_profiles.sql creates the
    // profile from an AFTER INSERT trigger on auth.users, so every user has
    // one from the moment they sign up. A guard reading it would skip
    // onboarding for exactly the person who needs it. This asserts the
    // migration still behaves that way — if the trigger ever goes, the
    // reasoning in lib/onboarding.ts needs revisiting.
    const migration = readFileSync(
      join(ROOT, 'supabase/migrations/20260726120000_create_profiles.sql'),
      'utf8'
    );

    expect(migration).toMatch(/AFTER INSERT ON auth\.users/);
    expect(migration).toMatch(/INSERT INTO public\.profiles/);
  });

  it('never consults a profile in the decision', () => {
    const source = readFileSync(join(ROOT, 'packages/core/src/onboarding.ts'), 'utf8');
    const body = source.slice(source.indexOf('export function resolveOnboardingEntry'));
    expect(body).not.toMatch(/profile/i);
  });
});
