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

const mockStorageList = jest.fn<Promise<SupabaseResult>, any[]>(async () => ({
  data: [{ name: 'invoice-1.pdf' }, { name: 'invoice-2.jpg' }],
  error: null,
}));

const mockStorageRemove = jest.fn<Promise<SupabaseResult>, any[]>(async () => {
  ORDER.push('purge-storage');
  return { data: {}, error: null };
});

const mockVehiclesSelect = jest.fn<Promise<SupabaseResult>, any[]>(async () => ({
  data: [{ id: 'veh-1' }, { id: 'veh-2' }],
  error: null,
}));

let sessionResult: any = { ok: true, userId: 'user-1' };

jest.mock('@/lib/api-auth', () => ({
  requireSession: jest.fn(async () => sessionResult),
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: mockVehiclesSelect,
        in: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
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
  jest.clearAllMocks();
  sessionResult = { ok: true, userId: 'user-1' };
  mockDeleteUser.mockImplementation(async () => {
    ORDER.push('delete-auth-user');
    return { data: {}, error: null };
  });
  mockStorageRemove.mockImplementation(async () => {
    ORDER.push('purge-storage');
    return { data: {}, error: null };
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

  it('purges every vehicle folder, not just the first', async () => {
    await deleteAccount();
    expect(mockStorageList).toHaveBeenCalledTimes(2);
    expect(mockStorageRemove).toHaveBeenCalledTimes(2);
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
