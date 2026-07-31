import * as SecureStore from 'expo-secure-store';

/**
 * Where the session lives on the device.
 *
 * **Keychain, not AsyncStorage.** A Supabase session is an access token plus a
 * refresh token, and the refresh token is the durable credential — it mints
 * new access tokens until it is revoked. AsyncStorage is unencrypted files in
 * the app container: readable from a jailbroken device, and readable from an
 * unencrypted device backup. `expo-secure-store` puts it in the iOS Keychain.
 *
 * ── The limit that catches people out ───────────────────────────────────────
 *
 * SecureStore warns above ~2048 bytes per value and can fail outright. A
 * Supabase session is comfortably over that: two JWTs plus a serialised user
 * object routinely lands between 2 and 4 KB, and it grows with the claims in
 * the token.
 *
 * This is a nasty failure because it is *conditional*. It works for a small
 * user object and starts failing when someone's claims grow — so it would pass
 * every test written today and break for a real account later, presenting as
 * "signed out again for no reason".
 *
 * So values are chunked. A record's first chunk holds a count, and the reader
 * reassembles. Chunk boundaries are an implementation detail of this module;
 * nothing outside it knows the value was split.
 *
 * ── Deleting has to be exhaustive ───────────────────────────────────────────
 *
 * Sign-out that removed only the first chunk would leave the rest of a refresh
 * token in the Keychain — the durable half of the credential, surviving a
 * sign-out that told the user it was gone. `removeItem` walks the count and
 * deletes every piece.
 */

/** Comfortably under SecureStore's limit, leaving room for the key itself. */
const CHUNK_SIZE = 1800;

/** Marks a chunked record and states how many pieces follow. */
const CHUNK_PREFIX = '__chunks__:';

function chunkKey(key: string, index: number): string {
  return `${key}__${index}`;
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key);
    if (head === null) return null;

    if (!head.startsWith(CHUNK_PREFIX)) return head;

    const count = Number(head.slice(CHUNK_PREFIX.length));
    if (!Number.isInteger(count) || count < 1) {
      // A header we cannot read means a record we cannot trust. Treat it as
      // absent rather than returning a partial session: signing the user in
      // again is a far better outcome than handing Supabase half a token.
      return null;
    }

    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      // A missing chunk is the same problem. All or nothing.
      if (part === null) return null;
      parts.push(part);
    }

    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    // Always clear first: a long value replaced by a short one would otherwise
    // leave orphaned chunks behind, and the next read would happily stitch a
    // stale tail onto a fresh head.
    await this.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const parts: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      parts.push(value.slice(i, i + CHUNK_SIZE));
    }

    /*
      Chunks first, header last. If the write is interrupted the header is
      absent, so the record reads as "not signed in" rather than as a
      truncated session — the safe direction.
    */
    for (let i = 0; i < parts.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), parts[i]);
    }
    await SecureStore.setItemAsync(key, `${CHUNK_PREFIX}${parts.length}`);
  },

  async removeItem(key: string): Promise<void> {
    const head = await SecureStore.getItemAsync(key);

    if (head?.startsWith(CHUNK_PREFIX)) {
      const count = Number(head.slice(CHUNK_PREFIX.length));
      if (Number.isInteger(count)) {
        for (let i = 0; i < count; i++) {
          await SecureStore.deleteItemAsync(chunkKey(key, i));
        }
      }
    }

    await SecureStore.deleteItemAsync(key);
  },
};
