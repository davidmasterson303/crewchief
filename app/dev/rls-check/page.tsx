'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Cross-account RLS isolation, tested from the browser. Development only.
 *
 * ── Why this page exists rather than a click-through ────────────────────────
 *
 * The obvious test — sign in as a second account and open the first account's
 * `/dashboard/<id>` — proves nothing about RLS. That route goes through
 * `authorizeVehicleAccess`, so the **application layer** refuses it and masks
 * whatever the database would have done. A pass there is consistent with a
 * wide-open database.
 *
 * RLS is the *only* defence on the paths that query Supabase directly from the
 * browser, and the app has one: `components/VehicleCard.tsx` issues
 * `supabase.from('vehicles').delete()` with no server-side authorization in
 * front of it. So a real isolation test has to use the session client directly,
 * exactly as that code does, deliberately bypassing `lib/api-auth.ts`.
 *
 * That is what this page does.
 *
 * ── Why it only reads ───────────────────────────────────────────────────────
 *
 * The most valuable probe would be a DELETE against someone else's vehicle,
 * because that is the exact call VehicleCard makes. **It is not run here.** If
 * RLS were broken — the thing being tested — the probe would succeed, and the
 * test would destroy a real row belonging to a real account. A test whose
 * failure mode is data loss is not a test worth having against production.
 *
 * Write isolation is covered by the policy definitions, verified against
 * production on 28 Jul: `USING (user_id = auth.uid())` on update and delete,
 * with `WITH CHECK` inherited from `USING`. Reads are the half that policy
 * inspection cannot fully settle, because `user_owns_vehicle()` is
 * SECURITY INVOKER and its behaviour depends on the caller's own RLS context.
 *
 * ── How to use it ───────────────────────────────────────────────────────────
 *
 * 1. Signed in as your main account, copy a vehicle id you own.
 * 2. Sign out, sign in as the throwaway account.
 * 3. Open this page, paste the id, run.
 *
 * Every row must say BLOCKED. A single VISIBLE is a real finding.
 */

interface Probe {
  table: string;
  column: string;
  label: string;
}

/*
 * `vehicles` keys on its own id; every child table keys on `vehicle_id` through
 * `user_owns_vehicle(vehicle_id)`. Both shapes are covered so a policy that is
 * right on the parent and missing on a child cannot hide.
 */
const PROBES: Probe[] = [
  { table: 'vehicles', column: 'id', label: 'the vehicle row itself' },
  { table: 'vehicle_documents', column: 'vehicle_id', label: 'uploaded documents' },
  { table: 'service_items', column: 'vehicle_id', label: 'service history' },
  { table: 'maintenance_line_items', column: 'vehicle_id', label: 'maintenance line items' },
  { table: 'vehicle_health_summary', column: 'vehicle_id', label: 'health summary' },
  { table: 'nhtsa_data', column: 'vehicle_id', label: 'recall / NHTSA data' },
  { table: 'wishlist_items', column: 'vehicle_id', label: 'wishlist' },
  { table: 'consultant_conversations', column: 'vehicle_id', label: 'consultant conversations' },
];

type Verdict = 'BLOCKED' | 'VISIBLE' | 'ERROR';

interface Result extends Probe {
  verdict: Verdict;
  rows: number;
  detail?: string;
}

export default function RlsCheckPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const [vehicleId, setVehicleId] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResults(null);

    const { data: auth } = await supabase.auth.getUser();
    setSignedInAs(auth?.user?.email ?? null);

    const out: Result[] = [];
    for (const probe of PROBES) {
      const { data, error } = await supabase
        .from(probe.table)
        .select('*')
        .eq(probe.column, vehicleId.trim());

      if (error) {
        /*
          An error is not a pass. "permission denied for table" is a GRANT
          refusing the whole table, which is a fine outcome but a different
          mechanism from RLS — and a missing table or a typo'd column also lands
          here. Reporting it separately keeps a pass honest.
        */
        out.push({ ...probe, verdict: 'ERROR', rows: 0, detail: error.message });
      } else {
        const rows = data?.length ?? 0;
        out.push({ ...probe, verdict: rows === 0 ? 'BLOCKED' : 'VISIBLE', rows });
      }
    }

    setResults(out);
    setRunning(false);
  };

  const leaked = results?.filter((r) => r.verdict === 'VISIBLE') ?? [];

  return (
    <div className="min-h-screen bg-black text-white p-10 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Cross-account RLS check</h1>
      <p className="text-white/50 mb-8 text-sm leading-relaxed">
        Queries Supabase <strong>directly from the browser</strong>, bypassing{' '}
        <code className="text-cyan-400">lib/api-auth.ts</code> — the same path{' '}
        <code className="text-cyan-400">VehicleCard</code> uses to delete. Sign in as an account that
        does <em>not</em> own the vehicle below. Read-only: no write is attempted.
      </p>

      <label className="block text-sm mb-2 text-white/70">
        A vehicle id belonging to a <em>different</em> account
      </label>
      {/* Deliberately a raw input, not the shared `Input` (v7 C3): this is a dev
          tool, not a product surface, and the one place an unstyled control costs
          nothing. Not an oversight — please leave it. */}
      <input
        value={vehicleId}
        onChange={(e) => setVehicleId(e.target.value)}
        placeholder="db143cdc-e68c-46f0-849e-69f7a1873f58"
        className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-2.5 mb-4 font-mono text-sm"
      />

      <button
        onClick={run}
        disabled={!vehicleId.trim() || running}
        className="bg-primary hover:bg-primary/90 disabled:opacity-40 px-5 py-2.5 rounded-lg font-semibold"
      >
        {running ? 'Running…' : 'Run isolation check'}
      </button>

      {results && (
        <div className="mt-10">
          <div
            className={`rounded-xl border p-5 mb-6 ${
              leaked.length
                ? 'border-red-500/40 bg-red-500/10'
                : 'border-emerald-500/40 bg-emerald-500/10'
            }`}
          >
            <p className="font-bold text-lg">
              {leaked.length ? `❌ ${leaked.length} table(s) leaked data` : '✅ Every table blocked'}
            </p>
            <p className="text-sm text-white/60 mt-1">
              Signed in as <strong>{signedInAs ?? 'nobody — sign in first'}</strong>
            </p>
            {!signedInAs && (
              <p className="text-sm text-amber-300 mt-2">
                Anonymous. This checks the anon role, not cross-account isolation — sign in as the
                throwaway and run it again.
              </p>
            )}
          </div>

          <table className="w-full text-sm">
            <tbody>
              {results.map((r) => (
                <tr key={r.table} className="border-b border-white/10">
                  <td className="py-2.5 font-mono text-xs text-white/70">{r.table}</td>
                  <td className="py-2.5 text-white/50">{r.label}</td>
                  <td className="py-2.5 text-right">
                    {r.verdict === 'BLOCKED' && <span className="text-emerald-400">BLOCKED</span>}
                    {r.verdict === 'VISIBLE' && (
                      <span className="text-red-400 font-bold">VISIBLE ({r.rows})</span>
                    )}
                    {r.verdict === 'ERROR' && (
                      <span className="text-amber-400" title={r.detail}>
                        ERROR
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {results.some((r) => r.verdict === 'ERROR') && (
            <p className="text-xs text-white/50 mt-4">
              ERROR rows are not passes — hover for the message. A table-level GRANT refusal is a
              different mechanism from RLS, and a renamed table lands here too.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
