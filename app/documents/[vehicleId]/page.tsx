'use client';

import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { FileText, Download, CircleCheck as CheckCircle2, Wrench, Calendar } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getClientSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const MOCK_MAINTENANCE_DATA = [
  {
    id: 'm1',
    date: '2025-10-14',
    vendor: 'Performance Auto Shop',
    mileage: '64,200',
    total_cost: '$1,245.00',
    items: ['Synthetic Oil Change', 'Brake Pad Replacement (Front/Rear)', 'Brake Fluid Flush'],
    ai_extracted: true,
  },
  {
    id: 'm2',
    date: '2024-03-22',
    vendor: 'Dealership Service Center',
    mileage: '58,100',
    total_cost: '$450.00',
    items: ['Transmission Fluid Service', 'Multi-point Inspection'],
    ai_extracted: true,
  },
];

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

  const vehicle = cachedVehicle ?? fetchedVehicle;

  const handleDownloadFakePDF = () => {
    toast.success('Invoice PDF downloaded successfully.', {
      description: 'AI extraction confidence: 99.2%',
    });
  };

  if (!vehicle) {
    if (isLoading) {
      return (
        <div className="min-h-screen bg-[#080808] flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-info-border border-t-cyan-400 rounded-full animate-spin" />
        </div>
      );
    }
    router.replace('/garage');
    return null;
  }

  return (
    <DashboardLayout
      vehicle={vehicle}
      currentPage="maintenance"
      vehicleImage={vehicle.custom_image_url || vehicle.image_url}
    >
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">Service History</h2>
            <p className="text-white/50 text-sm mt-1">Digitized by Gemini 2.0 Flash Vision</p>
          </div>
          <Button
            variant="outline"
            className="border-info-border text-cyan-400 hover:bg-cyan-500/10"
            onClick={() => toast.info('Upload feature available in full version')}
          >
            + Upload Invoice
          </Button>
        </div>

        <div className="grid gap-4">
          {MOCK_MAINTENANCE_DATA.map((record) => (
            <div
              key={record.id}
              className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-cyan-500/40 transition-colors"
            >
              <div className="flex gap-4 items-start">
                <div className="bg-info-wash p-3 rounded-lg border border-info-border flex-shrink-0">
                  <FileText className="text-cyan-400 w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2 flex-wrap">
                    {record.vendor}
                    {record.ai_extracted && (
                      <span className="text-[10px] uppercase tracking-wider bg-info-wash text-cyan-300 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                        <CheckCircle2 className="w-3 h-3" />
                        AI Verified
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-4 text-sm text-white/50 mt-1">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {record.date}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5" />
                      {record.mileage} mi
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {record.items.map((item) => (
                      <li key={item} className="text-sm text-white/75 flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-white/30 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col items-end gap-3 min-w-[130px]">
                <span className="text-xl font-bold text-white">{record.total_cost}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full bg-white/10 hover:bg-white/20 text-white border-0"
                  onClick={handleDownloadFakePDF}
                >
                  <Download className="w-4 h-4 mr-2" />
                  View PDF
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
