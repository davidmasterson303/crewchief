/**
 * Performance-stat recomputation — the paths that must never reach Gemini.
 *
 * @jest-environment node
 *
 * This logic was inside `app/api/performance-stats/route.ts` and therefore
 * untestable: reaching it meant standing up a route handler, and the only
 * other caller reached it over an internal HTTP request. It now lives in
 * `lib/performance-stats.ts`, so the two branches that decide whether real
 * money is spent can finally be asserted.
 *
 * The demo branch is the one that matters most. Demo vehicles are shared,
 * anonymous and linked from a public portfolio; they carry no mod hash, so
 * without the short-circuit every anonymous page view would trigger a Gemini
 * call and a write against data anyone can reach — unbounded cost that any
 * visitor can run up.
 */

import {
  recomputePerformanceStats,
  computeModHash,
  extractJSON,
} from '@/lib/performance-stats';

const generateContent = jest.fn();

jest.mock('@/lib/gemini', () => ({
  genAI: { models: { generateContent: (...args: unknown[]) => generateContent(...args) } },
  flashStructuredConfig: {},
}));

/**
 * Minimal Supabase stand-in. `select`/`eq`/`update` chain; the object itself
 * is thenable, so both `await client.from(t).select().eq()` and
 * `.maybeSingle()` resolve to whatever the table was seeded with.
 */
function fakeClient(tables: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];

  const client = {
    updates,
    from(table: string) {
      const result = tables[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return chain;
        },
        maybeSingle: async () => result,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };

  return client as never as Parameters<typeof recomputePerformanceStats>[0]['client'] & {
    updates: Record<string, unknown>[];
  };
}

const DEMO_VEHICLE = {
  id: 'demo-1',
  year: 2018,
  make: 'Honda',
  model: 'Accord',
  stock_hp: 192,
  stock_torque: 192,
  stock_zero_to_sixty: 7.2,
  modified_hp: null,
  modified_torque: null,
  modified_zero_to_sixty: null,
};

beforeEach(() => {
  generateContent.mockReset();
});

describe('a demo vehicle never reaches the model', () => {
  it('serves seeded stats without calling Gemini', async () => {
    const client = fakeClient({ vehicles: { data: DEMO_VEHICLE, error: null } });

    const result = await recomputePerformanceStats({
      vehicleId: 'demo-1',
      client,
      isDemo: true,
    });

    expect(generateContent).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      cached: true,
      stats: {
        stock_hp: 192,
        stock_torque: 192,
        stock_zero_to_sixty: 7.2,
        modified_hp: null,
        modified_torque: null,
        modified_zero_to_sixty: null,
        completed_mods: [],
      },
    });
  });

  it('writes nothing back to shared demo data', async () => {
    const client = fakeClient({ vehicles: { data: DEMO_VEHICLE, error: null } });

    await recomputePerformanceStats({ vehicleId: 'demo-1', client, isDemo: true });

    expect(client.updates).toHaveLength(0);
  });

  it('short-circuits even when forceRefresh is set', async () => {
    // forceRefresh comes off the request body, so it is caller-controlled.
    const client = fakeClient({ vehicles: { data: DEMO_VEHICLE, error: null } });

    await recomputePerformanceStats({
      vehicleId: 'demo-1',
      client,
      isDemo: true,
      forceRefresh: true,
    });

    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('an unchanged service history never reaches the model', () => {
  const OWNED_VEHICLE = {
    ...DEMO_VEHICLE,
    id: 'owned-1',
    perf_stats_mod_hash: 'Cold air intake',
  };

  it('returns cached stats when the mod hash still matches', async () => {
    const client = fakeClient({
      vehicles: { data: OWNED_VEHICLE, error: null },
      modification_tracking: { data: [{ mod_name: 'Cold air intake' }], error: null },
      maintenance_line_items: { data: [], error: null },
    });

    const result = await recomputePerformanceStats({
      vehicleId: 'owned-1',
      client,
      isDemo: false,
    });

    expect(generateContent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, cached: true });
  });

  it('calls the model once the history changes', async () => {
    generateContent.mockResolvedValue({
      text: '{"stock":{"hp":192,"torque":192,"zero_to_sixty":7.2},"performance_mods":["Downpipe"],"modified":{"hp":230,"torque":250,"zero_to_sixty":6.4}}',
    });

    const client = fakeClient({
      vehicles: { data: OWNED_VEHICLE, error: null },
      modification_tracking: {
        data: [{ mod_name: 'Cold air intake' }, { mod_name: 'Downpipe' }],
        error: null,
      },
      maintenance_line_items: { data: [], error: null },
    });

    const result = await recomputePerformanceStats({
      vehicleId: 'owned-1',
      client,
      isDemo: false,
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, cached: false });
    expect(client.updates[0]).toMatchObject({ modified_hp: 230 });
  });
});

describe('a missing vehicle is a 404, not a crash', () => {
  it('returns not found without calling Gemini', async () => {
    const client = fakeClient({ vehicles: { data: null, error: null } });

    const result = await recomputePerformanceStats({
      vehicleId: 'nope',
      client,
      isDemo: false,
    });

    expect(generateContent).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, status: 404, error: 'Vehicle not found' });
  });
});

describe('computeModHash', () => {
  it('is order-independent, so reordering rows is not a change', () => {
    expect(computeModHash(['b', 'a'])).toBe(computeModHash(['a', 'b']));
  });

  it('changes when an item is added', () => {
    expect(computeModHash(['a'])).not.toBe(computeModHash(['a', 'b']));
  });
});

describe('extractJSON', () => {
  it('reads a fenced code block', () => {
    expect(extractJSON('```json\n{"hp":300}\n```')).toEqual({ hp: 300 });
  });

  it('reads a bare object with prose around it', () => {
    expect(extractJSON('Here you go: {"hp":300} — hope that helps')).toEqual({ hp: 300 });
  });

  it('throws when there is no JSON at all', () => {
    expect(() => extractJSON('I am afraid I cannot help with that')).toThrow('No valid JSON');
  });
});
