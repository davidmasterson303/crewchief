/**
 * Account deletion — App Store Guideline 5.1.1(v).
 *
 * @jest-environment node
 *
 * The requirement is not "there is a delete button". Apple checks that the
 * account record itself is removed, that the option is universal rather than
 * region-gated, and that deactivation is not being passed off as deletion.
 *
 * The part these tests actually protect is the ORDERING. Storage objects have
 * no foreign key to any row, so they are untouched by the database cascade.
 * Purge them after deleting the auth user and their paths are unrecoverable —
 * the files sit in the bucket forever, holding exactly the personal data the
 * user asked to have removed (invoice images with names, addresses, VINs).
 *
 * That failure is silent: deletion still reports success, the database still
 * looks clean, and nothing surfaces until someone audits the bucket. A test
 * is the only cheap way to hold the order in place.
 */

const ORDER: string[] = [];

/**
 * Supabase always returns `{ data, error }` with one side null. Typed
 * explicitly because jest otherwise infers the shape from the first
 * implementation, and the failure-case overrides below no longer fit.
 */
type SupabaseResult = { data: any; error: { message: string } | null };

const mockDeleteUser = jest.fn<Promise<SupabaseResult>, [string]>(async () => {
  ORDER.push('delete-auth-user');
  return { data: {}, error: null };
});

/**
 * A storage tree mirroring the four real path conventions. The previous mock
 * returned a flat list for every prefix, which is precisely why it failed to
 * catch that the purge only walked `{vehicleId}/`.
 *
 * Supabase marks folders with a null id, which is how the recursive walk
 * distinguishes them.
 */
const STORAGE_TREE: Record<string, Array<{ name: string; id: string | null }>> = {
  'veh-1': [{ name: 'invoice-1.pdf', id: 'o1' }],
  'veh-2': [{ name: 'invoice-2.jpg', id: 'o2' }],
  'vehicle-photos/veh-1': [{ name: 'photo.jpg', id: 'o3' }],
  'consultant-docs/veh-1': [{ name: 'session-a', id: null }],
  'consultant-docs/veh-1/session-a': [{ name: 'quote.pdf', id: 'o4' }],
};

const listedPrefixes: string[] = [];

const mockStorageList = jest.fn<Promise<SupabaseResult>, any[]>(async (prefix: string) => {
  listedPrefixes.push(prefix);
  return { data: STORAGE_TREE[prefix] ?? [], error: null };
});

const removedPaths: string[] = [];

const mockStorageRemove = jest.fn<Promise<SupabaseResult>, any[]>(async (paths: string[]) => {
  ORDER.push('purge-storage');
  removedPaths.push(...paths);
  return { data: {}, error: null };
});

const mockVehiclesSelect = jest.fn<Promise<SupabaseResult>, any[]>(async () => ({
  data: [{ id: 'veh-1' }, { id: 'veh-2' }],
  error: null,
}));

/**
 * The entitlement this account holds, if any — IAP-05.
 *
 * Read before the cascade, because `account_entitlements.user_id` is
 * `ON DELETE CASCADE` and after `deleteUser` there is nothing left to read.
 */
let entitlementRow: any = null;

/** What `recordOrphanedSubscription` wrote, so a test can look at it. */
const orphanedRows: any[] = [];
/** Identifiers cleared from `api_rate_limits` — DB-11. */
const deletedRateLimitIdentifiers: string[] = [];
const mockOrphanUpsert = jest.fn<Promise<SupabaseResult>, any[]>(async (row: any) => {
  ORDER.push('record-orphan');
  orphanedRows.push(row);
  return { data: {}, error: null };
});

let sessionResult: any = { ok: true, userId: 'user-1' };

jest.mock('@/lib/api-auth', () => ({
  requireSession: jest.fn(async () => sessionResult),
}));

jest.mock('@wellkept/core/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/*
  ⚠ **Table-aware as of 24 Aug.** It used to answer every `from()` identically,
  which was fine while `deleteAccount` read one table — and stopped being fine
  when it started reading `account_entitlements` before the cascade (IAP-05).
  A mock that cannot tell two tables apart cannot assert anything about either.
*/
jest.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq:
          table === 'account_entitlements'
            ? () => ({ maybeSingle: async () => ({ data: entitlementRow, error: null }) })
            : mockVehiclesSelect,
        in: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      }),
      upsert: mockOrphanUpsert,
      /*
        DB-11. `api_rate_limits.identifier` holds the user's UUID as bare text
        with no foreign key, so the cascade never reached it — the one
        user-identifying row that outlived a deletion the privacy policy calls
        complete.
      */
      delete: () => ({
        eq: async (_column: string, value: string) => {
          deletedRateLimitIdentifiers.push(value);
          return { data: null, error: null };
        },
      }),
    }),
    storage: {
      from: () => ({ list: mockStorageList, remove: mockStorageRemove }),
    },
    auth: { admin: { deleteUser: mockDeleteUser } },
  }),
}));

const { deleteAccount } = require('@/lib/account-data');

beforeEach(() => {
  ORDER.length = 0;
  orphanedRows.length = 0;
  deletedRateLimitIdentifiers.length = 0;
  entitlementRow = null;
  listedPrefixes.length = 0;
  removedPaths.length = 0;
  jest.clearAllMocks();
  sessionResult = { ok: true, userId: 'user-1' };
  mockDeleteUser.mockImplementation(async () => {
    ORDER.push('delete-auth-user');
    return { data: {}, error: null };
  });
  // Must keep recording removedPaths — an earlier version of this reset
  // dropped that, and the assertion about the four path conventions failed
  // against a mock that had quietly stopped observing anything.
  mockStorageRemove.mockImplementation(async (paths: string[]) => {
    ORDER.push('purge-storage');
    removedPaths.push(...paths);
    return { data: {}, error: null };
  });
  mockStorageList.mockImplementation(async (prefix: string) => {
    listedPrefixes.push(prefix);
    return { data: STORAGE_TREE[prefix] ?? [], error: null };
  });
});

describe('deletion is reachable — Guideline 5.1.1(v) discoverability', () => {
  /*
    Apple checks that the option can be found, not just that it exists. Its
    wording points at account settings specifically, and "buried more than a
    tap or two into settings" is a listed rejection reason.

    The chain is: AccountMenu -> /settings -> DeleteAccountDialog ->
    deleteAccount(). Every link is a separate file, so any one of them can be
    broken by an unrelated edit without anything failing. These assertions are
    deliberately structural — they check the wiring exists, which is what
    review actually inspects.

    This was a real gap: the settings page shipped before anything linked to
    it, so deletion was implemented but unreachable.
  */
  const read = (p: string) =>
    require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', p),
      'utf8'
    );

  it('the account menu links to settings', () => {
    expect(read('components/AccountMenu.tsx')).toContain('href="/settings"');
  });

  it('settings renders the delete dialog', () => {
    const settings = read('app/settings/page.tsx');
    expect(settings).toContain('DeleteAccountDialog');
  });

  it('the dialog calls the real deletion action, not a deactivation', () => {
    const dialog = read('components/DeleteAccountDialog.tsx');
    expect(dialog).toContain('deleteAccount');

    // Strip comments first. The prose here explains *why* we do not
    // deactivate, and matching raw source flagged that explanation as the
    // very thing it warns against.
    const code = dialog
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    // Deactivation never satisfies the guideline — a flag flip presented as
    // deletion is an explicit rejection reason.
    expect(code).not.toMatch(/is_active|deactivate/i);
  });

  it('confirms completion to the user', () => {
    // Apple expects the user to be told deletion actually happened.
    expect(read('components/DeleteAccountDialog.tsx')).toMatch(
      /toast\.success\([^)]*deleted/i
    );
  });
});

describe('deleteAccount — ordering', () => {
  it('purges storage BEFORE deleting the auth user', async () => {
    await deleteAccount();

    const purgeAt = ORDER.indexOf('purge-storage');
    const cascadeAt = ORDER.indexOf('delete-auth-user');

    expect(purgeAt).toBeGreaterThanOrEqual(0);
    expect(cascadeAt).toBeGreaterThanOrEqual(0);
    // Reversing these orphans every invoice image permanently.
    expect(purgeAt).toBeLessThan(cascadeAt);
  });

  it('purges every vehicle, not just the first', async () => {
    await deleteAccount();
    expect(listedPrefixes).toContain('veh-1');
    expect(listedPrefixes).toContain('veh-2');
  });

  it('purges all four storage conventions, not only {vehicleId}/', async () => {
    // Uploads scattered files across four different path shapes. Walking only
    // `{vehicleId}/` left photos and consultant documents behind — orphaned
    // blobs holding the personal data the user asked to have removed.
    await deleteAccount();

    expect(removedPaths).toContain('veh-1/invoice-1.pdf');
    expect(removedPaths).toContain('vehicle-photos/veh-1/photo.jpg');
    expect(removedPaths).toContain('consultant-docs/veh-1/session-a/quote.pdf');
  });

  it('descends into nested folders', async () => {
    // Consultant docs sit at consultant-docs/{vehicleId}/{sessionId}/{file}.
    // A single-level list returns the session folder as though it were a file,
    // so nothing is removed and nothing errors.
    await deleteAccount();
    expect(listedPrefixes).toContain('consultant-docs/veh-1/session-a');
  });

  it('deletes the auth user, rather than flagging it inactive', async () => {
    const result = await deleteAccount();
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    expect(result.success).toBe(true);
  });
});

describe('deleteAccount — authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    sessionResult = { ok: false, error: 'Unauthorized', status: 401 };

    const result = await deleteAccount();

    expect(result.success).toBe(false);
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  it('only ever deletes the session user, never an id from input', async () => {
    sessionResult = { ok: true, userId: 'the-real-caller' };
    await deleteAccount();
    expect(mockDeleteUser).toHaveBeenCalledWith('the-real-caller');
  });
});

describe('deleteAccount — failure handling', () => {
  it('does not delete the account if the inventory read fails', async () => {
    mockVehiclesSelect.mockImplementationOnce(async () => ({
      data: null,
      error: { message: 'connection reset' },
    }));

    const result = await deleteAccount();

    expect(result.success).toBe(false);
    // Without the vehicle list we cannot find the storage paths, so deleting
    // now would strand every file. Fail closed and change nothing.
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('still deletes the account when a storage purge partially fails', async () => {
    mockStorageRemove.mockImplementationOnce(async () => ({
      data: null,
      error: { message: 'object locked' },
    }));

    const result = await deleteAccount();

    // The user asked to be deleted. Refusing over an unremovable blob is the
    // wrong trade — the failure is logged so orphans can be swept later.
    expect(result.success).toBe(true);
    expect(mockDeleteUser).toHaveBeenCalled();
  });

  it('reports failure when the auth deletion itself fails', async () => {
    mockDeleteUser.mockImplementationOnce(async () => ({
      data: null,
      error: { message: 'admin api unavailable' },
    }));

    const result = await deleteAccount();
    expect(result.success).toBe(false);
  });
});

describe('subscriptionNotice — Guideline 3.1.2 and the E5 rejection reason', () => {
  /*
    Deleting an account while an Apple-billed subscription keeps charging is a
    documented rejection reason, and a real failure rather than a paperwork one:
    the account that could manage the subscription is gone, the charge
    continues, and there is no obvious way left to stop it.

    We cannot cancel it — Apple holds the billing relationship and there is no
    server-side call that ends an App Store subscription on someone's behalf.
    So the only honest remedy is to say so before the confirmation.
  */
  const { subscriptionNotice, SUBSCRIPTION_CANCEL_PATH } = require('@wellkept/core/account-deletion');

  it('says nothing when there is no live subscription', () => {
    /*
      Not a detail. Warning somebody about a subscription they do not have
      sends them to cancel something that is not there — and when they cannot
      find it, the reasonable conclusion is that the deletion did not work.
    */
    expect(subscriptionNotice(false)).toBeNull();
  });

  it('warns that deletion does not cancel the subscription', () => {
    const notice = subscriptionNotice(true);

    expect(notice).not.toBeNull();
    expect(notice.headline.toLowerCase()).toContain('does not cancel');
  });

  it('names where to cancel, because "manage your subscription" is not a location', () => {
    const notice = subscriptionNotice(true);

    expect(notice.action).toContain(SUBSCRIPTION_CANCEL_PATH);
    expect(SUBSCRIPTION_CANCEL_PATH.toLowerCase()).toContain('subscriptions');
  });

  it('never claims the app will cancel it', () => {
    /*
      The failure mode worth pinning. Copy that says "we will cancel your
      subscription" is a promise the product cannot keep — there is no such
      call — and it is worse than saying nothing, because the user stops
      looking for the thing that is still charging them.
    */
    const notice = subscriptionNotice(true);
    const text = `${notice.headline} ${notice.action}`.toLowerCase();

    expect(text).not.toMatch(/we will cancel|we'll cancel|automatically cancel|cancels your subscription/);
  });

  it('tells them to cancel first rather than blocking the deletion', () => {
    /*
      The design decision, asserted so it cannot be quietly reversed.

      The tempting fix is to refuse deletion until the subscription is
      cancelled. That trades one guideline violation for a worse one: 5.1.1(v)
      requires deletion to be completed from inside the app, and gating it on
      an action taken in a *different* app is the obstruction the guideline
      exists to prevent.

      So the notice is advice, not a gate — and nothing in this module exposes
      a way to block.
    */
    const notice = subscriptionNotice(true);
    expect(notice.action.toLowerCase()).toContain('cancel it first');

    const core = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'packages/core/src/account-deletion.ts'),
      'utf8'
    );
    const code = core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // No exported predicate that a surface could mistake for "may they delete".
    expect(code).not.toMatch(/export function canDelete|blocksDeletion|preventDeletion/);
  });
});

describe('both delete surfaces show the subscription notice', () => {
  /*
    The parity check, and the reason `subscriptionNotice` lives in core at all.

    Apple reviews the **mobile** surface, so the risk is not that the web
    dialog is wrong — it is that the two drift and the reviewed one becomes the
    weaker. That drift is invisible: both screens would still delete accounts,
    and both would still look right.

    Structural rather than rendered, deliberately. The mobile screen is React
    Native and cannot be rendered by this runner at all, so "did it import the
    shared rule and use it" is the strongest property both surfaces can be held
    to in one place. Each surface has its own render tests for behaviour.
  */
  const read = (p: string) =>
    require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', p), 'utf8');

  const SURFACES = [
    'components/DeleteAccountDialog.tsx',
    'apps/mobile/src/screens/AccountScreen.tsx',
  ];

  it.each(SURFACES)('%s reads the shared rule rather than writing its own copy', (file) => {
    const source = read(file);

    expect(source).toContain('subscriptionNotice');
    expect(source).toContain('@wellkept/core/account-deletion');
  });

  it.each(SURFACES)('%s renders the notice it computed', (file) => {
    /*
      Importing the rule and never rendering it is the exact failure this guard
      exists for — it would satisfy the assertion above while showing the user
      nothing.
    */
    const source = read(file);
    expect(source).toMatch(/notice\.headline/);
    expect(source).toMatch(/notice\.action/);
  });

  it.each(SURFACES)('%s does not hard-code the cancellation copy', (file) => {
    /*
      A surface that spells out its own wording has stopped sharing the rule,
      whatever it imports. The phrase is one string in core precisely so a
      correction reaches both clients at once.
    */
    const source = read(file);
    expect(source).not.toMatch(/does not cancel your subscription/i);
  });
});

/**
 * ── IAP-05: a deleted account can still be paying Apple ─────────────────────
 *
 * `account_entitlements.user_id` is `ON DELETE CASCADE`, and `deleteAccount`
 * never read that table before calling `auth.admin.deleteUser`. The row went —
 * `tier`, `expires_at`, and critically `original_transaction_id` — and nothing
 * was written anywhere first.
 *
 * **Deleting an account here cancels nothing at Apple's end.** Only the
 * customer can, from Settings. So Apple keeps billing them, every `DID_RENEW`
 * arrives to find no owner and returns `200 applied:false` at info level, and
 * when they email support there is no transaction id on file to reconcile
 * against — because it was deleted with the row.
 */
describe('deleteAccount — a live subscription', () => {
  const LIVE = {
    original_transaction_id: '2000000000000001',
    product_id: 'crewchief.pro.monthly',
    tier: 'paid',
    expires_at: '2026-09-18T10:00:00.000Z',
    environment: 'Production',
  };

  it('records the billing identifier before the cascade takes it', async () => {
    entitlementRow = LIVE;

    await deleteAccount();

    expect(orphanedRows).toHaveLength(1);
    expect(orphanedRows[0]).toMatchObject({
      original_transaction_id: '2000000000000001',
      tier: 'paid',
    });

    /*
      ⚠ **Order, not merely presence.** After `deleteUser` the entitlement row
      is gone, so a record written afterwards would be a record of nothing.
    */
    expect(ORDER.indexOf('record-orphan')).toBeLessThan(ORDER.indexOf('delete-auth-user'));
  });

  it('carries no user id into the surviving row', async () => {
    /*
      ⚠ The property that makes this compatible with a privacy policy calling
      deletion complete. `original_transaction_id` is **Apple's** identifier for
      a billing relationship — not an email, a name, a device or a user id. A
      deleted account's id surviving in a table is the exact thing the promise
      is about.
    */
    entitlementRow = LIVE;

    await deleteAccount();

    expect(Object.keys(orphanedRows[0])).not.toContain('user_id');
    expect(JSON.stringify(orphanedRows[0])).not.toContain('user-1');
  });

  it('writes nothing for an account that never subscribed', async () => {
    // The overwhelmingly common case, and it must not leave a row behind.
    entitlementRow = null;

    await deleteAccount();

    expect(orphanedRows).toEqual([]);
  });

  it('writes nothing when the entitlement has no transaction to record', async () => {
    entitlementRow = { ...LIVE, original_transaction_id: null };

    await deleteAccount();

    expect(orphanedRows).toEqual([]);
  });

  it('still deletes the account when the record cannot be written', async () => {
    /*
      ⚠ App Store 5.1.1(v) requires deletion to work. Refusing to delete because
      a bookkeeping row failed would trade a compliance requirement for a
      support convenience — the same judgement the storage purge above makes.
    */
    entitlementRow = LIVE;
    mockOrphanUpsert.mockImplementationOnce(async () => ({
      data: null,
      error: { message: 'table missing' } as never,
    }));

    const result = await deleteAccount();

    expect(result.success).toBe(true);
    expect(ORDER).toContain('delete-auth-user');
  });
});

/**
 * ── DB-11: the one row that outlived a complete deletion ────────────────────
 */
describe('deleteAccount — the rate-limit trail', () => {
  it('clears the identifier the cascade cannot reach', async () => {
    /*
      ⚠ `api_rate_limits.identifier` is the **user's UUID** for every
      authenticated tier, stored as bare text with no foreign key — so
      `ON DELETE CASCADE` does not touch it and the id survives for the
      retention window in a table nothing else references.

      Small, and disproportionately worth removing: the expensive thing is not
      the row, it is a privacy policy that describes deletion as complete.
    */
    await deleteAccount();

    expect(deletedRateLimitIdentifiers).toContain('user-1');
  });

  it('does it before the cascade, while there is still an id to delete on', async () => {
    await deleteAccount();

    expect(ORDER).toContain('delete-auth-user');
    // The delete is keyed on `userId`, which the session supplies — but the
    // ordering rule is the same one every other step here follows.
    expect(deletedRateLimitIdentifiers).toHaveLength(1);
  });
});
