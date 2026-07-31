'use client';

import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { FileText, Calendar, MessageSquare } from 'lucide-react';
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
}

interface ServiceRecord {
  key: string;
  date: string | null;
  vendor: string;
  items: LineItem[];
  total: number;
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

    const visit = visits.get(key) ?? { key, date: row.service_date, vendor, items: [], total: 0 };
    visit.items.push(row);
    visit.total += Number(row.total_cost ?? 0);
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
        .select('id, service_date, shop_name, item_description, part_number, total_cost, category')
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

  return (
    <DashboardLayout vehicle={vehicle} currentPage="maintenance" vehicleImage={vehicleImage}>
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">Service History</h2>
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
              {hasHistory ? 'Every visit on file' : 'Upload an invoice to build your history'}
            </p>
          </div>
          <Button
            variant="outline"
            className="border-info-border text-info hover:bg-cyan-500/10"
            onClick={() => router.push(`/consultant/${params.vehicleId}`)}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Upload Invoice
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

        {hasHistory && (
          <div className="grid gap-4">
            {visits!.map((visit) => (
              <div
                key={visit.key}
                className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-cyan-500/40 transition-colors"
              >
                <div className="flex gap-4 items-start">
                  <div className="bg-info-wash p-3 rounded-lg border border-info-border flex-shrink-0">
                    <FileText className="text-info w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white flex items-center gap-2 flex-wrap">
                      {visit.vendor}
                      {/*
                        The "AI Extracted" badge was here, unconditionally, and
                        its comment argued it was safe "because the only writer
                        of this table is the vision extraction path". That was
                        not true, in two ways:

                          - `moveServiceItemToHistory` writes a row from a
                            user-typed completion form — date, shop, cost,
                            notes. No model reads anything.
                          - Every row on all three demo cars comes from
                            `20260314142241_seed_demo_vehicles.sql`, an INSERT
                            in a migration.

                        So on the public demo — the recruiter-facing surface —
                        every record carried a provenance claim that was false.
                        That is a smaller version of exactly what `ae45710`
                        removed from this page: a confidence signal asserted
                        rather than earned.

                        Removed rather than gated, because provenance is not
                        currently recorded. `maintenance_line_items` has no
                        column saying where a row came from — `extraction_status`
                        exists on `vehicle_documents`, not here — and any
                        distinguisher based on which fields happen to be
                        populated would be a guess wearing a badge.

                        The badge is worth having back: a row genuinely read
                        off an invoice by a model is the product's argument.
                        It needs a `source` column set at each write site, which
                        is a migration, and migrations here are applied by hand.
                        Recorded in the roadmap rather than guessed at now.
                      */}
                    </h3>
                    {visit.date && (
                      <div className="flex items-center gap-4 text-sm text-white/50 mt-1">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          {visit.date}
                        </span>
                      </div>
                    )}
                    <ul className="mt-3 space-y-1.5">
                      {visit.items.map((item) => (
                        <li key={item.id} className="text-sm text-white/75 flex items-start gap-2">
                          <div className="w-1 h-1 rounded-full bg-white/30 flex-shrink-0 mt-2" />
                          <span>
                            {item.item_description}
                            {item.part_number && (
                              <span className="text-white/40 ml-2 text-xs">{item.part_number}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3 min-w-[130px]">
                  <span className="text-xl font-bold text-white">{currency.format(visit.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
