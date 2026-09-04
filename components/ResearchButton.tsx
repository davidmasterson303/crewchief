'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader as Loader2 } from 'lucide-react';
import { generateVehicleDossier } from '@/app/actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { logger } from '@wellkept/core/logger';

interface ResearchButtonProps {
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  hasData: boolean;
}

export default function ResearchButton({ vehicleId, year, make, model, hasData }: ResearchButtonProps) {
  const [isResearching, setIsResearching] = useState(false);
  const router = useRouter();

  const handleResearch = async () => {
    setIsResearching(true);
    toast.loading('Researching vehicle information...', { id: 'research' });

    try {
      const vehicleData = { id: vehicleId, year, make, model };
      const result = await generateVehicleDossier(vehicleId, vehicleData);

      if (result.success) {
        toast.success('Vehicle research completed! Reloading...', { id: 'research' });
        router.refresh();
      } else {
        const errorMsg = result.error || 'Research failed. Please try again.';
        logger.error('RESEARCH_BUTTON:FAILED', new Error(errorMsg));
        toast.error(errorMsg, { id: 'research' });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'An unexpected error occurred';
      logger.error('RESEARCH_BUTTON:EXCEPTION', error as Error);
      toast.error(errorMsg, { id: 'research' });
    } finally {
      setIsResearching(false);
    }
  };

  return (
    <Button
      onClick={handleResearch}
      disabled={isResearching}
      variant="outline"
      size="sm"
      /*
        ⚠ Quiet. This was `border-accent/50 text-accent` — a fully saturated
        cyan outline on a secondary action, which made refreshing the research
        the loudest control on a page whose subject is the car's specification.
        Cyan is the mark now, not the accent for ordinary controls; see the
        note on links in `DiagnosticHero`.
      */
      className="border-white/20 text-white/80 hover:border-white/35 hover:bg-white/5 hover:text-white"
    >
      {isResearching ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Researching...
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-4 w-4" />
          {hasData ? 'Refresh Research' : 'Generate Research'}
        </>
      )}
    </Button>
  );
}
