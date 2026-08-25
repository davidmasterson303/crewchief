'use client';

import { useRef } from 'react';
import { VehicleIdentity } from '@/components/VehicleIdentity';
import { ClusterGauge } from '@/components/ClusterGauge';
import { describeReadWork, readWorkCount, type ReadWork } from '@crewchief/core/work-narration';
import { useCountUp } from '@/hooks/use-count-up';

interface DiagnosticHeroProps {
  /** A renderable photo URL, already signed by the caller. Null is expected. */
  photo?: string | null;
  vehicleName: string;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  /**
   * The reading, or `null` when there is not enough history to make one.
   *
   * ⚠ `null` and `undefined` are different here and both are real. `undefined`
   * is "this caller does not show a score at all"; `null` is "this car has no
   * score", which is a statement about the car and gets the unknown face.
   */
  healthScore?: number | null;
  /** One line on why the score is what it is. Optional. */
  reason?: string | null;
  /**
   * What the assessment was actually built from — D13.
   *
   * Omitted by callers that genuinely cannot say, which renders no caption
   * rather than a made-up one.
   */
  work?: ReadWork;
  /** What to do about a missing score. Rendered only when there is no reading. */
  onAddRecord?: () => void;
  /**
   * What the action's button says.
   *
   * ⚠ A prop rather than a constant because the two clients reach different
   * screens, and the label has to name the one it actually opens. The web
   * dashboard sends people to the Maintenance page, whose own button reads
   * "Upload Invoice"; a button here promising "Add a service record" would be
   * describing a form that page does not have.
   */
  addRecordLabel?: string;
  /** Band height. 400px is the design default. */
  height?: number;
}

/**
 * The vehicle dashboard hero — CC-142 §3.
 *
 * ── What this replaces, and why it was worth replacing ──────────────────────
 *
 * The previous hero composited the photograph through six layers: a 42% warm
 * brown `.ph-tint`, `saturate(.62)`, a vignette, a double scrim from both
 * edges, and a duplicate 0×0 `<img>` — over a page background that was *the
 * same photograph again* at 18%. Measured passthrough at the bottom of the
 * hero was ~1.7%. Only about 75px of a 338px element was unobstructed, and
 * roughly a tenth of each 700 KB photograph did any visual work.
 *
 * The photographs were never the problem. The compositing was.
 *
 * ── Nothing is printed over the photograph any more ─────────────────────────
 *
 * The score and the vehicle's name used to sit *on* the image, which is what
 * made the scrims necessary in the first place — text over an unpredictable
 * photograph needs something to sit on. Moving the content beneath the band
 * removes the requirement rather than tuning it, and the band gets to be a
 * photograph instead of a textured backdrop.
 *
 * ── The crop anchor is gone with the crop ───────────────────────────────────
 *
 * `focalX` / `focalY` are no longer props. `VehicleIdentity` contains the
 * photo over a blurred copy of itself rather than cropping it, so there is no
 * crop to anchor. The columns still exist and are still edited in
 * VehiclePhotoUploadDialog; nothing on this screen reads them.
 */
export default function DiagnosticHero({
  photo,
  vehicleName,
  year,
  make,
  model,
  trim,
  healthScore,
  reason,
  work,
  onAddRecord,
  addRecordLabel = 'Add a service record',
  height = 400,
}: DiagnosticHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  /*
    The band table and the count-up both moved into ClusterGauge, which owns
    the reading now. Keeping a second copy of either here is how the numeral
    and the dial would come to disagree about one score — the exact drift the
    old comment on this line was written to prevent, so the rule is unchanged
    and only its address has moved.
  */

  /*
    ── ⚠ D13 · the 900ms timer that used to live here is gone ────────────────

    It set `scanDone`, which drove three things: a cyan scan line across the
    photograph, the caption's flip from "Scanning…" to "Diagnostics complete",
    and `ClusterGauge`'s `active` prop. None of them was waiting on work —
    the score, the recalls and the records all arrive with the page — so the
    animation measured nothing but itself and the caption asserted a diagnostic
    that had not happened. `work-narration.ts` carries the full argument.

    ── ⚠ The beat stays, and counts something true ───────────────────────────

    `CODE_HANDOFF_2026-08-24.md` §1.4 is explicit, and it corrects an earlier
    reading of this decision that removed the count entirely: *"not to remove
    the beat but to make it narrate something real — count up the records
    actually read… Same reassurance, no fiction."*

    That is the better call. The moment of assembly was never the dishonest
    part — an instant answer does feel unearned, and deleting the moment throws
    away real reassurance to fix a problem the moment did not cause. What was
    wrong was the *subject*: a timer counting itself.

    So the sweep runs over `readWorkCount` — the real number of records on file.
    A car with twelve invoices counts to twelve because there are twelve, and a
    car with none has nothing to count and shows no caption at all.

    ⚠ The sentence's shape comes from `work`, not from `counted`. Only the
    numeral is substituted, so the caption never passes through the "no records"
    phrasing on its way up. `work-narration.ts` carries why that matters.
  */
  const counted = useCountUp(work ? readWorkCount(work) : 0, 700);

  /**
   * ⚠ `null`, not `0`. `??` here would resurrect the exact defect: `0` is a
   * legitimate score and `ClusterGauge` will happily paint it red.
   */
  const score = healthScore ?? null;
  const unknownScore = score === null;

  /*
    ── ⚠ What this line says is now checkable ────────────────────────────────

    It read `!photo ? 'No photo yet' : scanDone ? 'Diagnostics complete' :
    'Scanning…'` — a caption whose only inputs were a photograph and a timer,
    announcing a completed diagnostic over a car with no records, no recall
    lookup and no assessment.

    It names the records the assessment was built from instead. Every figure in
    it is a row somebody can go and count in the service log, which is the
    standard `health-drivers.ts` holds its own inputs to.

    The photo state survives as a fallback because it is still true and still
    the most useful thing to say when there is nothing else — but it is the last
    resort now rather than the first branch, since what the app read matters
    more than whether there is a picture of the car.
  */
  const caption = work ? describeReadWork(work, counted) : !photo ? 'No photo yet' : null;

  return (
    <section
      ref={containerRef}
      aria-label={vehicleName}
      className="rounded-2xl overflow-hidden border border-white/8"
    >
      <div className="relative">
        <VehicleIdentity
          variant="band"
          photo={photo ?? null}
          year={year}
          make={make}
          model={model}
          trim={trim}
          height={height}
        />

        {/*
          ── ⚠ D13 · the cyan scan sweep that crossed this photograph is gone ──

          It was defended, correctly, as *motion rather than a layer* — it cost
          the photo nothing permanently and so did not breach "no tint, vignette
          or scrim over any in-app photograph". That defence is still sound and
          is no longer the question.

          What it did was depict a scan. A luminous line travelling down a
          photograph of the owner's car, resolving into "Diagnostics complete",
          is a picture of the app examining the vehicle — and the app had not
          examined anything; it had waited 900ms. The honesty problem was never
          the ink budget, it was the depiction, so tuning the opacity could not
          have fixed it and removing the element is the whole fix.
        */}
      </div>

      {/*
        Beneath the band: the score, and the reason for it. The vehicle's name
        lives here now rather than on the photograph.
      */}
      <div className="bg-[#0f1318]/90 px-4 sm:px-6 sm:px-8 py-6">
        {/*
          The vehicle is not named again here.

          It was, in a serif h2 directly under the band — and on a car with no
          photograph that printed the model twice within about 150px, because the
          plate above carries "M235i / 2015 BMW · xDrive" precisely when there is
          no photo to carry instead. A third copy sits in the page heading a
          couple of hundred pixels higher. Three renderings of one fact on one
          screen.

          VehicleIdentity's docblock already draws this line: "when a photo
          renders, the type and the glyph do not… Callers put a vehicle's name in
          the layout around the band, not on top of it." The page heading is that
          layout. This band's job is the photograph, the status and the score.

          `vehicleName` is kept as the section's accessible name, so a screen
          reader still hears which vehicle the hero belongs to — the information
          was never the problem, the third copy of it was.
        */}
        {/*
          ⚠ Rendered only when there is something to say — handoff §1.4, *"show
          nothing rather than a timer"*. `describeReadWork` returns `null` when
          neither read resolved, and the element goes with it rather than
          holding an empty slot open. A caption that fills its slot to avoid
          looking unfinished is the same reflex that produced the timer.
        */}
        {caption && <p className="label-uppercase mb-6">{caption}</p>}

        {/*
          One instrument, where there used to be a numeral and a separate
          linear track beside it.

          The track's own comment made the argument this inherits: a bare fill
          says "more is better" and nothing else, while 40 / 60 / 80 are the
          only points on the scale where the label actually changes. That was
          right, and the ticks survive — they have moved onto the arc, where
          the reading and the scale are finally the same object rather than two
          renderings of one number sitting side by side.

          Deliberately *not* an additional dial next to the score. D5 removed
          HealthSummary's ring from this page precisely because the dashboard
          was printing the same figure twice within a screen; adding a gauge
          beside the numeral would have reintroduced that with extra ink. The
          numeral lives in the well of the arc, which is where a cluster puts
          it.
        */}
        {healthScore !== undefined && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-9">
            {/*
              `active` was `scanDone` — the dial held its sweep until a timer
              elsewhere on the screen said a fictional scan had finished. There
              is nothing to wait for, so it is live on mount.
            */}
            <ClusterGauge score={score} active />
            <div className="flex-1 max-w-prose">
              {/*
                ── ⚠ D10 · the unknown score gets a sentence and an action ────

                A dashed dial reading "—" tells an owner that something is
                absent without telling them what, or that it is theirs to fix.
                The dial says *there is no reading*; this says *why*, and the
                button says *what closes it*.

                `reason` is not used for this. It is the model's summary of an
                assessment, and when there is no score there was no assessment
                — printing it here would attach prose about the car to a state
                whose entire content is that we have nothing to say about it.
              */}
              {unknownScore ? (
                <>
                  <p className="text-sm text-white/70 leading-relaxed">
                    Not enough history yet. CrewChief works out a score from this car&apos;s
                    service records, and there are not enough on file to say anything useful.
                  </p>
                  {onAddRecord && (
                    <button
                      type="button"
                      onClick={onAddRecord}
                      className="tap-target-44 mt-3 inline-flex items-center rounded-xl border border-info-border bg-info-wash px-4 py-2 text-sm font-semibold text-info-strong transition-colors hover:bg-info-wash/70"
                    >
                      {addRecordLabel}
                    </button>
                  )}
                </>
              ) : (
                reason && (
                  <p className="text-sm text-white/50 leading-relaxed">{reason}</p>
                )
              )}
            </div>
          </div>
        )}

        {healthScore === undefined && reason && (
          <p className="text-sm text-white/50 mt-4">{reason}</p>
        )}
      </div>

    </section>
  );
}
