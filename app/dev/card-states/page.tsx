import { notFound } from 'next/navigation';
import { VehicleCard } from '@/components/VehicleCard';

/*
 * Visual states for the garage card. Development only.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The demo garage cannot exercise this component. Demo vehicles carry no
 * `healthSummary` and no recalls, so the score ring and the alert ribbon — the
 * two things v7 is actually about — render on no page a developer can open.
 * That is not a new gap: the v6 notes carried "E4 is unverified on screen"
 * forward for exactly this reason, and the fix offered there was "confirm on a
 * real account", which nobody can do from a local checkout.
 *
 * Every band, both alert tones, the photo-less card and the score-less card are
 * below. If a change to VehicleCard cannot be checked here, add the state.
 *
 * ── Not reachable in production ─────────────────────────────────────────────
 *
 * `notFound()` on a production build, so this never ships a route to the demo
 * domain. It is a harness, not a feature, and it renders fixture text that
 * would read as real content to anyone who found it.
 */
export default function CardStatesPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  /*
   * A deliberately NON-demo id.
   *
   * The first version of this page reused the Accord's demo UUID, and every
   * card rendered the Accord photograph under "2019 BMW M3" text — because
   * VehicleCard hard-overrides demo vehicles from @crewchief/core/demo's DEMO_IMAGES and
   * ignores image_url entirely for them. Useful accident: it is a live
   * demonstration of the two-sources-of-truth problem that A6 exists to delete.
   *
   * A non-demo id also means the delete and mileage paths are not short-circuited
   * by the demo guards, so do not click Delete here — the row does not exist.
   */
  const base = {
    id: 'f1xture0-0000-0000-0000-00000000cafe',
    year: 2019,
    make: 'BMW',
    model: 'M3',
    trim: 'Competition',
    current_mileage: 67400,
    vehicle_status: 'daily_driver',
    focal_point_x: 50,
    focal_point_y: 56,
    image_url: '/vehicles/m3/hero-3x2.jpg',
  };

  const summary =
    'Deferred oil service and a stiffening rear subframe bushing. Neither is urgent this month, both are cheaper now than after winter.';

  /* One per band boundary, plus the values either side of them — the labels and
   * colours are threshold-driven, so 79/80 and 59/60 are the interesting cases,
   * not 85 and 65. */
  const states: { title: string; note: string; props: any }[] = [
    {
      title: 'Good — 88',
      note: 'Ring reads --ring-good, label "Good".',
      props: { vehicle: base, activeRecalls: 0, healthSummary: { health_score: 88, summary } },
    },
    {
      title: 'Fair — 61',
      note: 'The conservatism case: 61 is deliberately not "Good".',
      props: { vehicle: base, activeRecalls: 0, healthSummary: { health_score: 61, summary } },
    },
    {
      title: 'Needs attention — 47',
      note: 'Ring label shows the SHORT form, "Attention". The detail page keeps "Needs attention".',
      props: { vehicle: base, activeRecalls: 0, healthSummary: { health_score: 47, summary } },
    },
    {
      title: 'Critical — 22, with recalls',
      note: 'Critical ribbon from activeRecalls. This is the card that must be findable without reading text.',
      props: { vehicle: base, activeRecalls: 2, healthSummary: { health_score: 22, summary } },
    },
    {
      title: 'Attention-tone ribbon',
      note: 'No critical entry, so the ribbon is amber. Two alerts join on one line.',
      props: {
        vehicle: base,
        activeRecalls: 0,
        healthSummary: { health_score: 74, summary },
        alerts: [
          { label: 'Service overdue', tone: 'attention' },
          { label: 'Inspection due', tone: 'attention' },
        ],
      },
    },
    {
      title: 'Mixed tones → whole ribbon critical',
      note: 'One critical entry among attention ones must make the whole ribbon critical.',
      props: {
        vehicle: base,
        activeRecalls: 0,
        healthSummary: { health_score: 55, summary },
        alerts: [
          { label: 'Service overdue', tone: 'attention' },
          { label: '1 recall', tone: 'critical' },
        ],
      },
    },
    {
      title: 'No photo',
      note: 'No strip at all — not an empty plate. The nickname chip moves into the body, and the options menu must still be reachable.',
      props: {
        vehicle: { ...base, image_url: null, id: 'no-photo-fixture' },
        activeRecalls: 1,
        healthSummary: { health_score: 66, summary },
      },
    },
    {
      title: 'No photo, no score',
      note: 'The thinnest possible card. Must still look finished.',
      props: {
        vehicle: { ...base, image_url: null, id: 'bare-fixture', trim: null },
        activeRecalls: 0,
      },
    },
    {
      title: 'Score, no summary prose',
      note: 'Ring present, summary absent — the prose block must not leave a gap.',
      props: {
        vehicle: base,
        activeRecalls: 0,
        healthSummary: { health_score: 80 },
      },
    },
  ];

  return (
    <main className="min-h-screen bg-background p-8">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">VehicleCard — visual states</h1>
        <p className="mt-2 text-sm text-white/60">
          Development only. The demo garage renders no health summaries and no recalls, so the
          ring and the ribbon cannot be seen there. Check both widths — the grid collapses at
          the same breakpoints as the real garage.
        </p>
      </header>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {/*
          `h-full` on the item and a flex-1 slot for the card mirror the real
          garage grid (app/demo/page.tsx wraps each card in `scroll-reveal
          h-full`). Without it the cards do not stretch, and the CTA-baseline
          alignment that `mt-auto` exists to produce cannot be observed here —
          it read as a regression the first time this page was opened.
        */}
        {states.map((s) => (
          <div key={s.title} className="flex flex-col h-full">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-info">{s.title}</p>
            <p className="mb-3 text-xs text-white/50 leading-relaxed min-h-[3rem]">{s.note}</p>
            <div className="flex-1">
              <VehicleCard {...s.props} />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
