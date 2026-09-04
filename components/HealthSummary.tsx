'use client';

import { useEffect, useRef, useState } from 'react';
import { adviceDisclosure } from '@wellkept/core/advice-disclosure';
import { healthClaim, mayReassure, type HealthClaim } from '@wellkept/core/health-claims';
import type { HealthDriver, HealthDriverKey } from '@wellkept/core/health-drivers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CircleAlert as AlertCircle,
  TrendingUp,
  RefreshCw,
  TriangleAlert as AlertTriangle,
  CircleCheck as CheckCircle,
  Activity,
  ShieldAlert,
  CircleHelp as HelpCircle,
  ChevronRight,
} from 'lucide-react';
import { generateVehicleHealthSummary } from '@/app/actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { invalidateDashboardCache } from '@wellkept/core/query-invalidation';
import RecallHistoryModal from './RecallHistoryModal';
import { useCountUp } from '@/hooks/use-count-up';
import { useHealthBand, getHealthBand } from '@/hooks/use-health-band';
import { isDemoVehicleId } from '@wellkept/core/demo';

interface HealthSummaryProps {
  vehicleId: string;
  healthSummary: any;
  recalls?: any[];
  /**
   * Whether an NHTSA record exists for this vehicle at all — not whether it
   * listed any recalls. Absent means the check never ran, which must never
   * render as an all-clear. See `@wellkept/core/health-claims`.
   */
  recallsChecked?: boolean;
  /** Whether vehicle research reached `completed`. */
  researchComplete?: boolean;
  /**
   * The three computed drivers — D10.
   *
   * ⚠ Assembled by the caller through `driversForVehicle`, never here. This
   * component holds a model-written summary row and has no access to the
   * schedule, the maintenance rows or the odometer, and a component that
   * fetched its own would be a second answer to what the drivers are.
   *
   * Defaults to `[]`, which renders nothing — the honest result for a caller
   * that has not wired them rather than a fabricated set of blanks.
   */
  drivers?: HealthDriver[];
  compact?: boolean;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 29;
  const circumference = 2 * Math.PI * radius;

  // Ring sweep and the printed number are driven by one value, so they
  // resolve together rather than drifting apart.
  const animated = useCountUp(score, 900);
  const fill = (animated / 100) * circumference;

  // Band is chosen from the *target* score: the colour should not cycle
  // through red → amber → green while the ring draws in.
  const band = useHealthBand(score);

  return (
    <div className="relative flex items-center justify-center w-20 h-20 flex-shrink-0">
      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
        <circle
          cx="40" cy="40" r={radius}
          fill="none"
          stroke={`rgba(${band.rgb},0.12)`}
          strokeWidth="6"
        />
        <circle
          cx="40" cy="40" r={radius}
          fill="none"
          stroke={band.color}
          strokeWidth="6"
          strokeDasharray={`${fill} ${circumference}`}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px rgba(${band.rgb},0.38))` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="num text-xl font-bold text-foreground leading-none">
          {Math.round(animated)}
        </span>
        <span className="text-xs text-white/50 mt-0.5">/100</span>
      </div>
    </div>
  );
}

/**
 * The contributing factors — one block per subject.
 *
 * ── ⚠ Two provenances in one row, and they are not interchangeable ──────────
 *
 * Each row can carry two sentences about the same subject and they come from
 * different places:
 *
 *   - the **measured** line is arithmetic over rows the owner can go and
 *     count, assembled by `driversForVehicle`;
 *   - the **claim** is prose from the model, gated by `healthClaim`.
 *
 * The measured line is first and takes the brighter ink. That ordering was the
 * whole argument of the panel this replaces and it survives intact: nothing
 * makes the score a function of the drivers, so when the two disagree the
 * checkable half should be the half read first. What changed is that they are
 * one list instead of two — the subject appeared twice before, once with a
 * number and once with an icon, and a reader had to notice they were the same
 * topic.
 *
 * ── ⚠ Not terms in a sum, and this must not imply they are ──────────────────
 *
 * `health_score` comes from the model; the scores here are computed from rows.
 * So they explain the *subject* without arithmetically explaining the *total*,
 * and they are laid out as peers: no plus signs, no "= 74", no ordering that
 * suggests one contributes more. `health-drivers.ts` carries the same warning
 * at the source and `HealthDrivers.tsx` on mobile makes the same choices —
 * deliberately its twin rather than a second design, because a driver that
 * reads one way on the phone and another on the web is this codebase's most
 * repeated defect wearing a new hat.
 */
function ClaimIcon({ claim }: { claim: HealthClaim }) {
  /*
    The state's ink attaches to the claim sentence, not to the row. A whole
    tile washed green for one reassuring sentence is what made three of these
    read as a scorecard — and it put a green panel directly above a red one
    about the same car.
  */
  /*
    ⚠ Each className is written out in full rather than composed from a shared
    size string. `text-contrast-floor` classifies a colour token by the size
    token beside it in the source, and a template literal leaves it looking at
    the alpha token on its own — which it reports as unclassifiable, and
    correctly: that value is allowed here at all *because* it is 16px of glyph
    rather than a line of body copy.

    ⚠ The token is deliberately not quoted in this comment. The suite's
    anti-vacuous case counts how many of these tokens vanish when comments are
    stripped, and allows five across the tree — the margin exists to catch a
    stripper that has started eating markup, so spending it on prose about the
    rule is what breaks it.
  */
  if (mayReassure(claim)) {
    return <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-green-400" aria-hidden="true" />;
  }
  if (claim.state === 'unknown') {
    return <HelpCircle className="h-4 w-4 shrink-0 mt-0.5 text-white/45" aria-hidden="true" />;
  }
  return <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-orange-400" aria-hidden="true" />;
}

function HealthFactorRows({
  drivers,
  claims,
  recalls,
  recallsChecked,
}: {
  drivers: HealthDriver[];
  claims: { maintenance: HealthClaim; issues: HealthClaim; recalls: HealthClaim };
  recalls: any[];
  recallsChecked: boolean;
}) {
  const driverFor = (key: HealthDriverKey) => drivers.find((d) => d.key === key);

  /*
    ⚠ The subjects are declared, not derived from whichever list happens to be
    populated. `issues` has no driver and `mileage-load` has no claim, so
    deriving the rows from either source alone would silently drop one of them
    — and "Known issues" vanishing because nobody computes a number for it is
    the kind of absence that reads as "nothing to report".

    A row with neither a score nor a claim is dropped, which is the honest
    result for a caller that wired nothing.
  */
  const rows: {
    key: string;
    label: string;
    driver?: HealthDriver;
    claim?: HealthClaim;
  }[] = [
    { key: 'maintenance', label: 'Maintenance', driver: driverFor('maintenance'), claim: claims.maintenance },
    { key: 'recalls', label: 'Recalls', driver: driverFor('recalls'), claim: claims.recalls },
    { key: 'mileage-load', label: driverFor('mileage-load')?.label ?? 'Mileage load', driver: driverFor('mileage-load') },
    /*
      ⚠ Last, and it is the only row with nothing in the score column.

      It sat second, between two scored rows, and a design critique of the
      rendered page read the empty column as a bug rather than a decision —
      "the omission reads as a bug, not a decision". It is a decision: nothing
      computes a number for known issues, and inventing one would be the
      overclaim this whole card is built to avoid.

      Ordering it after the measured rows is what makes that legible. A gap in
      the middle of a column reads as missing; the column simply ending reads
      as a different kind of row, which is what this is.
    */
    { key: 'issues', label: 'Known issues', claim: claims.issues },
  ].filter((row) => row.driver || row.claim);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/8">
      {rows.map((row) => (
        <div key={row.key} className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-semibold text-white">{row.label}</h4>
            {/*
              ⚠ An unmeasured driver takes muted ink, never a band. Banding a
              `null` asserts a condition nobody checked — the same overclaim
              `ClusterGauge`'s unknown face exists to prevent, one level down.

              A subject with no driver at all prints no number rather than a
              dash: the dash means "we looked and cannot say", and "Known
              issues" is not measured by anything.
            */}
            {row.driver && (
              <span
                className="num text-xl font-bold leading-none"
                style={{
                  /*
                    ── ⚠ One contract: colour is the verdict, and there is
                       only one verdict on this page ─────────────────────────

                    These numerals took their band's colour, and the result was
                    a green **97** with "Nothing overdue among the 6 we can
                    check" sitting directly above "Brake fluid overdue". Three
                    rounds of a design critique called that the worst defect on
                    the screen — "no studio ships a trust product that argues
                    with itself two lines apart".

                    The first fix neutralised only the rows whose claim said
                    attention, and the next round read the result exactly as it
                    looked: "Maintenance 97 is grey, Mileage 91 is green,
                    Recalls 35 is grey. Three scores, two treatments, zero
                    logic." A rule nobody can infer from the screen is not a
                    contract.

                    So the rule is the simple one, and it is true of the
                    product rather than convenient for the layout: **the
                    overall score is the verdict, and it is the only thing that
                    carries the band's colour.** These are measurements that
                    explain it — `health-drivers.ts` is emphatic that they are
                    not terms in a sum — and a measurement painted in verdict
                    ink is a second opinion the system never formed.

                    `null` keeps its muted ink, because that is a different
                    statement: not a quiet measurement, but no measurement.
                  */
                  color:
                    row.driver.score === null
                      ? 'rgb(255 255 255 / 0.38)'
                      : 'rgb(255 255 255 / 0.92)',
                }}
              >
                {row.driver.score === null ? '—' : row.driver.score}
              </span>
            )}

            {/*
              ⚠ The unscored row says so, rather than leaving the column empty.

              "Known issues" is the one subject nothing computes a number for,
              and a blank where its siblings carry figures read as a fault — a
              critique of the rendered page said the omission "looks broken
              next to its scored siblings rather than deliberately unscored".

              Deliberately not an em dash: this codebase spends that on "we
              looked and cannot say", which is a different statement and is
              what the recalls row shows when its lookup never ran. Nothing
              ever looked here, because nothing measures it.

              ⚠ `label-uppercase` rather than a hand-rolled small caps: this
              was 11px at white/40 and both floors caught it — `viewport-floors`
              on the size, `text-contrast-floor` on the alpha. The house class
              clears both, and it makes this label and the stat labels above
              the hero the same thing.
            */}
            {!row.driver && <span className="label-uppercase">Not scored</span>}
          </div>

          {/*
            Always present when there is a driver, including at `null`. A dash
            on its own reads as a bug; "Recalls have not been checked for this
            vehicle" reads as an honest gap, and the difference between the two
            is what the sentence is carrying.
          */}
          {row.driver && (
            <p className="text-sm text-white/65 leading-relaxed mt-1">{row.driver.detail}</p>
          )}

          {row.claim && (
            <p className="text-sm text-white/50 leading-relaxed mt-1.5 flex items-start gap-2">
              <ClaimIcon claim={row.claim} />
              <span>{row.claim.text}</span>
            </p>
          )}

          {row.key === 'recalls' && (
            <RecallHistoryModal
              recalls={recalls}
              /*
                The same evidence the sentence above is rendered from. Passing
                the array alone left the modal unable to tell "checked, none
                found" from "never checked" — so the honest row opened a dialog
                saying "This vehicle has a clean safety record".
              */
              checked={recallsChecked}
              trigger={
                /*
                  ⚠ Not `{/* … *\/}` here — this is a prop expression, not JSX
                  children, and a braced comment in this position is a syntax
                  error. It compiled to nothing but a "Failed to compile"
                  overlay, and the type check is what says so: `npm test` stayed
                  green because every suite that touches this file reads it as
                  text rather than compiling it.

                  ⚠ Same grammar as the hero's "What's driving this score":
                  bold info-coloured text with one trailing glyph, no chrome.
                  A design critique counted three treatments for one class of
                  action on this page — a pill button, a chevron link and a
                  bold arrow link — and it was right that only the pill earns
                  its own: "Mark addressed" changes a record, these two move
                  you to something.
                */
                <button
                  type="button"
                  className="tap-target-44 group mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-400 transition-colors hover:text-cyan-300"
                >
                  <span>View recall history</span>
                  <ChevronRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function HealthSummary({
  vehicleId,
  healthSummary,
  recalls = [],
  recallsChecked = false,
  researchComplete = false,
  drivers = [],
  compact = false,
}: HealthSummaryProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** One auto-generation per mounted instance. See the effect below. */
  const autoRunAttempted = useRef(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const result = await generateVehicleHealthSummary(vehicleId, true);
    if (result.success) {
      toast.success('Health summary updated');
      invalidateDashboardCache(vehicleId);
      router.refresh();
    } else {
      toast.error('Failed to update health summary');
    }
    setIsRefreshing(false);
  };

  /*
    The first report runs itself.

    Asking someone to press "Generate Health Report" before the dashboard says
    anything about their car makes the product's headline feature look like a
    chore — and there is nothing for the user to decide, so there was nothing for
    the button to ask.

    **This does not add LLM traffic beyond the first run.** The persistence David
    asked for already exists: `generateVehicleHealthSummary` reads
    `vehicle_health_summary` first and returns the stored row untouched when
    `last_generated` is under 24 hours old (app/actions.ts). This calls it with
    `forceRefresh: false`, so it takes that cache; the button keeps `true`,
    because pressing Refresh deliberately means "I want a new one".

    Guards, each load-bearing:
      - `attempted` — a ref, so a re-render cannot fire a second generation, and
        a failure does not retry in a loop.
      - demo vehicles are skipped. They are read-only and already seeded, and an
        anonymous visitor must never be able to trigger a Gemini call by loading
        a page.
  */
  useEffect(() => {
    if (healthSummary || autoRunAttempted.current) return;
    if (isDemoVehicleId(vehicleId)) return;

    autoRunAttempted.current = true;
    setIsRefreshing(true);

    generateVehicleHealthSummary(vehicleId, false)
      .then((result) => {
        if (result.success) {
          invalidateDashboardCache(vehicleId);
          router.refresh();
        }
        // Silent on failure: the button below is still there, and a toast on
        // page load for something the user did not ask for is noise.
      })
      .finally(() => setIsRefreshing(false));
  }, [healthSummary, vehicleId, router]);

  if (!healthSummary) {
    return (
      <Card className="bg-slate-900/60 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-info" />
            Vehicle Health
          </CardTitle>
          <p className="text-sm text-white/50 mt-1">
            {isRefreshing ? 'Analyzing your vehicle...' : 'Get started by uploading service invoices'}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isRefreshing ? (
            <div className="flex items-center justify-center py-10">
              <RefreshCw className="h-7 w-7 text-info animate-spin" />
            </div>
          ) : (
            <>
              <p className="text-sm text-white/55 leading-relaxed">
                Upload photos of your service invoices to analyze your vehicle&apos;s maintenance history and provide personalized insights.
              </p>
              <Button
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground glow-cyan-sm"
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Generate Health Report
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // Reads the shared band table, so the label, the ring and DiagnosticHero's
  // hero score can never disagree about which band a score falls in.
  const getScoreLabel = (score: number) => {
    const band = getHealthBand(score);
    return { label: band.label, color: band.textClass };
  };

  const scoreInfo = getScoreLabel(healthSummary.health_score);

  /*
   * `compact` has no call sites — grep for `<HealthSummary` and the dashboard
   * is the only one, without the prop. It is the sole remaining reason
   * ScoreRing and scoreInfo exist in this file.
   *
   * Left in place rather than deleted, but worth knowing that it still renders
   * a ScoreRing: if anyone puts a compact HealthSummary on the dashboard, D5's
   * duplicate score comes back silently. Delete this branch or drop its ring
   * before reaching for it.
   */
  if (compact) {
    return (
      <Card className={`border ${
        healthSummary.health_score >= 80 ? 'bg-green-500/8 border-green-400/20'
        : healthSummary.health_score >= 60 ? 'bg-info-wash border-info-border'
        : 'bg-orange-500/8 border-orange-400/20'
      }`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-4 mb-3">
            <ScoreRing score={healthSummary.health_score} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-1">Health Score</p>
              <p className={`text-base font-bold ${scoreInfo.color}`}>{scoreInfo.label}</p>
              <p className="text-xs text-white/55 line-clamp-2 mt-1 leading-relaxed">{healthSummary.summary}</p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-white/50 hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              aria-label="Refresh health summary"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {healthSummary.red_flags && healthSummary.red_flags.length > 0 && (
            <div className="pt-3 border-t border-white/8 space-y-1.5">
              {healthSummary.red_flags.slice(0, 2).map((flag: string) => (
                <div key={flag} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/65 leading-snug">{flag}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  /*
    ⚠ These were booleans — empty or not — and that collapsed "we looked and
    found nothing" into the same cell as "we never looked". Only one of those
    is reassuring, and on 21 Aug the second rendered a green tick and "No
    active recalls" on a car inside the Takata campaigns.

    The evidence that a lookup ran is passed in from the dashboard, because an
    empty string cannot carry it.
  */
  const maintenanceClaim = healthClaim('maintenance', healthSummary.maintenance_status, researchComplete);
  const issuesClaim = healthClaim('issues', healthSummary.issues_overview, researchComplete);
  const recallClaim = healthClaim('recall', healthSummary.recall_status, recallsChecked);

  return (
    /*
      ── ⚠ No border and no fill, because the section around it has both ──────

      This was `bg-slate-900/60 border-white/10`, and its only caller renders
      it inside a `CollapsibleSection` that already draws a 16px radius, a
      hairline border and a `bg-card/40` fill. Two panels, 20px apart, in the
      same value range — and the driver rows and the flag chips inside draw
      two more. See `contentSurface` in `DashboardLayout` for the count and
      where the outermost one went.

      `Card` stays as the element rather than being swapped for a `div`: it is
      what pairs with `CardHeader` / `CardContent`, and those carry the padding
      rhythm this content is set on.
    */
    <Card className="border-0 bg-transparent">
      {/*
        D5 — this card used to print the score a second time.
        `DiagnosticHero` sits directly above it on the dashboard and renders the
        same number, so a reader met "74 / Fair" twice within one screen and had
        to work out that they were the same fact rather than two measurements.

        The hero keeps the score. This card answers the question the hero
        raises — *why* that number — so its ScoreRing and its band label are
        gone, not restyled. The narrative stays as the lead-in, because it is
        the one thing here that reads as an answer rather than a reading.
      */}
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-5">
            <div>
              {/*
                ── ⚠ No title here. The section around it is the title ───────

                This card sits inside a `CollapsibleSection` whose header is
                the heading for exactly this content, so the screen carried
                "Health report" and "What's driving the score" as two headings
                for one thing — and the hero's link to it said "What's driving
                this score" as well, which a critique of the rendered page
                counted as the same phrase appearing twice in one scroll.

                The section takes the words; this card takes the content. The
                refresh control stays, because it does something.
              */}
              {/*
                ── ⚠ D5, second half · the narrative was printed twice ───────

                D5 removed this card's *score* because `DiagnosticHero` sits
                directly above it and rendered the same number. It kept the
                summary paragraph on the argument that the narrative is "the
                lead-in… the one thing here that reads as an answer rather
                than a reading" — and the hero was rendering that same string
                as its `reason`, about 130px higher on a desktop viewport. The
                screen carried one paragraph twice, verbatim, within a single
                scroll position, and a design critique of the rendered page
                named it before anything else.

                It resolves here rather than in the hero, and the deciding
                argument is the disclosure below, not composition: this is the
                sentence a model wrote, and `advice-disclosure.ts` is explicit
                that *"a surface that shows generated advice shows this"*. Kept
                in the hero, the prose would have been 500px from its
                disclosure on a phone — the shape of LEG-05 exactly, arrived at
                by tidying.

                The hero shows the reading, what it was read from, and a way in
                here. Every generated sentence on this page is now inside this
                card, under one disclosure.
              */}
              {healthSummary.summary && (
                <p className="text-sm text-white/60 mt-1.5 max-w-xl leading-relaxed">{healthSummary.summary}</p>
              )}
              {/*
                ── ⚠ UX-16 / LEG-05 · this reads as an assessment ────────────

                Confident prose beside a number on a dial, and nothing on the
                screen said a model wrote it. The safety disclaimer lived only
                on a Terms page nobody opens.

                Under the summary rather than under the score: it qualifies the
                sentence, and the score's own honesty problem is a different one
                (FN-01 — every generated score was a hardcoded 70).
              */}
              <p className="text-xs text-white/50 mt-2 max-w-xl">{adviceDisclosure('health')}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-white/50 hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors"
            aria-label="Refresh health summary"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/*
          The contributing factors, absorbed from what used to be a separate
          "Red Flags" card lower down. They are the reason the score is not
          higher, so they belong at the top of the answer rather than below two
          screens of context tiles.

          ── The point delta the ticket asks for is deliberately absent ──────

          D5 specifies "one row per contributing factor with its point delta".
          There is no delta to show. `vehicle_health_summary` holds a single
          `health_score` int plus prose — `summary`, `maintenance_status`,
          `issues_overview`, `recall_status` — and two string arrays,
          `red_flags` and `recommendations`. Nothing anywhere attributes points
          to a factor.

          Printing "-8" beside a red flag would be inventing a number about
          someone's car and presenting it as computed, which is the same defect
          as the consultant's old provenance badges: a confident claim the
          system never made. Deltas need a scoring breakdown emitted by
          whatever produces the score. That is real work, server-side, and it
          is not this ticket.

          So each factor gets a severity icon and its text, and the rows carry
          no magnitude they cannot justify.
        */}
        {/*
          ── ⚠ Three filled capsules were louder and said less ────────────────

          Each flag was a fully-rounded chip on a red wash with a red border —
          the default alert treatment, stacked three deep, and a design critique
          of the rendered page named it as such: heavy, repetitive, and tonally
          wrong for a product whose voice is a service record rather than a
          notification tray. On desktop each one stretched 1100px around a
          single line of text.

          The severity has not been softened; it has been moved off the
          furniture and onto the ink. One panel, hairline-divided rows, the
          critical red on the glyph and a red rule down the edge that says
          "these belong together" once instead of three times.
        */}
        {healthSummary.red_flags && healthSummary.red_flags.length > 0 && (
          <div
            /*
              ⚠ The red is on the left edge only. Ringing the panel in it put a
              red arc around all four corners, which is the filled-capsule
              loudness returning as an outline — the severity belongs to the
              rows, and one rule down the side is enough to say they belong
              together.
            */
            className="rounded-xl border border-white/10 border-l-2 bg-white/[0.02] divide-y divide-white/8"
            style={{ borderLeftColor: 'var(--critical-red)' }}
          >
            {healthSummary.red_flags.map((flag: string) => (
              <div
                key={flag}
                className="flex items-start gap-2.5 px-4 py-3"
              >
                <AlertTriangle
                  className="h-4 w-4 shrink-0 mt-0.5"
                  style={{ color: 'var(--critical-red)' }}
                  aria-hidden="true"
                />
                <p className="text-sm text-white/80 leading-snug">{flag}</p>
              </div>
            ))}
          </div>
        )}

        {/*
          ── ⚠ One block per subject, because there were two ────────────────

          This was a driver panel *and* a three-tile grid, and they overlapped:
          "Maintenance 97" in green, then 300px lower a second panel also
          titled "Maintenance" with an orange alert icon reading "Brake fluid
          overdue". Same word, twice, in two colours, disagreeing — and
          "Recalls" appeared twice the same way.

          The old comment here defended the order (computed above generated,
          "the checkable half should be the half read first") and that argument
          is kept and strengthened rather than dropped: inside each row the
          measured sentence still comes first and the model's claim follows it.
          What the ordering could not fix was that they were two *lists*, so
          the same subject was two entries and the reader had to work out that
          "Maintenance 97" and "Maintenance ⚠" were one topic.

          ⚠ And they can genuinely disagree — nothing makes the score a
          function of the drivers, and on the seeded M3 they do: the measured
          line says nothing is overdue among the six items it can check while
          the model says the brake fluid is. Putting them in one row does not
          resolve that, and is not meant to. It makes it visible, in the one
          place a reader can see both at once, instead of leaving it 300px
          apart where each half reads as the whole truth.
        */}
        <HealthFactorRows
          drivers={drivers}
          claims={{ maintenance: maintenanceClaim, issues: issuesClaim, recalls: recallClaim }}
          recalls={recalls}
          recallsChecked={recallsChecked}
        />

        {/* The "Red Flags" card that stood here is gone — its rows are now the
            contributing factors at the top of this card. Two places listing the
            same flags was the same duplication problem as the score itself. */}

        {healthSummary.recommendations && healthSummary.recommendations.length > 0 && (
          <div className="bg-info-wash border border-info-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-5 w-5 text-info" />
              <h4 className="font-semibold text-white text-sm">Recommendations</h4>
            </div>
            <ul className="space-y-2">
              {/*
                ⚠ These were `>` chevrons. A chevron means "there is more this
                way" — it is the affordance on the recall row a few lines up,
                which actually opens something — and using it as a bullet spends
                a directional glyph on a list that goes nowhere. A dot is a
                bullet.
              */}
              {healthSummary.recommendations.map((rec: string) => (
                <li key={rec} className="text-sm text-white/75 flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-info"
                  />
                  <span className="leading-relaxed">{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-white/50 text-right">
          Last updated:{' '}
          {healthSummary.last_generated
            ? new Date(healthSummary.last_generated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Never'}
        </p>
      </CardContent>
    </Card>
  );
}
