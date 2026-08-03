/**
 * Traffic class — the column that decides which rows a price is derived from.
 *
 * `purpose` says which feature spent the money. `surface` says whose traffic it
 * was, and only `account` belongs in the D2 dataset. Getting this wrong is not
 * a reporting inconvenience: it is a subscription price derived partly from a
 * robot and partly from a demo garage nobody will ever pay for.
 *
 * The measurement that forced this column into existence rather than letting it
 * ride with Phase 2.97, from the first eight live rows:
 *
 *   canary (health check)   5 rows   ~40 visible tokens/call   7.34x thinking
 *   consultant (demo)       3 rows  ~127 visible tokens/call   1.39x thinking
 *   ── blended ──                                              3.45x
 *
 * The blend describes neither path. It was read as evidence that Phase 2.95a
 * had only half landed; it had fully landed, and user traffic was at 1.39x the
 * whole time. **An average across two populations is not a measurement of
 * either**, and separating them at write time is the only fix — by the time the
 * fortnight of data exists, the rows are already written.
 *
 * Every assertion runs against the migration with its prose stripped, for the
 * reason `ai-usage.test.ts` records: a check that reads documentation can be
 * turned green by editing a sentence.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_USAGE_SURFACES } from '@crewchief/core/ai/usage';
import { deriveSurface } from '@/lib/ai-usage';

const ROOT = join(__dirname, '..', '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20260802200000_split_ai_usage_by_traffic_class.sql'),
  'utf8'
);
const SQL = MIGRATION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const DEMO_VEHICLE = 'a1000000-0000-0000-0000-000000000001';
const REAL_VEHICLE = 'b2000000-0000-4000-8000-000000000001';
const USER = 'c3000000-0000-4000-8000-000000000009';

describe('the surface vocabulary matches the CHECK constraint', () => {
  const listed = (() => {
    const block = SQL.match(/CHECK\s*\(\s*surface\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
    if (!block) throw new Error('Could not find the surface CHECK constraint in the migration');
    return (block[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  })();

  it.each(AI_USAGE_SURFACES)('the database accepts %s', (surface) => {
    expect(listed).toContain(surface);
  });

  it('the application knows every surface the database accepts', () => {
    expect([...listed].sort()).toEqual([...AI_USAGE_SURFACES].sort());
  });
});

describe('deriveSurface', () => {
  const base = { purpose: 'consultant' as const, model: 'gemini-3.6-flash' };

  it('a signed-in user is an account', () => {
    expect(deriveSurface({ ...base, userId: USER, vehicleId: REAL_VEHICLE })).toBe('account');
  });

  it('a signed-in user reading the demo garage is STILL an account', () => {
    /*
      The ordering test, and the one worth having. Their calls cost real money
      against a real person who might pay, so they belong in the price dataset
      whatever car they happened to be looking at. Reversing the two checks
      would quietly move real spend into the excluded bucket — a failure that
      makes the product look cheaper to run than it is, which is the direction
      nobody audits.
    */
    expect(deriveSurface({ ...base, userId: USER, vehicleId: DEMO_VEHICLE })).toBe('account');
  });

  it('anonymous traffic on a demo vehicle is demo', () => {
    expect(deriveSurface({ ...base, userId: null, vehicleId: DEMO_VEHICLE })).toBe('demo');
  });

  it('anonymous traffic with no demo vehicle is anonymous — the 2.97 front door', () => {
    expect(deriveSurface({ ...base, userId: null, vehicleId: null })).toBe('anonymous');
  });

  it('an explicit surface always wins, which is how the canary labels itself', () => {
    expect(deriveSurface({ ...base, userId: null, surface: 'canary' })).toBe('canary');
    // And it must not be overridable *into* a wrong answer by accident: an
    // explicit value on a call that would derive differently is still honoured,
    // because the caller knows something the derivation does not.
    expect(deriveSurface({ ...base, userId: USER, surface: 'canary' })).toBe('canary');
  });
});

describe('the migration protects the dataset it is written for', () => {
  it('defaults new rows to account, not to an excluded bucket', () => {
    /*
      The conservative direction. A future call site that has not been taught
      about this column lands in the bucket that counts toward cost. Over-
      counting a price input is visible and recoverable; silently under-counting
      it produces a confident, cheap, wrong number.
    */
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS\s+surface\s+text\s+NOT NULL\s+DEFAULT\s+'account'/i);
  });

  it('backfills the canary out of the price dataset', () => {
    expect(SQL).toMatch(/SET\s+surface\s*=\s*'canary'[\s\S]*?purpose\s*=\s*'health_check'/i);
  });

  it('is a pure addition, so the SQL Editor will not stall on it', () => {
    // David applies migrations through the dashboard. A DROP-class statement
    // raises a confirmation modal mid-run, which has stalled a migration here
    // before.
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('indexes the query D2 will actually run', () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS[\s\S]*?\(surface,\s*created_at DESC\)/i);
  });
});
