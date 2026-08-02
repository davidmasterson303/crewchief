'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Car, Clock, MessageSquare, Wrench, CreditCard as Edit2, Check, X, Info, ChevronRight, Tag } from 'lucide-react';
import { isDemoVehicleId } from '@crewchief/core/demo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { updateVehicleAvgMileage, updateVehicleMileage, updateVehicleStatus } from '@/app/actions';
import { USAGE_PROFILES, usageProfileChip } from '@crewchief/core/usage-profile';
import { invalidateDashboardCache } from '@crewchief/core/query-invalidation';
import { AccountMenu } from '@/components/AccountMenu';
import { useHomeHref } from '@/hooks/use-home-href';

interface DashboardLayoutProps {
  vehicle: any;
  knowledge?: any;
  currentPage?: string;
  children: React.ReactNode;
  vehicleImage?: string;
  healthSummary?: { health_score?: number } | null;
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

export default function DashboardLayout({ vehicle, knowledge, currentPage, children, vehicleImage, healthSummary, mobileLayout = 'page' }: DashboardLayoutProps) {
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

  const getReliabilityBadge = (score: number) => {
    if (score >= 8) return { text: 'Excellent', color: 'bg-green-500/20 text-green-300 border-green-400/30' };
    if (score >= 6) return { text: 'Good', color: 'bg-info-wash text-info border-info-border' };
    if (score >= 4) return { text: 'Fair', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30' };
    return { text: 'Poor', color: 'bg-red-500/20 text-red-300 border-red-400/30' };
  };

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
              <Link href={homeHref} className="flex items-center space-x-2.5 group">
                <Car className="h-6 w-6 text-cyan-400 transition-transform group-hover:scale-105" />
                <span className={`font-semibold text-white tracking-tight transition-all duration-200 ${scrolled ? 'text-base' : 'text-lg'}`}>CrewChief</span>
              </Link>

              <div className="hidden sm:flex items-center gap-1 text-white/30 text-sm">
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
                  <span className={`ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                    healthSummary.health_score >= 80
                      ? 'bg-green-500/15 text-green-300 border border-green-400/25'
                      : healthSummary.health_score >= 60
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-400/25'
                      : 'bg-red-500/15 text-red-300 border border-red-400/25'
                  }`}>
                    {healthSummary.health_score}
                  </span>
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
          <div className="flex border-t border-white/8 overflow-x-auto edge-fade-x">
              {tabs.map(({ key, label, icon: Icon, href }) => {
                const isActive = currentPage === key;
                return (
                  <Link
                    key={key}
                    href={href(vehicle.id)}
                    /*
                      RB0 rule 3. This was `py-2.5 text-xs` — about 36px tall,
                      under the 44px floor, on the primary navigation: the one
                      control every signed-in session touches. `py-3` plus an
                      explicit `min-h` clears it, and 13px carries the label
                      rather than 12, which is the R10 site this closes at the
                      same time. Visual weight is unchanged.
                    */
                    className={`relative flex items-center gap-1.5 px-4 py-3 min-h-[44px] text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                      isActive ? 'text-cyan-400 bg-cyan-400/5' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400' : 'text-white/40'}`} />
                    {label}
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
              <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-1.5">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h1>
              {vehicle.trim && (
                <p className="text-base text-white/50 font-medium">{vehicle.trim}</p>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-8">
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
                    className="flex items-center gap-1.5 group/edit"
                    aria-label="Edit mileage"
                  >
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">{displayVehicle.current_mileage?.toLocaleString() || '—'}</span>
                    <span className="text-sm text-white/30 font-normal">mi</span>
                    <Edit2 className="h-3.5 w-3.5 text-white/30 group-hover/edit:text-cyan-400 transition-colors opacity-0 group-hover/edit:opacity-100" />
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
                    className="flex items-center gap-1.5 group/edit"
                    aria-label="Edit average monthly miles"
                  >
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">{displayVehicle.avg_miles_per_month || '—'}</span>
                    <span className="text-sm text-white/30 font-normal">mi/mo</span>
                    <Edit2 className="h-3.5 w-3.5 text-white/30 group-hover/edit:text-cyan-400 transition-colors opacity-0 group-hover/edit:opacity-100" />
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

              {knowledge?.reliability_score && (
                <div className="flex flex-col gap-1">
                  <span className="label-uppercase">Reliability</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">
                      {knowledge.reliability_score}
                      <span className="text-sm text-white/40 ml-0.5">/10</span>
                    </span>
                    <Badge variant="outline" className={`${getReliabilityBadge(knowledge.reliability_score).color} border text-xs`}>
                      {getReliabilityBadge(knowledge.reliability_score).text}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* The body copy of the tab strip lived here. It is gone — see the
            note on the strip in the sticky header above. */}

        {/* The panel's padding, border and radius are what make it read as a
            card on a page. In app-shell mode there is no page for it to sit
            on, so below `md` it is just the remaining height. */}
        <div
          className={
            appShell
              ? 'flex-1 min-h-0 flex flex-col md:block md:glass-panel md:rounded-2xl md:p-6'
              : 'glass-panel rounded-2xl p-4 sm:p-6'
          }
        >
          {children}
        </div>

        <footer className={`${appShell ? 'hidden md:flex ' : 'flex '}mt-10 pt-6 border-t border-white/6 items-center justify-between text-xs text-white/25`}>
          <span>CrewChief &copy; {new Date().getFullYear()}</span>
          <div className="flex items-center gap-4">
            <a href="mailto:feedback@crewchief.app" className="hover:text-white/50 transition-colors">Feedback</a>
            <Link href={homeHref} className="hover:text-white/50 transition-colors">Garage</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
