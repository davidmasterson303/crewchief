/**
 * Sign-out must not leave one account's data cached for the next one.
 *
 * @jest-environment node
 *
 * Task 1.6's first done-condition, and the reason it was done first. The
 * query client is a module-level singleton with a 30-minute `gcTime`, so
 * everything a signed-in user loaded — vehicles, documents, wishlist,
 * consultant transcripts — outlives their session unless something explicitly
 * drops it. On a shared machine the next person to sign in renders from that
 * cache before their own refetch resolves.
 *
 * This existed on the account-menu path and was missing from the
 * delete-account path. Not a wrong implementation — a second implementation
 * that fell behind the first. So the assertions below are in two halves:
 * that the helper actually empties the cache, and that neither component can
 * quietly stop using it.
 */

import { QueryClient } from '@tanstack/react-query';
import { signOutAndClearCache } from '@/lib/sign-out';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** A query client holding the kind of data a signed-in session accumulates. */
function populatedClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(['vehicles'], [{ id: 'v1', make: 'Honda', model: 'Accord' }]);
  client.setQueryData(['dashboard', 'v1'], { health_score: 82 });
  client.setQueryData(['documents', 'v1'], [{ id: 'd1', file_url: 'invoice.pdf' }]);
  client.setQueryData(['consultant', 'v1'], { message_history: ['hello'] });
  return client;
}

function fakeSupabase(signOut: () => Promise<unknown>) {
  return { auth: { signOut } } as never;
}

describe('signOutAndClearCache', () => {
  it('ends the Supabase session', async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    await signOutAndClearCache(fakeSupabase(signOut), populatedClient());
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache empty', async () => {
    const client = populatedClient();
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);

    await signOutAndClearCache(fakeSupabase(async () => ({ error: null })), client);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getQueryData(['vehicles'])).toBeUndefined();
    expect(client.getQueryData(['dashboard', 'v1'])).toBeUndefined();
    expect(client.getQueryData(['documents', 'v1'])).toBeUndefined();
    expect(client.getQueryData(['consultant', 'v1'])).toBeUndefined();
  });

  it('still clears the cache when the Supabase call fails', async () => {
    // The failure mode that matters: offline or a 500 on sign-out leaves the
    // session alive server-side, and if we skipped the clear on that branch
    // the previous user's data would stay cached in the tab.
    const client = populatedClient();

    await expect(
      signOutAndClearCache(
        fakeSupabase(async () => {
          throw new Error('network');
        }),
        client
      )
    ).resolves.toBeUndefined();

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('clears queries added by code that does not exist yet', async () => {
    // Guards the choice of `clear()` over an allowlist of removeQueries keys.
    // A future query key nobody remembered to add to a list is precisely the
    // regression this task is about.
    const client = new QueryClient();
    client.setQueryData(['some-key-invented-later', 'v1'], { secret: true });

    await signOutAndClearCache(fakeSupabase(async () => ({ error: null })), client);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('both sign-out paths go through the helper', () => {
  const paths = {
    'components/AccountMenu.tsx': 'the account menu',
    'components/DeleteAccountDialog.tsx': 'the delete-account dialog',
  } as const;

  it.each(Object.entries(paths))('%s imports signOutAndClearCache', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).toContain("from '@/lib/sign-out'");
    expect(source).toContain('signOutAndClearCache');
  });

  it.each(Object.entries(paths))('%s never calls auth.signOut() directly', (file) => {
    // A direct call is how the delete-account path lost its cache clear the
    // first time: sign-out written inline, cache clear written somewhere else,
    // and only one of the two copied when the second path was added.
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).not.toMatch(/auth\s*\.\s*signOut\s*\(/);
  });
});
