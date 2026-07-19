'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader as Loader2 } from 'lucide-react';
import { generateVehicleDossier } from '@/app/actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { logger } from '@/lib/logger';

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
      className="border-accent/50 text-accent hover:bg-accent/10"
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
