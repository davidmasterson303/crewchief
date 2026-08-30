'use client';

import { useState } from 'react';
import {
  ILLUSTRATION_BY_STYLE,
  VEHICLE_BODY_STYLES,
  BODY_STYLE_LABEL,
} from '@/components/vehicle-illustrations';
import { resolveBodyStyle } from '@wellkept/core/vehicle-body-style';

/**
 * Review gallery for the default vehicle illustration set.
 *
 * **This is the review checkpoint, and it is temporary.** The ticket is
 * explicit: build all twelve here, stop for David's shape review, and wire
 * nothing into vehicle cards until the shapes are approved. Expect iteration —
 * "too much like a real model", proportions, stroke weight.
 *
 * Lives under `/dev` alongside `/dev/card-states`, which is the existing
 * convention for pages that exist to be looked at rather than shipped.
 *
 * Each shape renders at three sizes because the constraints pull in opposite
 * directions: large enough to judge the drawing, **48px because that is the
 * mobile garage size and the real legibility test**, and card-width because
 * that is where it actually has to live.
 */

/** A muted paint colour, to exercise the tint path without leaving graphite. */
const SAMPLE_TINT = '#7C4A3A';

export default function VehicleIllustrationGallery() {
  const [tinted, setTinted] = useState(false);
  const [probe, setProbe] = useState('Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)');
  const [doors, setDoors] = useState('4');

  const resolved = resolveBodyStyle(probe, doors);
  const Resolved = ILLUSTRATION_BY_STYLE[resolved];

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <header className="mx-auto mb-10 max-w-5xl">
        <h1 className="display-serif mb-2 text-3xl">Vehicle illustrations — review</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Twelve fully-owned SVG silhouettes, keyed to vPIC body class. Side profile, facing left,
          shared viewBox and ground line. Warm graphite tokens only — no cyan, no health ramp.
          Nothing is wired into vehicle cards yet.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          <strong className="text-foreground">What to look for:</strong> can you name a real
          production car from any of these? If so it needs redrawing. Then: do the twelve read as
          one set, and are they still distinguishable in the 48px column?
        </p>

        <button
          onClick={() => setTinted((t) => !t)}
          className="mt-5 rounded-lg border border-info-border bg-info-wash px-4 py-2 text-sm font-medium text-info"
        >
          {tinted ? 'Showing tinted — click for pure graphite' : 'Showing graphite — click to tint'}
        </button>
      </header>

      {/* The mapping, exercised live: paste any vPIC BodyClass and see what it
          resolves to. Faster than reading the substring order. */}
      <section className="mx-auto mb-12 max-w-5xl rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Mapping probe
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            className="min-w-[22rem] flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
            aria-label="vPIC BodyClass"
          />
          <input
            value={doors}
            onChange={(e) => setDoors(e.target.value)}
            className="w-24 rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
            aria-label="Doors"
            placeholder="doors"
          />
          <code className="rounded bg-secondary px-2 py-1 text-sm text-info">{resolved}</code>
          <Resolved size={120} tint={tinted ? SAMPLE_TINT : null} />
        </div>
      </section>

      {/*
        A grid rather than a list, because the first review question is "do
        these read as one set" and that is only answerable side by side.
      */}
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 md:grid-cols-3">
        {VEHICLE_BODY_STYLES.map((style) => {
          const Illustration = ILLUSTRATION_BY_STYLE[style];
          return (
            <section
              key={style}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4"
            >
              <Illustration size={200} tint={tinted ? SAMPLE_TINT : null} />
              <p className="text-xs font-semibold capitalize">{BODY_STYLE_LABEL[style]}</p>
              <code className="text-xs text-muted-foreground">{style}</code>
            </section>
          );
        })}
      </div>

      {/* The legibility test, all twelve in a row at mobile-garage size. If two
          of these are indistinguishable here, they are indistinguishable. */}
      <section className="mx-auto mt-8 max-w-5xl rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          48px — the mobile garage size, and the real test
        </h2>
        <div className="flex flex-wrap items-end gap-5">
          {VEHICLE_BODY_STYLES.map((style) => {
            const Illustration = ILLUSTRATION_BY_STYLE[style];
            return (
              <div key={style} className="flex flex-col items-center gap-1">
                <Illustration size={48} tint={tinted ? SAMPLE_TINT : null} />
                <span className="text-[9px] text-muted-foreground">{style}</span>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="mx-auto mt-12 max-w-5xl text-xs text-muted-foreground">
        Temporary review page. Delete once the set is approved and wired into the card fallback
        chain.
      </footer>
    </div>
  );
}
