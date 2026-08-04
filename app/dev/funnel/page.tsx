import { notFound } from 'next/navigation';
import { readFunnel } from '@/lib/funnel';
import { FUNNEL_STEPS } from '@crewchief/core/funnel';

export const dynamic = 'force-dynamic';

/**
 * The front door's funnel, read out loud. Development only.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Advisory P1 made instrumentation a **ship gate**, on the argument that
 * Phase 2.97 is justified by producing evidence and this is the only part of it
 * that produces any. That argument is only true if someone can read the result.
 * Four steps recording into a table nobody opens is the same outcome as no
 * instrumentation, arrived at more expensively.
 *
 * `readFunnel` and `funnelRates` existed and had no caller. This is the caller.
 *
 * ── Development only, and that is not laziness ──────────────────────────────
 *
 * `notFound()` in production, matching `app/dev/rls-check`. The numbers here
 * are business data — how many strangers arrived and how many converted — and
 * there is no admin role in this application to gate them behind. Inventing one
 * for a readout would be a larger security surface than the readout is worth.
 * When this needs to be visible in production it should go behind the same
 * decision that creates a real admin concept, not ahead of it.
 *
 * ── It shows an empty funnel as empty ───────────────────────────────────────
 *
 * `funnelRates` returns zeroes rather than NaN on no data, which is the normal
 * state until the door is promoted. A page reading "0 visitors" is correct and
 * legible; one reading "NaN%" looks broken on the days it is telling the truth.
 */
export default async function FunnelPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const windows = [
    { label: 'Last 24 hours', since: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    { label: 'Last 7 days', since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    { label: 'Last 30 days', since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  ];

  /*
    `readFunnel` throws rather than returning an empty funnel, deliberately —
    a broken query and a genuinely empty window look identical, and "0%
    conversion" from a failed read is worse than an error because someone would
    act on it. Caught here so one bad window does not blank the whole page, and
    rendered as an error rather than as a zero.
  */
  const results = await Promise.all(
    windows.map(async (w) => {
      try {
        return { ...w, rates: await readFunnel(w.since), error: null as string | null };
      } catch (err) {
        return {
          ...w,
          rates: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return (
    <main className="min-h-screen bg-slate-950 text-white/90 px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">Front door funnel</h1>
        <p className="mt-2 text-white/55 text-sm leading-relaxed">
          Phase 2.97d. Visitors who reached each step, and the conversion between them.
          Cumulative — someone who was answered counts at every earlier step, so a dropped
          write cannot make a later step outrank an earlier one.
        </p>

        {results.map((r) => (
          <section key={r.label} className="mt-10">
            <h2 className="text-white/80 font-medium">{r.label}</h2>

            {r.error && (
              <p className="mt-3 text-amber-300/90 text-sm">
                Could not read the funnel: {r.error}
              </p>
            )}

            {r.rates && r.rates.visitors === 0 && (
              <p className="mt-3 text-white/45 text-sm">
                No visitors in this window. Expected until the front door is promoted.
              </p>
            )}

            {r.rates && r.rates.visitors > 0 && (
              <table className="mt-3 w-full text-sm border-collapse">
                <thead>
                  <tr className="text-white/45 text-left">
                    <th scope="col" className="py-2 font-medium">Step</th>
                    <th scope="col" className="py-2 font-medium text-right">Visitors</th>
                    <th scope="col" className="py-2 font-medium text-right">From previous</th>
                  </tr>
                </thead>
                <tbody>
                  {FUNNEL_STEPS.map((step, i) => (
                    <tr key={step} className="border-t border-white/10">
                      <th scope="row" className="py-2 font-normal text-white/80">{step}</th>
                      <td className="py-2 text-right tabular-nums">{r.rates!.counts[step]}</td>
                      <td className="py-2 text-right tabular-nums text-white/60">
                        {i === 0 ? '—' : `${Math.round(r.rates!.stepConversion[step] * 100)}%`}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/20">
                    <th scope="row" className="py-2 font-medium text-cyan-300">
                      landed → saved
                    </th>
                    <td />
                    <td className="py-2 text-right tabular-nums font-semibold text-cyan-300">
                      {Math.round(r.rates.overallConversion * 100)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
