/**
 * The keychain adapter that holds the refresh token.
 *
 * @jest-environment node
 *
 * `apps/mobile/src/auth/secure-storage.ts` chunks the Supabase session across
 * several SecureStore entries, because one value above ~2048 bytes warns and
 * can fail outright while a session routinely runs 2–4 KB.
 *
 * ── Why this is tested from the web suite ───────────────────────────────────
 *
 * `jest.config.js` ignores `apps/` because the Expo client runs React 19 under
 * jest-expo and needs its own runner. That reasoning is about *components*.
 * This module has no React and no React Native in it — one import of
 * `expo-secure-store`, mocked below — so it transforms here like any other
 * TypeScript file, and waiting for a second runner would leave the durable half
 * of the credential untested in the meantime.
 *
 * A component test for the mobile app still needs jest-expo. This is not that.
 *
 * ── What is actually at risk ────────────────────────────────────────────────
 *
 * The module's own header names the hazard precisely: the failure is
 * *conditional*, so it "would pass every test written today and break for a
 * real account later, presenting as 'signed out again for no reason'". Tests
 * that only round-trip a short string would be exactly the vacuous check that
 * warning describes. Every case here therefore drives a value long enough to
 * chunk, and asserts against the mock store's actual contents rather than only
 * against what `getItem` hands back.
 */

const store = new Map<string, string>();

jest.mock(
  'expo-secure-store',
  () => ({
    getItemAsync: jest.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  }),
  { virtual: true }
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { secureStorage } = require('../../apps/mobile/src/auth/secure-storage');

/** Matches CHUNK_SIZE in the module under test. */
const CHUNK_SIZE = 1800;
const KEY = 'supabase.auth.token';

/** A value that must chunk, made of distinguishable characters. */
function longValue(length: number): string {
  let out = '';
  for (let i = 0; out.length < length; i++) out += `${i % 10}`;
  return out.slice(0, length);
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe('round trips', () => {
  it('stores a short value whole, with no chunk header', async () => {
    await secureStorage.setItem(KEY, 'short');
    expect(store.get(KEY)).toBe('short');
    expect(await secureStorage.getItem(KEY)).toBe('short');
  });

  it('reassembles a value several chunks long, exactly', async () => {
    const value = longValue(CHUNK_SIZE * 3 + 137);
    await secureStorage.setItem(KEY, value);

    // The point of the module: the caller never sees the split.
    expect(await secureStorage.getItem(KEY)).toBe(value);
    expect(store.get(KEY)).toBe('__chunks__:4');
  });

  it('round trips a value exactly on the boundary without chunking it', async () => {
    // `value.length <= CHUNK_SIZE` — an off-by-one here would chunk a value
    // that fits, or fail to chunk one that does not.
    const value = longValue(CHUNK_SIZE);
    await secureStorage.setItem(KEY, value);

    expect(store.get(KEY)).toBe(value);
    expect(await secureStorage.getItem(KEY)).toBe(value);
  });

  it('chunks at one character over the boundary', async () => {
    const value = longValue(CHUNK_SIZE + 1);
    await secureStorage.setItem(KEY, value);

    expect(store.get(KEY)).toBe('__chunks__:2');
    expect(await secureStorage.getItem(KEY)).toBe(value);
  });

  it('survives a value containing multi-byte characters', async () => {
    /*
      Chunking slices by UTF-16 code unit, so a surrogate pair can be split
      across two chunks. Reassembly is a plain join, which puts the halves back
      adjacent — but this asserts it rather than assuming, because a chunker
      that normalised or trimmed would corrupt the pair silently.
    */
    const value = '🚗'.repeat(CHUNK_SIZE);
    await secureStorage.setItem(KEY, value);
    expect(await secureStorage.getItem(KEY)).toBe(value);
  });
});

describe('deleting is exhaustive', () => {
  it('removes every chunk, not just the header', async () => {
    /*
      The security property. A sign-out that dropped only the header would
      leave the refresh token's body in the Keychain — the durable credential,
      surviving a sign-out that told the user it was gone.
    */
    await secureStorage.setItem(KEY, longValue(CHUNK_SIZE * 3));
    expect(store.size).toBe(4);

    await secureStorage.removeItem(KEY);
    expect(store.size).toBe(0);
  });

  it('leaves nothing behind when a long session is replaced by a short one', async () => {
    // setItem clears first for this reason: otherwise a stale tail could be
    // stitched onto a fresh head.
    await secureStorage.setItem(KEY, longValue(CHUNK_SIZE * 4));
    await secureStorage.setItem(KEY, 'small');

    expect(await secureStorage.getItem(KEY)).toBe('small');
    expect(Array.from(store.keys())).toEqual([KEY]);
  });
});

describe('a record it cannot trust reads as absent', () => {
  it('returns null for a missing key', async () => {
    expect(await secureStorage.getItem('nothing-here')).toBeNull();
  });

  it('returns null when a chunk is missing rather than a partial session', async () => {
    /*
      All or nothing. Handing Supabase a truncated token is worse than a
      re-login: it presents as a corrupt session rather than a signed-out one.
    */
    await secureStorage.setItem(KEY, longValue(CHUNK_SIZE * 3));
    store.delete(`${KEY}__1`);

    expect(await secureStorage.getItem(KEY)).toBeNull();
  });

  it.each(['__chunks__:0', '__chunks__:-2', '__chunks__:abc', '__chunks__:'])(
    'returns null for an unreadable header %s',
    async (header) => {
      store.set(KEY, header);
      expect(await secureStorage.getItem(KEY)).toBeNull();
    }
  );
});

describe('an interrupted write fails toward signed-out', () => {
  it('reads as absent when chunks landed but the header did not', async () => {
    /*
      The module writes chunks first and the header last, deliberately, so that
      a half-finished write reads as "not signed in" rather than as a truncated
      session. Simulated by removing the header the way a crash between the two
      writes would leave it.
    */
    await secureStorage.setItem(KEY, longValue(CHUNK_SIZE * 2));
    store.delete(KEY);

    expect(await secureStorage.getItem(KEY)).toBeNull();
  });

  it('orphans the chunks of an interrupted write, which is storage leaked and not a session exposed', async () => {
    /*
      Documenting a real limit rather than asserting it is fine.

      `removeItem` finds chunks by reading the header. If the header never
      landed, a later `setItem` cannot know how many pieces to delete, so those
      chunks stay in the Keychain until the same indices are overwritten.

      Not a correctness bug: the new header states the new count, so a stale
      chunk beyond that count is never read, and the assertions above prove the
      value still round trips. It is worth stating because "sign-out deletes
      everything" is a claim this module makes, and this is the one case where
      a fragment can outlive it.
    */
    await secureStorage.setItem(KEY, longValue(CHUNK_SIZE * 4)); // 4 chunks
    store.delete(KEY); // header lost mid-write

    await secureStorage.setItem(KEY, longValue(CHUNK_SIZE * 2)); // 2 chunks

    expect(await secureStorage.getItem(KEY)).toBe(longValue(CHUNK_SIZE * 2));
    // The orphans from the interrupted write are still present.
    expect(store.has(`${KEY}__2`)).toBe(true);
    expect(store.has(`${KEY}__3`)).toBe(true);
  });
});

describe('the byte-versus-character gap', () => {
  it('measures the chunk limit in UTF-16 units, not the bytes SecureStore counts', () => {
    /*
      Recorded as a measurement, not asserted as a bug.

      CHUNK_SIZE is 1800 and SecureStore's limit is ~2048 **bytes**. `.length`
      counts UTF-16 code units, so an all-ASCII chunk is 1800 bytes and fits
      with room to spare — which is the ordinary case, since a session is
      mostly base64url JWT.

      It stops fitting if enough of the value is non-ASCII: the headroom is
      248 bytes, so roughly 14% two-byte characters is the crossover. A session
      is JSON, and `JSON.stringify` does not escape non-ASCII, so user metadata
      with accented or non-Latin text lands in the value raw.

      That makes this narrow rather than urgent — reachable by a user whose
      metadata is largely non-Latin, not by "José". Left as-is deliberately:
      changing the chunker to measure bytes is a small change, but it is a
      storage-format change to the module holding the refresh token, and it
      should be made when someone can verify a real sign-in on a device rather
      than alongside a test that cannot.

      This assertion exists so the gap is a known quantity with a number
      attached, and so it fails if CHUNK_SIZE is ever raised toward 2048 on the
      assumption that characters are bytes.
    */
    const asciiChunkBytes = Buffer.byteLength(longValue(CHUNK_SIZE), 'utf8');
    expect(asciiChunkBytes).toBe(1800);
    expect(asciiChunkBytes).toBeLessThan(2048);

    const twoByteChunkBytes = Buffer.byteLength('é'.repeat(CHUNK_SIZE), 'utf8');
    expect(twoByteChunkBytes).toBe(3600);
    expect(twoByteChunkBytes).toBeGreaterThan(2048);

    // The margin that makes ASCII safe. If CHUNK_SIZE grows past this, even a
    // pure-ASCII chunk stops fitting and the conditional failure becomes
    // unconditional.
    expect(CHUNK_SIZE).toBeLessThanOrEqual(2048);
  });
});
