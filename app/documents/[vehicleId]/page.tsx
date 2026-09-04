'use client';

import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { FileText, CircleCheck as CheckCircle2, MessageSquare } from 'lucide-react';
import { formatDate } from '@wellkept/core/formatting-utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getClientSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useVehicleImage } from '@/hooks/useSignedUrl';

/**
 * Service history, read from what was actually extracted.
 *
 * ── What this page used to be ───────────────────────────────────────────────
 *
 * Every line of it was fabricated, and the fabrication was labelled as
 * verified. A `MOCK_MAINTENANCE_DATA` constant held two invented records —
 * "Performance Auto Shop, 64,200 mi, $1,245.00" — rendered for *every* vehicle,
 * so a 2012 Sierra with 1 mile on it displayed someone else's brake job. Each
 * carried an **AI Verified** badge. "View PDF" called `handleDownloadFakePDF`,
 * a function named for what it was, which downloaded nothing and toasted
 * "AI extraction confidence: 99.2%" — a fabricated confidence score for a
 * fabricated record. The heading credited "Gemini 2.0 Flash Vision", a model
 * this app has never called.
 *
 * The worst part was not that it was fake. It is that **the real data existed
 * and this page hid it.** Uploading an invoice through the Consultant writes
 * genuine rows to `maintenance_line_items` — a corpus run on 30 Jul added five
 * from one invoice — and a user who did that came here and saw two invented
 * records about a car that is not theirs.
 *
 * So this is not a feature being built. It is a working feature being shown.
 *
 * ── The upload button ───────────────────────────────────────────────────────
 *
 * It was a stub: `toast.info('Upload feature available in full version')`, no
 * network call. There is an unused server action, `uploadInvoiceToMaintenance-
 * Items`, that could have been wired to it — and wiring it would have created a
 * second upload path beside the Consultant's working one. Two implementations
 * of one job is the exact shape of every cache bug found this week. The button
 * now sends you to the Consultant, which is where invoice upload actually
 * lives and works.
 */

interface LineItem {
  id: string;
  service_date: string | null;
  shop_name: string | null;
  item_description: string;
  part_number: string | null;
  total_cost: number | null;
  category: string | null;
  /**
   * Which writer produced this row — see `20260801120000`. `'vision'` is the
   * invoice-extraction path and the only one a provenance claim is true of.
   * `null` means the row predates the column and its origin is unknown.
   */
  source: 'vision' | 'manual' | 'seed' | null;
}

interface ServiceRecord {
  key: string;
  date: string | null;
  vendor: string;
  items: LineItem[];
  total: number;
  /**
   * Every line in this visit came from the vision path.
   *
   * A visit is a grouping of rows, and the rows can disagree: add a forgotten
   * item to a shop visit through the completion form and that date/shop pair
   * now holds one extracted row and one typed one. The badge sits on the visit,
   * so it may only claim what is true of all of them — "all" and not "any",
   * because a badge on a partly hand-entered visit is the same overclaim in
   * miniature.
   */
  allVision: boolean;
}

/**
 * `maintenance_line_items` stores one row per line, because that is what an
 * invoice is. A visit is what a person remembers, so group the rows back into
 * visits on (date, shop) — the pair that identifies one trip to one garage.
 */
function groupIntoVisits(rows: LineItem[]): ServiceRecord[] {
  const visits = new Map<string, ServiceRecord>();

  for (const row of rows) {
    const vendor = row.shop_name?.trim() || 'Unknown shop';
    const key = `${row.service_date ?? 'undated'}::${vendor}`;

    const visit = visits.get(key)
      ?? { key, date: row.service_date, vendor, items: [], total: 0, allVision: true };
    visit.items.push(row);
    visit.total += Number(row.total_cost ?? 0);
    // Seeded and unknown-provenance rows both fail this, which is intended:
    // neither was read off an invoice by a model.
    visit.allVision = visit.allVision && row.source === 'vision';
    visits.set(key, visit);
  }

  // Newest first; undated last, since a null date sorts unhelpfully either way.
  // Array.from rather than spread: this project's tsconfig target predates
  // downlevel iteration of a Map iterator.
  return Array.from(visits.values()).sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function DocumentsPage({ params }: { params: { vehicleId: string } }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const cachedData = queryClient.getQueryData<any>(['dashboard', params.vehicleId]);
  const cachedVehicle = cachedData?.vehicle ?? (cachedData?.id ? cachedData : undefined);

  const { data: fetchedVehicle, isLoading } = useQuery({
    queryKey: ['vehicle-row', params.vehicleId],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!params.vehicleId && !cachedVehicle,
    queryFn: async () => {
      const supabase = getClientSupabase();
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', params.vehicleId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Vehicle not found');
      return data;
    },
  });

  const { data: visits, isLoading: loadingHistory } = useQuery({
    queryKey: ['maintenance-line-items', params.vehicleId],
    staleTime: 60 * 1000,
    enabled: !!params.vehicleId,
    queryFn: async () => {
      const supabase = getClientSupabase();
      const { data, error } = await supabase
        .from('maintenance_line_items')
        .select('id, service_date, shop_name, item_description, part_number, total_cost, category, source')
        .eq('vehicle_id', params.vehicleId)
        .order('service_date', { ascending: false });
      if (error) throw error;
      return groupIntoVisits((data ?? []) as LineItem[]);
    },
  });

  const vehicle = cachedVehicle ?? fetchedVehicle;
  const vehicleImage = useVehicleImage(vehicle);

  if (!vehicle) {
    if (isLoading) {
      return (
        <div className="min-h-screen bg-[#080808] flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-info-border border-t-info rounded-full animate-spin" />
        </div>
      );
    }
    router.replace('/garage');
    return null;
  }

  const hasHistory = (visits?.length ?? 0) > 0;

  /*
    ── ⚠ The synthesis line, built only from what the rows hold ──────────────

    A design critique: "a concierge page would lead with a synthesis line…
    right now the page has no summary layer at all; it's chronology with no
    insight." It suggested "3 visits · $1,700 · last serviced Jan 2025 at
    66,900 mi".

    Three of those four facts are in the table. **The odometer is not** —
    `maintenance_line_items` has no mileage column, so "at 66,900 mi" would be
    a number invented to complete a sentence. It is left out rather than
    guessed, which is the same rule the health drivers hold themselves to.

    ⚠ The spend is what this history *records*, not what the car has cost.
    Rows arrive from uploaded invoices, so a visit nobody uploaded is missing
    from it — the wording says "recorded" for that reason and must keep saying
    something like it.
  */
  const summary = (() => {
    if (!visits || visits.length === 0) return null;

    const spend = visits.reduce((total, visit) => total + visit.total, 0);
    const dated = visits.filter((visit) => visit.date);
    const latest = dated.length > 0 ? dated[0].date : null;

    return [
      `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`,
      `${currency.format(spend)} recorded`,
      latest ? `last ${formatDate(latest)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  })();

  return (
    <DashboardLayout
      vehicle={vehicle}
      currentPage="maintenance"
      vehicleImage={vehicleImage}
      /*
        The visit records draw their own borders, so the layout's panel was a
        third rounded rectangle around them — page panel, then card, then the
        rules inside it. Two critiques counted that nesting on this page.
      */
      contentSurface="bare"
    >
      <div className="space-y-6">
        {/*
          ⚠ Stacks on a phone. Side by side, the button squeezed the heading
          into "Service / History" over two lines at 390px — a two-word title
          wrapping around a control is the layout deciding what the copy says.
        */}
        <div className="flex flex-col gap-4 mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="display-serif text-2xl text-white">Service history</h2>
            {/*
              This read "Digitized by <the vision model>" whenever any
              history existed. Naming the model from the constant fixed one
              problem — the literal had said "Gemini 2.0 Flash Vision" through
              two model generations — but left a larger one: the sentence is
              false unless a model actually digitised these rows.

              It did not, for two of the three writers of this table, and it
              never has for any demo car. Same defect as the per-row badge
              below, at page scale: the claim was attached to the *page* rather
              than to any record on it.

              Says what is true instead. When rows carry provenance, this can
              name the model again for the ones that earned it.
            */}
            <p className="text-white/50 text-sm mt-1">
              {summary ?? 'Upload an invoice to build your history'}
            </p>
          </div>
          {/*
            ⚠ A link, not a pill sitting between a heading and its content.

            A critique: "a pill button named after a different tab, doing
            navigation dressed as an action… on mobile it pushes the first card
            below the fold." Two of those three are fixable without lying about
            where it goes — it is navigation, so it looks like navigation, and
            it stops taking a button's worth of vertical space above the
            records.
          */}
          <Button
            variant="ghost"
            className="h-auto self-start p-0 text-sm font-medium text-white/70 underline decoration-white/25 underline-offset-4 hover:bg-transparent hover:text-white hover:decoration-white/50"
            onClick={() => router.push(`/consultant/${params.vehicleId}`)}
          >
            {/*
              ⚠ The glyph matches the destination. This was a speech bubble on
              a button labelled "Upload Invoice" — a critique called it "the
              wrong icon entirely, that's a chat glyph". It is not wrong about
              where the button goes: uploading an invoice happens in the
              consultant, by sending it. The label is what was misleading, so
              the label names the tab it opens — "advisor" was a third word for
              a feature already called Consultant in the nav and Jay in the
              thread, and a critique caught the collision.
            */}
            <MessageSquare className="w-4 h-4 mr-2" />
            Upload in Consultant
          </Button>
        </div>

        {loadingHistory && !visits && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-info-border border-t-info rounded-full animate-spin" />
          </div>
        )}

        {!loadingHistory && !hasHistory && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-10 text-center">
            <div className="bg-info-wash p-3 rounded-lg border border-info-border inline-flex mb-4">
              <FileText className="text-info w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white">No service records yet</h3>
            <p className="text-sm text-white/50 mt-2 max-w-md mx-auto">
              Attach a repair invoice in the Consultant and its line items are read and filed here
              automatically.
            </p>
            <Button
              variant="outline"
              className="border-info-border text-info hover:bg-cyan-500/10 mt-6"
              onClick={() => router.push(`/consultant/${params.vehicleId}`)}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Go to Consultant
            </Button>
          </div>
        )}

        {/*
          ⚠ Capped. The records ran the full ~1180px content width, so a
          40-character line item stretched a hairline across 1150px with its
          price orphaned at the far right — two critiques asked for a receipt
          column around 640–720px. An invoice is a narrow document; it does not
          get wider because the window did.
        */}
        {hasHistory && (
          <div className="grid gap-4 sm:max-w-3xl">
            {visits!.map((visit) => (
              <div
                key={visit.key}
                className="rounded-xl border border-white/10 p-5 transition-colors hover:border-white/25"
                /*
                  ⚠ Opaque. At 3% the beltline's ambient strip — a 1px cyan
                  hairline at `--belt-y` — crossed this card, and on the first
                  record it landed straight through the shop's name. Same fault
                  and same fix as the dashboard hero: a card sitting on the
                  page's ground is a card, not a window.
                */
                style={{ background: '#15171b' }}
              >
                {/*
                  ── ⚠ A record, not a tile with a bulleted list beside it ────

                  This was a two-column flex: an icon tile and a list on the
                  left, the total floating in a 130px column on the right. A
                  design critique measured what that cost — "the single most
                  important number per card has no anchor", sitting "indented
                  past the card edge but short of the bullet column, aligned to
                  nothing" — and named the repeated generic document glyph on
                  every card as informationless repetition.

                  A service visit is an invoice. So it is set as one: the shop
                  and the date as a header, the line items beneath, and the
                  total behind a rule at the foot where a total goes. The icon
                  is gone; the shop's name is the identity.
                */}
                <div>
                  <div>
                    {/*
                      ⚠ Sans, not the display serif. Setting a shop's name in
                      Newsreader at body size looked, in a critique's words,
                      "like an unstyled font fallback rather than a choice" —
                      the serif is for the page's display moments, and applying
                      it one level deeper cheapened both. Drift §10.1 says
                      titles and section heads; a record's subject is neither.
                    */}
                    <h3 className="text-base font-semibold text-white flex items-center gap-2 flex-wrap">
                      {visit.vendor}
                      {/*
                        The badge, back — and gated on data this time.

                        It shipped unconditionally until `9597869`, on the
                        argument that "the only writer of this table is the
                        vision extraction path". There were three. A user
                        marking a service item complete had their own typing
                        labelled machine-extracted, and every row on all three
                        demo cars — the recruiter-facing surface — came from an
                        INSERT in the seed migration.

                        It was removed rather than gated because nothing
                        recorded where a row came from, and the commit was
                        explicit that guessing from which fields happen to be
                        populated "would be a guess wearing a badge".
                        `20260801120000` adds the column, both write sites set
                        it, and this reads it. Rows predating the column carry
                        NULL and stay unbadged, which is the honest answer to a
                        question the database cannot retroactively answer.
                      */}
                      {visit.allVision && (
                        <span className="text-xs uppercase tracking-wider bg-info-wash text-info px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          AI Extracted
                        </span>
                      )}
                    </h3>
                    {/*
                      ⚠ `formatDate`, not the raw column.

                      This printed `visit.date` straight from `service_date` —
                      "2025-01-20" — in a product wearing a small-caps serif
                      wordmark, which a critique called the tell that nobody
                      read the page in character. And the helper had its own
                      bug: a date-only string parsed as UTC midnight rendered a
                      day early anywhere west of Greenwich. Both fixed; see
                      `formatting-utils.ts`.

                      The calendar glyph goes with it — a date needs no icon to
                      be recognised as a date.
                    */}
                    {visit.date && (
                      <p className="label-uppercase mt-1.5">{formatDate(visit.date)}</p>
                    )}
                    {/*
                      ── ⚠ The line prices were here all along ────────────────

                      Three design critiques asked for them — "a ledger without
                      numbers on its lines is not a ledger", "the core object of
                      this screen is under-designed" — and I refused twice, on
                      the claim that `total_cost` was the visit's total repeated
                      on every row.

                      That was wrong, and checkable in one query: the M3's
                      January visit is 89 + 28 + 155 + 145 + 378 + 220 = 1015,
                      which is exactly the total this card was already printing.
                      `groupIntoVisits` **sums** the column — if it held the
                      visit total per row the figure would have been six times
                      too large, and the page would have said so from the first
                      screenshot.

                      CLAUDE.md §1: verify against the artefact, never the
                      board. I had a belief about a column and did not query it.

                      ⚠ Rhythm, not a metronome: no rule between items — a
                      critique counted "six identical hairlines inside one card"
                      — spacing separates the lines and the only rule is the one
                      above the total, which is where an invoice puts it.
                    */}
                    <ul className="mt-4 space-y-1.5 border-t border-white/8 pt-3">
                      {visit.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-6 text-sm text-white/75"
                        >
                          <span className="min-w-0">
                            {item.item_description}
                            {item.part_number && (
                              <span className="text-white/50 ml-2 text-xs">{item.part_number}</span>
                            )}
                          </span>
                          {item.total_cost != null && (
                            <span className="shrink-0 tabular-nums text-white/60">
                              {currency.format(Number(item.total_cost))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-white/15 pt-3">
                      <span className="label-uppercase">Total</span>
                      <span className="tabular-nums text-lg font-bold text-white">
                        {currency.format(visit.total)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
