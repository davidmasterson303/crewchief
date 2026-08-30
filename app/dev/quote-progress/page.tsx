'use client';

import { QuoteGenerationProgress } from '@/components/QuoteGenerationProgress';

/*
 * Visual states for the quote panel. Development only.
 *
 * ── ⚠ Why this page exists (the third fake indicator) ───────────────────────
 *
 * The panel it renders used to run two `setInterval`s: one drove a percentage
 * to a hard 100 in 7.5 seconds, the other ticked four hard-coded stages and
 * drew green checks behind them. The client awaits exactly one call, so there
 * were no stages to be on and no percentage to be at — and one of those stages,
 * *"Checking regional labor rates"*, described a lookup this product does not
 * perform at all.
 *
 * It shipped and stayed shipped for the same reason the invoice scanner's
 * modulo bug did: the only way to see this component was to generate a real
 * quote, which spends a Gemini call and takes as long as the fiction lasted.
 * `scan-progress` exists for that panel; this is the same page for this one.
 *
 * ⚠ These are fixtures, and the panel is a pure function of its props — there
 * is no clock left inside it for a fixture to fail to reproduce. That is the
 * property that makes a page like this sufficient rather than indicative.
 *
 * The one thing this page cannot show is how long the wait is. That is the
 * point: neither can the panel, which is why it no longer claims to.
 */

const states: Array<{
  title: string;
  note: string;
  items: Array<{ id: string; description: string; category: string }>;
  zipCode: string;
}> = [
  {
    title: 'One item',
    note:
      'The singular. "Pricing 1 service item", and the heading above the list reads "The item" — ' +
      'a panel that says "1 items" reads as machinery, on a screen whose job is reassurance.',
    items: [{ id: '1', description: 'Front brake pads and rotors', category: 'Brakes' }],
    zipCode: '80202',
  },
  {
    title: 'Several items',
    note:
      'What the old panel replaced with four marching stages. Every line here is a fact the ' +
      'component was handed — these are the items being priced, named, in the order they were sent.',
    items: [
      { id: '1', description: 'Front brake pads and rotors', category: 'Brakes' },
      { id: '2', description: 'Transmission fluid service', category: 'Drivetrain' },
      { id: '3', description: 'Serpentine belt replacement', category: 'Engine' },
      { id: '4', description: 'Cabin and engine air filters', category: 'Maintenance' },
    ],
    zipCode: '80202',
  },
  {
    title: 'A long description, and one with no category',
    note:
      'Descriptions are free text an owner typed, so they wrap rather than truncate — this is a ' +
      'list of what is being paid for, and a clipped line item is the one you cannot check. The ' +
      'category line is omitted entirely when it is empty rather than rendering a blank row.',
    items: [
      {
        id: '1',
        description:
          'Replace the charge pipe and boost sensor, and check the diverter valve while the ' +
          'intake is off — the shop said it was weeping at the last visit',
        category: 'Forced induction',
      },
      { id: '2', description: 'Oil change', category: '' },
    ],
    zipCode: '10001',
  },
];

export default function QuoteProgressStatesPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-10">
      <div className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Quote panel — states</h1>
          <p className="text-sm text-white/60">
            Development only. Every state below is what the component renders from its props;
            there is no timer inside it.
          </p>
        </header>

        {states.map((state) => (
          <section key={state.title} className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">{state.title}</h2>
              <p className="text-sm text-white/60 leading-relaxed">{state.note}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-6">
              <QuoteGenerationProgress items={state.items} zipCode={state.zipCode} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
