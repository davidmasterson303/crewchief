'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, MessageSquare, Wrench, CreditCard as Edit2, Check, X, Info, ChevronLeft, ChevronRight, Tag } from 'lucide-react';
import BrandLockup, { BrandWordmark } from '@/components/brand/BrandLockup';
import { CONTACT_EMAIL } from '@/lib/legal';
import { isDemoVehicleId } from '@wellkept/core/demo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { updateVehicleAvgMileage, updateVehicleMileage, updateVehicleStatus } from '@/app/actions';
import { USAGE_PROFILES, usageProfileChip } from '@wellkept/core/usage-profile';
import { invalidateDashboardCache } from '@wellkept/core/query-invalidation';
import { AccountMenu } from '@/components/AccountMenu';
import { useHomeHref } from '@/hooks/use-home-href';
import { getHealthBand } from '@/hooks/use-health-band';

interface DashboardLayoutProps {
  vehicle: any;
  knowledge?: any;
  currentPage?: string;
  children: React.ReactNode;
  vehicleImage?: string;
  healthSummary?: { health_score?: number } | null;
  /**
   * Whether the layout draws a panel around `children`.
   *
   * ── ⚠ `'bare'` exists because a card inside a card inside a card ──────────
   *
   * The panel's padding, border and radius are what make a page of loose
   * content read as a card on a ground. That is right for the pages whose
   * children *are* loose content — vehicle info, documents, the consultant.
   *
   * The dashboard's children are already sections: `CollapsibleSection` draws
   * its own 16px radius and border, and the cards inside those draw theirs. A
   * design critique of the rendered page counted five concentric rounded
   * rectangles from the viewport edge to a red-flag chip, four of them within
   * 70px on a phone — where they stop reading as depth and start reading as
   * stripes down the page edge. Measured at row 500 of a mobile capture: 17,
   * 24, 27, border, 20. Four surfaces, seven levels of grey between them.
   *
   * So the outermost one goes on that page, and the sections speak for
   * themselves.
   */
  contentSurface?: 'panel' | 'bare';
  /**
   * How the page behaves below `md`. R4.
   *
   * `'page'` — the default and what every screen but one wants: a document
   * that scrolls, with a title, a meta row and a footer.
   *
   * `'app-shell'` — the viewport is the frame. Nothing outside the child
   * scrolls, and the child gets the height left over after the nav. Only the
   * consultant asks for this, and only because a chat has two axes of content
   * that cannot both live in a scrolling document: a thread that scrolls and a
   * composer that must stay put. Stacking those inside a page produced two
   * scroll contexts on the flagship feature, with the composer 210px below the
   * fold on a 375x667 phone — measured, before this existed.
   *
   * A prop rather than a check on `currentPage`, because the next screen that
   * wants this will not be called 'consultant', and a page-name special case
   * is how a layout stops being a layout.
   */
  mobileLayout?: 'page' | 'app-shell';
}

const tabs = [
  { key: 'dashboard', label: 'Dashboard', icon: Wrench, href: (id: string) => `/dashboard/${id}` },
  { key: 'consultant', label: 'Consultant', icon: MessageSquare, href: (id: string) => `/consultant/${id}` },
  { key: 'maintenance', label: 'Maintenance', icon: Clock, href: (id: string) => `/documents/${id}` },
  { key: 'vehicle-info', label: 'Vehicle Info', icon: Info, href: (id: string) => `/vehicle-info/${id}` },
] as const;

export default function DashboardLayout({ vehicle, knowledge, currentPage, children, vehicleImage, healthSummary, contentSurface = 'panel', mobileLayout = 'page' }: DashboardLayoutProps) {
  const appShell = mobileLayout === 'app-shell';
  const router = useRouter();
  const homeHref = useHomeHref();
  const activeBreadcrumb = tabs.find(({ key }) => key === currentPage)?.label ?? '';
  const [isEditingAvgMileage, setIsEditingAvgMileage] = useState(false);
  const [isEditingCurrentMileage, setIsEditingCurrentMileage] = useState(false);
  const [avgMileage, setAvgMileage] = useState(vehicle.avg_miles_per_month?.toString() || '');
  const [currentMileage, setCurrentMileage] = useState(vehicle.current_mileage?.toString() || '');
  const [isSaving, setIsSaving] = useState(false);
  const [displayVehicle, setDisplayVehicle] = useState(vehicle);
  const [scrolled, setScrolled] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const isDemo = isDemoVehicleId(vehicle.id);

  useEffect(() => {
    setDisplayVehicle(vehicle);
    setAvgMileage(vehicle.avg_miles_per_month?.toString() || '');
    setCurrentMileage(vehicle.current_mileage?.toString() || '');
  }, [vehicle]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isStatusOpen) return;
    const close = () => setIsStatusOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [isStatusOpen]);

  /*
    CC-142 §5 — the photographic page background is gone.

    This was the hero's own photograph a second time, stretched over the whole
    page (measured at 1436 x 2809) under an 82% black wash. Two costs, and the
    second is the one that mattered:

      - It is the single largest cause of the uniform brown-grey the app was
        accused of. Every screen was tinted by whatever car was on it.
      - It fetched a full-size photograph to render it at 18% opacity behind
        opaque cards. On the dashboard that was 470 KB of `dark-roomb.jpeg`
        downloaded and never meaningfully painted.

    A flat surface lets the hero's contained photograph be the only photograph
    on the screen, which is the whole point of §3.

    `focal_point_x/y` are no longer read here either — that anchored this
    background's `cover` crop, and there is no crop left to anchor.
  */


  const handleSaveStatus = async (status: string) => {
    if (isDemo) return;
    setIsStatusOpen(false);
    const prev = displayVehicle.vehicle_status;
    setDisplayVehicle((d: any) => ({ ...d, vehicle_status: status }));
    const result = await updateVehicleStatus(vehicle.id, status as any);
    if (result.success) {
      toast.success(`Status updated to ${usageProfileChip(status).label}`);
      invalidateDashboardCache(vehicle.id);
    } else {
      toast.error('Failed to update status');
      setDisplayVehicle((d: any) => ({ ...d, vehicle_status: prev }));
    }
  };

  /**
   * The health-score pill, in one place because it renders in two.
   *
   * R12 gives the phone its own compact breadcrumb, and the pill appears in
   * both that and the full one. Three colour thresholds copy-pasted into two
   * branches is how a green 79 and an amber 79 end up on the same page.
   *
   * ── ⚠ It had its own thresholds, and they disagreed with the dial ─────────
   *
   * The comment above was right about the risk and then missed it by one
   * level: the two branches matched each other, and neither matched
   * `getHealthBand` — the table the gauge, the ring and every band label read
   * from. Its cut was 60/80 against the table's 40/60/80, and its palette was
   * Tailwind's amber against the table's cyan.
   *
   * The visible result on the seeded M3: an amber **61** in the breadcrumb
   * about 400px above a cyan **61 / Fair** on the dial. A design critique of
   * the rendered page read those as two different measurements — which is
   * exactly what two colours for one number claims.
   *
   * So the chip is furniture and the band supplies the ink. No second
   * threshold anywhere.
   */
  const healthPill = (score: number) => {
    const band = getHealthBand(score);
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.06] px-2 py-0.5 text-xs font-semibold ${band.textClass}`}
      >
        <span className="num">{score}</span>
        {/*
          The band's own word, so the chip states the fact rather than posing a
          number the reader has to go and decode. `short` because the
          breadcrumb is 375px wide with a vehicle name already in it, and
          "Needs attention" does not fit — it is an abbreviation of the same
          judgement, never a softer one.
        */}
        <span className="font-medium text-white/50">{band.short}</span>
      </span>
    );
  };

  /*
    ⚠ The reliability verdict chip was here — `Excellent / Good / Fair / Poor`
    over its own four thresholds — and it is deleted rather than left unused.
    Its wording collided with the health band's ("Good" beside "Fair" for one
    car) and a dormant second verdict ramp is precisely what somebody restores
    later on the grounds that the row looks bare. See the stat itself below.
  */

  const handleSaveAvgMileage = async () => {
    const value = parseInt(avgMileage);
    if (isNaN(value) || value < 0) {
      toast.error('Please enter a valid number');
      return;
    }
    setIsSaving(true);
    setDisplayVehicle((prev: any) => ({ ...prev, avg_miles_per_month: value }));
    setIsEditingAvgMileage(false);
    const result = await updateVehicleAvgMileage(vehicle.id, value);
    if (result.success) {
      toast.success('Average mileage updated');
      invalidateDashboardCache(vehicle.id);
    } else {
      toast.error(result.error || 'Failed to update');
      setDisplayVehicle((prev: any) => ({ ...prev, avg_miles_per_month: vehicle.avg_miles_per_month }));
      setAvgMileage(vehicle.avg_miles_per_month?.toString() || '');
    }
    setIsSaving(false);
  };

  const handleSaveCurrentMileage = async () => {
    const value = parseInt(currentMileage);
    if (isNaN(value) || value < displayVehicle.current_mileage) {
      toast.error('Mileage must be greater than or equal to current mileage');
      return;
    }
    setIsSaving(true);
    setDisplayVehicle((prev: any) => ({ ...prev, current_mileage: value }));
    setIsEditingCurrentMileage(false);
    const result = await updateVehicleMileage(vehicle.id, value);
    if (result.success) {
      toast.success('Mileage updated');
      invalidateDashboardCache(vehicle.id);
    } else {
      toast.error(result.error || 'Failed to update');
      setDisplayVehicle((prev: any) => ({ ...prev, current_mileage: vehicle.current_mileage }));
      setCurrentMileage(vehicle.current_mileage?.toString() || '');
    }
    setIsSaving(false);
  };

  const handleCancelEdit = () => {
    setAvgMileage(vehicle.avg_miles_per_month?.toString() || '');
    setIsEditingAvgMileage(false);
  };

  const handleCancelMileageEdit = () => {
    setCurrentMileage(vehicle.current_mileage?.toString() || '');
    setIsEditingCurrentMileage(false);
  };

  /*
    The beltline (1c) — the dashboard's half of the rhyme with the public
    garage's service bay (1a). Same vocabulary, quieter: this is where the work
    happens and the page is dense with real content, so the band sits low and
    dim and the ambient strip runs at a third of the batten's intensity.
    See `.cockpit-belt` in globals.css.

    It replaces a flat `bg-black`, which is why nothing needed re-layering: the
    plate composites under everything as a background, exactly as the bay does
    on the surfaces that already took it.
  */
  return (
    /*
      In app-shell mode the root *is* the viewport below `md`: a fixed-height
      flex column that cannot scroll, so the only thing that scrolls is the
      thread inside the child.

      `100dvh`, not `100vh`. `vh` on mobile Safari measures the viewport with
      the URL bar collapsed, so a `100vh` shell is taller than what you can
      actually see on first paint — which is half of how the composer ended up
      off-screen in the first place. `dvh` tracks the bar.

      From `md` up both branches are the same document they always were.
    */
    <div
      className={
        appShell
          ? 'flex-1 min-h-0 overflow-hidden flex flex-col md:flex-none md:min-h-screen md:block md:overflow-visible cockpit-belt'
          : 'min-h-screen cockpit-belt'
      }
    >
      {/*
        `bay-batten` is the one ambient accent per screen — the same luminous
        hairline the public garage carries on its nav, so the signed-in app and
        the demo read as one product rather than two. See globals.css; on `/`
        it doubles as the service bay's light fixture, which is where the shape
        came from.
      */}
      {/* `shrink-0` so the nav keeps its height when it is a flex child of the
          shell; `sticky` is inert inside a non-scrolling column but stays for
          the `md`+ document, where it is doing real work. */}
      <nav className={`${appShell ? 'shrink-0 ' : ''}sticky top-0 z-40 bay-batten backdrop-blur-xl transition-all duration-200 ${scrolled ? 'bg-black/98 border-b border-white/10 shadow-lg shadow-black/50' : 'bg-black/90 border-b border-white/8'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
          <div className={`flex items-center justify-between transition-all duration-200 ${scrolled ? 'py-3' : 'py-4'}`}>
            <div className="flex items-center gap-3">
              <Link href={homeHref} className="flex items-center group">
                {/*
                  ── 30 Aug · the plate replaces the dial ────────────────────

                  `REBRAND_PROMPT.md` §4.1 sets a nav at *"the 28px plate mark +
                  Newsreader small caps 19–20px"* — a mark and a wordmark rather
                  than one drawing, because a bar is wide and short and the
                  plate's own proportions fight that.
                */}
                <BrandWordmark size={28} />
              </Link>

              {/*
                R12 — the way back, on the viewport where it matters most.

                The full breadcrumb is `hidden sm:flex`, and the comment on it
                records that four separate routes back to the garage were
                deliberately consolidated into this one control. That control
                was then `display: none` below 640px, so what a phone had left
                was a logo that happens to be a link — an affordance you have to
                already know about.

                Compact form, same destination: `‹ Garage · Accord · 61`. Model
                only, because the year and make are the two parts of the name
                that are never in question when you are already looking at the
                car.
              */}
              <button
                onClick={() => router.push(homeHref)}
                className="sm:hidden flex items-center gap-1.5 min-h-[44px] px-1 text-sm text-white/50 hover:text-white transition-colors"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span>Garage</span>
                <span className="text-white/50" aria-hidden="true">·</span>
                <span className="text-white/70 truncate max-w-[7.5rem]">{vehicle.model}</span>
                {/*
                  ⚠ No score chip in the phone breadcrumb.

                  It rendered unconditionally, and the dashboard's reading is
                  now the first thing under the header — so "61 Fair" sat in a
                  pill about 200px above a dial saying 61 Fair, in a 390px bar
                  already holding the monogram, the wordmark and two crumbs. A
                  critique of the rendered page counted it as redundancy and as
                  crowding, and it was both.

                  The desktop crumb keeps its chip because it appears **only
                  once the hero has scrolled away** (`scrolled`), which is the
                  case this chip was actually for: carrying the reading when
                  the instrument is no longer on screen. On a phone the header
                  is the only bar there is and it has no room to spare.
                */}
              </button>

              <div className="hidden sm:flex items-center gap-1 text-white/50 text-sm">
                <ChevronRight className="h-3.5 w-3.5" />
                <button
                  onClick={() => router.push(homeHref)}
                  className="text-white/50 hover:text-white transition-colors min-h-[44px] flex items-center px-1"
                >
                  Garage
                </button>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="text-white/70 px-1">{vehicle.year} {vehicle.make} {vehicle.model}</span>
                {scrolled && healthSummary?.health_score != null && (
                  <span className="ml-1.5">{healthPill(healthSummary.health_score)}</span>
                )}
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="text-white px-1 font-medium">{activeBreadcrumb}</span>
              </div>
            </div>

            {/*
              There was a `< Garage` button here, and it is deliberately gone.

              This layout carried FOUR controls that all went to the garage: the
              mark, this button, the breadcrumb and the footer link. An earlier
              pass fixed where they pointed — every one of them used to push `/`,
              the *demo* garage, so a signed-in user looking at their own car got
              a door out of their data and into three vehicles belonging to
              nobody, which reads as theirs having vanished.

              Fixing the destination left the redundancy. This button sat inches
              from a breadcrumb whose second element is the word "Garage" and goes
              to the same place, so it was a second control competing with a
              perfectly good first one. Removed 30 Jul; the breadcrumb is the
              route back.
            */}
            {/* Hidden in demo mode — an anonymous visitor has no account to
                manage, and a sign-out that does nothing is worse than absent. */}
            {!isDemo && <AccountMenu />}
          </div>

          {/*
            ── One tab strip, and it lives here ────────────────────────────────

            There used to be two: this one, and a full-size copy in the page
            body. This one appeared at `window.scrollY > 60` while the body copy
            sat ~300px down and stayed on screen much longer — so everything
            between those two points showed the navigation **twice**, which is
            the first thing you hit when you scroll.

            The obvious repair is to time the handover: show this one exactly
            when the body one leaves the viewport. That was tried and rejected.
            It needs a runtime measurement, the measurement is wrong on first
            paint (the hero image has no intrinsic height yet, so the body strip
            measures as already-scrolled-past and *both* render at rest), and
            correcting that needs re-measurement on frame, on load, and on
            resize. That is a lot of moving parts standing between a user and a
            row of links.

            Deleting the duplicate removes the whole class of bug instead of
            timing around it. Navigation belongs in persistent chrome: it is now
            always here, always visible, and cannot be on screen twice because
            it only exists once.
          */}
          {/* Full-bleed below `sm`: the strip is a rule across the screen, and
              the 16px page gutter it was sitting inside was 32px the four tabs
              needed. Unchanged from `sm` up. */}
          <div className="-mx-4 sm:mx-0 flex border-t border-white/8 overflow-x-auto edge-fade-x">
              {tabs.map(({ key, label, icon: Icon, href }) => {
                const isActive = currentPage === key;
                return (
                  /*
                    ── `Link` with `prefetch`, and the history is worth keeping ─

                    These were `Link`, then briefly a plain `<a>`, and are `Link`
                    again. The round trip is recorded because the middle step was
                    based on a measurement error and somebody will otherwise
                    repeat it.

                    **8 Aug, reported:** tabs unreachable — clicking did nothing.
                    I "reproduced" it with browser automation and blamed a
                    hydration race in which `Link` calls `preventDefault()` before
                    the router can act, and swapped in a native `<a>`.

                    **That reproduction was an artifact.** The automated clicks
                    were going into a *background* tab —
                    `document.visibilityState === 'hidden'` — where a synthetic
                    click does not drive navigation. Every confusing result
                    followed from that, including clicks that "worked" only right
                    after a `javascript_tool` call.

                    What the native anchor did fix was real, though: tabs began
                    changing. What it cost was worse than the bug. Each switch
                    became a full page load, re-downloading and re-executing 26
                    chunks and re-hydrating — measured at ~2.7s of client boot —
                    when the server itself answers every one of these routes in
                    0.4–0.6s warm. The slowness was never the server.

                    `Link` transfers only the changed route segment and leaves
                    the shell, the nav and the vehicle header mounted. `prefetch`
                    pulls that segment during idle time after the page settles,
                    so the content is local before the click. That is the
                    "lazy-load the tab content" behaviour this needs, and it is
                    the framework's, not something to hand-roll.

                    **If tabs ever appear unreachable again, do not start with
                    this component.** Check the transition itself — a segment
                    fetch that hangs looks exactly like a dead control, because
                    `Link` cancels the browser's own navigation and shows nothing
                    while it waits. `prefetch` is also the mitigation for that:
                    a pre-warmed segment has nothing left to wait for.
                  */
                  <Link
                    key={key}
                    href={href(vehicle.id)}
                    /*
                      Explicit rather than relying on the default. In Next 13's
                      app router the default is a *partial* prefetch on viewport
                      entry; `prefetch` asks for the whole segment, which is what
                      makes the click instant instead of merely quicker.
                    */
                    prefetch
                    /*
                      RB0 rule 3. This was `py-2.5 text-xs` — about 36px tall,
                      under the 44px floor, on the primary navigation: the one
                      control every signed-in session touches. `py-3` plus an
                      explicit `min-h` clears it, and 13px carries the label
                      rather than 12, which is the R10 site this closes at the
                      same time. Visual weight is unchanged.
                    */
                    className={`relative flex items-center gap-1.5 px-2.5 sm:px-4 py-3 min-h-[44px] text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                      isActive ? 'text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                    }`}
                  >
                    {/*
                      ── ⚠ The icons are the reason a whole tab was unreachable ─

                      Four tabs with a glyph and 32px of padding each measured
                      about 490px. On a 390px phone that put "Maintenance" half
                      off the right edge and "Vehicle Info" entirely off it —
                      and while the strip does scroll and `edge-fade-x` softens
                      the cut, a design critique of the rendered page reported
                      the fourth tab as something the mobile layout "gives no
                      hint exists". A scroll affordance is not discovery.

                      The glyphs are decoration here: every tab is a word, and
                      the word is what is read. Dropping them below `sm` and
                      tightening the padding fits all four, so the strip stops
                      overflowing at all. Unchanged from `sm` up, where there
                      was never a problem.
                    */}
                    <Icon className={`hidden sm:block h-3.5 w-3.5 ${isActive ? 'text-cyan-400' : 'text-white/40'}`} />
                    {label}
                    {/*
                      ── ⚠ One active indicator, and the fill is the one that
                         went ─────────────────────────────────────────────────

                      The active tab carried a cyan fill, cyan text *and* this
                      underline: three markings for one state, which a design
                      critique flagged as doubled state-marking. The underline
                      is the one that survives — it is the cheapest in ink, it
                      cannot be mistaken for a hover wash, and it leaves the
                      label to say what it says.

                      The text goes plain white rather than cyan for the same
                      reason the fill went. See the note on links below: cyan is
                      this product's *mark*, and spending it on ordinary state
                      is what made a critique read the page as having two
                      competing accents.
                    */}
                    {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 rounded-t-full" />}
                  </Link>
                );
            })}
          </div>
        </div>
      </nav>

      <div
        className={
          appShell
            ? 'flex-1 min-h-0 flex flex-col w-full max-w-7xl mx-auto md:block md:px-6 lg:px-12 md:pt-10 md:pb-6'
            : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 pt-10 pb-6'
        }
      >
        {/* Title and meta row are page furniture. On a phone running the chat
            as an app they are ~400px of scenery above the thread, and this
            screen's own header already names the vehicle. Hidden below `md`,
            unchanged above it. */}
        <div className={appShell ? 'hidden md:block md:mb-8' : 'mb-8'}>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              {/*
                ── The vehicle's name, set the way this product sets names ───

                It was one line of heavy sans — `2019 BMW M3` at 48px — with
                the trim in grey underneath. Three facts of three different
                kinds in one weight: the model is the name, the year and make
                place it, the trim qualifies it.

                So: mono eyebrow for the placing, serif for the name, and the
                trim joins the eyebrow where it belongs. It is the treatment
                the garage cards and the landing page already use, and this was
                the last screen setting a vehicle's name a different way.

                ⚠ `display-serif` is licensed for "exactly one element per
                screen — a vehicle title or the single largest hero number",
                and this is that element. It became available when the empty
                hero band stopped printing the model in 36px serif directly
                below — which was the duplicate, and was also the screen's one
                serif slot spent on the second copy.

                R11's finding still holds and is why the eyebrow carries the
                year and make: 36px of "2018 Honda Accord" wrapped to three
                lines in 279px before the trim appeared. The name alone does
                not wrap.
              */}
              {/*
                ⚠ The trim is on the name, not in the eyebrow.

                The eyebrow read "2019 BMW · COMPETITION" above "M3", and a
                critique of the rendered page caught the grammar: the trim
                modifies the model, and it was appearing before the word it
                modifies. It is also how people say it — "M3 Competition" is
                the car's name, "2019 BMW" is where to place it.
              */}
              <p className="label-uppercase mb-2">
                {[vehicle.year, vehicle.make].filter(Boolean).join(' ')}
              </p>
              <h1 className="display-serif text-4xl sm:text-5xl lg:text-6xl text-white tracking-tight leading-none">
                {[vehicle.model, vehicle.trim].filter(Boolean).join(' ')}
              </h1>
            </div>

            {/* R11 — `flex flex-wrap gap-8` wrapped these four into a ragged
                2 + 2 with 32px gutters on a phone. A grid makes the two
                columns deliberate rather than a consequence of how wide
                "Reliability" happens to be. Unchanged from `sm` up. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:items-end sm:gap-8">
              <div className="flex flex-col gap-1">
                <span className="label-uppercase">Mileage</span>
                {isEditingCurrentMileage ? (
                  <div className="flex items-center gap-2">
                    <Input fieldSize="sm"
                      type="number"
                      value={currentMileage}
                      onChange={(e) => setCurrentMileage(e.target.value)}
                      className="w-28 text-sm"
                      disabled={isSaving}
                      autoFocus
                    />
                    <Button size="sm" onClick={handleSaveCurrentMileage} disabled={isSaving} className="h-8 px-2 bg-green-600 hover:bg-green-500">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleCancelMileageEdit} disabled={isSaving} className="h-8 px-2 text-white/50 hover:text-white hover:bg-white/8">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsEditingCurrentMileage(true)}
                    className="meta-row flex items-center gap-1.5 group/edit"
                    aria-label="Edit mileage"
                  >
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">{displayVehicle.current_mileage?.toLocaleString() || '—'}</span>
                    <span className="text-sm text-white/50 font-normal">mi</span>
                    <Edit2 className="meta-edit h-3.5 w-3.5 text-white/30 group-hover/edit:text-cyan-400 transition-colors" />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className="label-uppercase">Avg. Monthly Miles</span>
                {isEditingAvgMileage ? (
                  <div className="flex items-center gap-2">
                    <Input fieldSize="sm"
                      type="number"
                      value={avgMileage}
                      onChange={(e) => setAvgMileage(e.target.value)}
                      className="w-24 text-sm"
                      disabled={isSaving}
                      autoFocus
                    />
                    <Button size="sm" onClick={handleSaveAvgMileage} disabled={isSaving} className="h-8 px-2 bg-green-600 hover:bg-green-500">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleCancelEdit} disabled={isSaving} className="h-8 px-2 text-white/50 hover:text-white hover:bg-white/8">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsEditingAvgMileage(true)}
                    className="meta-row flex items-center gap-1.5 group/edit"
                    aria-label="Edit average monthly miles"
                  >
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">{displayVehicle.avg_miles_per_month || '—'}</span>
                    <span className="text-sm text-white/50 font-normal">mi/mo</span>
                    <Edit2 className="meta-edit h-3.5 w-3.5 text-white/30 group-hover/edit:text-cyan-400 transition-colors" />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1 relative">
                <span className="label-uppercase">Status</span>
                <div className="relative">
                  <button
                    onClick={() => !isDemo && setIsStatusOpen(o => !o)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                      isDemo ? 'opacity-60 cursor-not-allowed' : 'hover:border-white/25 hover:bg-white/5'
                    } ${
                      displayVehicle.vehicle_status
                        ? usageProfileChip(displayVehicle.vehicle_status).className
                        : 'bg-white/5 border-white/15 text-white/50'
                    }`}
                  >
                    <Tag className="h-3.5 w-3.5" />
                    {displayVehicle.vehicle_status ? usageProfileChip(displayVehicle.vehicle_status).label : 'Set Status'}
                  </button>
                  {isStatusOpen && (
                    <div className="absolute top-full mt-1.5 right-0 z-50 bg-[#111] border border-white/12 rounded-xl shadow-xl shadow-black/50 py-1.5 min-w-[160px]">
                      {Object.entries(USAGE_PROFILES).map(([key, cfg]) => (
                        <button
                          key={key}
                          onClick={() => handleSaveStatus(key)}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/6 ${
                            displayVehicle.vehicle_status === key ? 'text-cyan-400' : 'text-white/65'
                          }`}
                        >
                          <Tag className={`h-3.5 w-3.5 ${displayVehicle.vehicle_status === key ? 'text-cyan-400' : 'text-white/30'}`} />
                          {cfg.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/*
                ── ⚠ This is not the health score, and it read like it was ───

                Two numbers with verdicts, on one screen, about one car: the
                dial says **61 / Fair** and this said **6/10 · Good**. They are
                different subjects — 61 is *this* car's condition from its own
                records, 6/10 is how the 2019 M3 fares as a model — and nothing
                on the screen said so. A design critique of the rendered page
                read them as the same fact contradicting itself, which is the
                only available reading when a label is one word long.

                Two changes, and the second matters more than the first:

                  - The label names the subject. "Reliability" beside a car's
                    dashboard is naturally read as *this car's*.
                  - The verdict chip is gone. "Good" next to "Fair" is the
                    contradiction in its sharpest form, and the chip was the
                    one element on the row asserting a judgement — the other
                    three state readings and let the reader judge. The figure
                    keeps its `/10`, which is what makes it a scale rather than
                    a score out of a hundred read wrong.
              */}
              {knowledge?.reliability_score && (
                <div className="flex flex-col gap-1">
                  <span className="label-uppercase">Model reliability</span>
                  <span className="text-2xl font-bold text-white tabular-nums tracking-tight">
                    {knowledge.reliability_score}
                    <span className="text-sm text-white/50 ml-0.5">/10</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* The body copy of the tab strip lived here. It is gone — see the
            note on the strip in the sticky header above. */}

        {/* The panel's padding, border and radius are what make it read as a
            card on a page. In app-shell mode there is no page for it to sit
            on, so below `md` it is just the remaining height — and see
            `contentSurface` for the page that brings its own sections. */}
        <div
          className={
            appShell
              ? 'flex-1 min-h-0 flex flex-col md:block md:glass-panel md:rounded-2xl md:p-6'
              : contentSurface === 'bare'
                ? ''
                : 'glass-panel rounded-2xl p-4 sm:p-6'
          }
        >
          {children}
        </div>

        <footer className={`${appShell ? 'hidden md:flex ' : 'flex '}mt-10 pt-6 border-t border-white/6 items-center justify-between text-xs text-white/50`}>
          {/*
            ⚠ The footer takes the plate at its icon size, not the wordmark.

            At 16px the name would sit under the 12px type floor, and Design's
            reduction rule is a different drawing rather than smaller type. The
            copyright line beside it already names the product in words.
          */}
          <span className="flex items-center gap-2">
            <BrandLockup width={18} variant="icon" />
            <span>&copy; {new Date().getFullYear()}</span>
          </span>
          <div className="flex items-center gap-4">
            {/*
              This read `mailto:feedback@crewchief.app` until 30 Aug — a domain
              nobody here owns, so every piece of feedback anyone sent from this
              footer went nowhere, silently, for as long as the link existed.
              It survived the rename because an address is not copy: a
              find-and-replace would have invented `feedback@wellkept.app`,
              which is the same defect with a newer name on it.

              It points at the address the legal pages publish instead — the one
              that is verified receiving and delegated to a real mailbox. One
              address, named in one place, so a second one cannot drift.
            */}
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Well Kept feedback')}`}
              className="hover:text-white/50 transition-colors"
            >
              Feedback
            </a>
            <Link href={homeHref} className="hover:text-white/50 transition-colors">Garage</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
