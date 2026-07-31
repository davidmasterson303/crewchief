/**
 * The advisor answers about the car, not about what it was told.
 *
 * @jest-environment node
 *
 * `sendConsultantMessage` took the entire vehicle context as parameters, so a
 * caller could describe a vehicle to the model however it liked. Phase 3.0
 * task 3.0.1 moved that load server-side. These tests cover the loader, and
 * assert statically that the action cannot quietly go back to trusting the
 * request body — the same technique `auth-posture.test.ts` uses to keep the
 * demo consultant path from regressing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConsultantContext } from '../consultant-context';

const VEHICLE_ID = '11111111-1111-4111-8111-111111111111';

interface TableResult {
  data?: unknown;
  error?: { message: string } | null;
}

/** Supabase stand-in: every query shape the loader uses, per table. */
function clientWith(tables: Record<string, TableResult>) {
  return {
    from: (table: string) => ({
      select: () => {
        const result = tables[table] ?? { data: null, error: null };
        const settled = { data: result.data ?? null, error: result.error ?? null };
        const node: Record<string, unknown> = {
          eq: () => node,
          order: () => node,
          maybeSingle: async () => settled,
          then: (resolve: (value: typeof settled) => unknown) => resolve(settled),
        };
        return node;
      },
    }),
  } as never;
}

const VEHICLE = { id: VEHICLE_ID, year: 2015, make: 'BMW', model: 'M235i' };

describe('loadConsultantContext', () => {
  it('loads the vehicle and everything hanging off it', async () => {
    const result = await loadConsultantContext(
      VEHICLE_ID,
      clientWith({
        vehicles: { data: VEHICLE },
        vehicle_knowledge_base: { data: { reliability_score: 8 } },
        service_items: {
          data: [
            { id: 's1', status: 'wishlist', description: 'Coilovers' },
            { id: 's2', status: 'completed', description: 'Oil change' },
          ],
        },
        maintenance_line_items: { data: [{ id: 'm1' }] },
        vehicle_documents: { data: [{ id: 'd1' }] },
        known_issue_tracking: { data: [{ id: 'i1' }] },
        modification_tracking: { data: [{ id: 'mod1' }] },
        wishlist_items: { data: [{ id: 'w1' }] },
        nhtsa_data: { data: { recalls: [{ Component: 'Airbag' }] } },
        vehicle_health_summary: { data: { health_score: 82 } },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.vehicle).toEqual(VEHICLE);
    expect(result.context.knowledge).toEqual({ reliability_score: 8 });
    expect(result.context.maintenanceLineItems).toHaveLength(1);
    expect(result.context.documents).toHaveLength(1);
    expect(result.context.issueTracking).toHaveLength(1);
    expect(result.context.modTracking).toHaveLength(1);
    expect(result.context.modWishlistItems).toHaveLength(1);
    expect(result.context.nhtsaData).toEqual({ recalls: [{ Component: 'Airbag' }] });
    expect(result.context.healthSummary).toEqual({ health_score: 82 });
  });

  it('splits service items into outstanding and completed', async () => {
    // One query, two lists. The web client did this split itself and posted
    // both, which is two chances to disagree about what "completed" means.
    const result = await loadConsultantContext(
      VEHICLE_ID,
      clientWith({
        vehicles: { data: VEHICLE },
        service_items: {
          data: [
            { id: 's1', status: 'wishlist' },
            { id: 's2', status: 'completed' },
            { id: 's3', status: 'completed' },
            { id: 's4', status: 'in_progress' },
          ],
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.wishlistItems.map((i) => i.id)).toEqual(['s1']);
    expect(result.context.completedItems.map((i) => i.id)).toEqual(['s2', 's3']);
  });

  it('refuses when the vehicle is not there', async () => {
    const result = await loadConsultantContext(VEHICLE_ID, clientWith({}));

    expect(result).toEqual({ ok: false, error: 'Vehicle not found' });
  });

  it('gives a missing vehicle the same answer the auth layer gives', async () => {
    // "Not found" and "not yours" must stay indistinguishable — the
    // NOT_FOUND_MESSAGE argument in lib/api-auth. If this string drifts, a
    // caller can tell the two apart by reading the error.
    const apiAuth = readFileSync(join(__dirname, '..', 'api-auth.ts'), 'utf8');
    const result = await loadConsultantContext(VEHICLE_ID, clientWith({}));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(apiAuth).toContain(`'${result.error}'`);
  });

  /*
    The degradation rule, and it is a product decision rather than an
    implementation detail: a car with no recorded mods is the ordinary case, so
    an advisor that refused to answer until every table responded would be
    worse than one answering from less.
  */
  it('still answers when an optional table cannot be read', async () => {
    const result = await loadConsultantContext(
      VEHICLE_ID,
      clientWith({
        vehicles: { data: VEHICLE },
        // What the demo actually hits today: no anon grant, so 42501.
        maintenance_line_items: { error: { message: 'permission denied' } },
        modification_tracking: { error: { message: 'permission denied' } },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.context.vehicle).toEqual(VEHICLE);
    expect(result.context.maintenanceLineItems).toEqual([]);
    expect(result.context.modTracking).toEqual([]);
  });

  it('refuses when the vehicle read itself errors', async () => {
    // The vehicle is the one thing there is no answering without.
    const result = await loadConsultantContext(
      VEHICLE_ID,
      clientWith({ vehicles: { error: { message: 'connection reset' } } })
    );

    expect(result.ok).toBe(false);
  });

  it('returns empty lists, never undefined', async () => {
    // The prompt builder calls .map and .length on these unguarded.
    const result = await loadConsultantContext(
      VEHICLE_ID,
      clientWith({ vehicles: { data: VEHICLE } })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const list of [
      result.context.wishlistItems,
      result.context.completedItems,
      result.context.maintenanceLineItems,
      result.context.documents,
      result.context.issueTracking,
      result.context.modTracking,
      result.context.modWishlistItems,
    ]) {
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(0);
    }
  });
});

/**
 * The regression guard. Static, for the same reason the demo-consultant
 * assertions in auth-posture.test.ts are: the failure is silent. An action
 * that went back to reading `params.vehicle` would answer perfectly well —
 * about whatever it was handed.
 */
describe('sendConsultantMessage derives its context', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'app/actions.ts'), 'utf8');

  function body(): string {
    const start = source.indexOf('export async function sendConsultantMessage');
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf('\nexport async function', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  }

  it('loads context from the vehicle id', () => {
    expect(body()).toMatch(/loadConsultantContext\(\s*vehicleId\s*,\s*access\.client\s*\)/);
  });

  it('destructures context from the loader, not from params', () => {
    const fn = body();

    // The exact shape of the old bug: the context names pulled off `params`.
    expect(fn).toMatch(/}\s*=\s*contextResult\.context;/);
    expect(fn).not.toMatch(/vehicle,[\s\S]{0,400}?}\s*=\s*params;/);
  });

  it('takes only the caller-owned fields from params', () => {
    // messageHistory and attachedDocuments stay client-supplied on purpose —
    // see the notes on the signature. Everything else must not.
    const destructure = /const \{([^}]*)\} = params;/.exec(body());

    expect(destructure).not.toBeNull();
    const names = destructure![1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);

    expect(names.sort()).toEqual(
      ['attachedDocuments', 'message', 'messageHistory', 'sessionId', 'vehicleId'].sort()
    );
  });
});
