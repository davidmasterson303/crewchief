'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader as Loader2, ChevronDown, ChevronUp, Zap, ChartBar as BarChart3, DollarSign, Target, Wrench, CircleAlert as AlertCircle, Plus } from 'lucide-react';
import { generateModificationDetails, addModificationToWishlist } from '@/app/actions';
import { toast } from 'sonner';

interface ModificationDetailsCardProps {
  vehicleId: string;
  modName: string;
  vehicle: any;
  details?: any;
}

export default function ModificationDetailsCard({ vehicleId, modName, vehicle, details: initialDetails }: ModificationDetailsCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [isAddingToWishlist, setIsAddingToWishlist] = useState(false);
  const [details, setDetails] = useState(initialDetails);
  const [addedToWishlist, setAddedToWishlist] = useState(false);

  useEffect(() => {
    if (initialDetails) {
      setDetails(initialDetails);
    }
  }, [initialDetails]);

  const handleGenerateDetails = async (isAuto: boolean = false) => {
    if (isAuto) {
      setIsAutoLoading(true);
    } else {
      setIsManualLoading(true);
    }

    const result = await generateModificationDetails(vehicleId, modName, vehicle, vehicle.performance_mindedness);

    if (result.success) {
      setDetails(result.data);
      if (!isAuto) {
        setIsExpanded(true);
        toast.success('Modification analysis generated');
      }
    } else if (!isAuto) {
      toast.error('Failed to generate analysis');
    }

    if (isAuto) {
      setIsAutoLoading(false);
    } else {
      setIsManualLoading(false);
    }
  };

  const handleAddToWishlist = async () => {
    setIsAddingToWishlist(true);
    const result = await addModificationToWishlist(vehicleId, modName);

    if (result.success) {
      setAddedToWishlist(true);
      toast.success('Added to wishlist');
    } else {
      toast.error(result.error || 'Failed to add to wishlist');
    }
    setIsAddingToWishlist(false);
  };

  if (!details) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-4 relative overflow-hidden">
        {isAutoLoading && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse pointer-events-none" />
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h4 className="font-semibold text-white text-sm">{modName}</h4>
            <div className="mt-2 space-y-2">
              <div className="h-3 bg-white/10 rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-white/10 rounded w-1/2 animate-pulse" />
            </div>
            <p className="text-white/50 text-xs mt-3 flex items-center gap-1">
              {isAutoLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {isAutoLoading ? 'Generating detailed analysis...' : 'No analysis yet'}
            </p>
          </div>
          {!isAutoLoading && (
            <Button
              size="sm"
              onClick={() => handleGenerateDetails(false)}
              disabled={isManualLoading}
              className="bg-accent hover:bg-accent/90 text-white whitespace-nowrap transition-colors"
            >
              {isManualLoading ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Analyzing
                </>
              ) : (
                'Analyze Mod'
              )}
            </Button>
          )}
          {isAutoLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-white/50" />
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="text-white text-base">{modName}</CardTitle>
            {details.alignment_with_goals && (
              <p className="text-white/60 text-xs mt-2">{details.alignment_with_goals}</p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="bg-accent/80 hover:bg-accent text-white font-semibold px-4 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            {isExpanded ? (
              <>
                <span className="mr-2 text-xs">Show Less</span>
                <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                <span className="mr-2 text-xs">See Details</span>
                <ChevronDown className="h-4 w-4 animate-bounce" />
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {details.performance_impact && (
            <div className="flex gap-3">
              <Zap className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-white/80 text-xs font-semibold mb-1">Performance Impact</h5>
                <p className="text-white/60 text-xs leading-relaxed">{details.performance_impact}</p>
              </div>
            </div>
          )}

          {details.reliability_impact && (
            <div className="flex gap-3">
              <AlertCircle className="h-4 w-4 text-info flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-white/80 text-xs font-semibold mb-1">Reliability Impact</h5>
                <p className="text-white/60 text-xs leading-relaxed">{details.reliability_impact}</p>
              </div>
            </div>
          )}

          {details.cost_benefit_analysis && (
            <div className="flex gap-3">
              <DollarSign className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-white/80 text-xs font-semibold mb-1">Cost & Value</h5>
                <p className="text-white/60 text-xs leading-relaxed">{details.cost_benefit_analysis}</p>
              </div>
            </div>
          )}

          {details.installation_notes && (
            <div className="flex gap-3">
              <Wrench className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-white/80 text-xs font-semibold mb-1">Installation Notes</h5>
                <p className="text-white/60 text-xs leading-relaxed">{details.installation_notes}</p>
              </div>
            </div>
          )}

          {details.compatibility_notes && (
            <div className="flex gap-3">
              <BarChart3 className="h-4 w-4 text-info flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-white/80 text-xs font-semibold mb-1">Compatibility</h5>
                <p className="text-white/60 text-xs leading-relaxed">{details.compatibility_notes}</p>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-white/10">
            {addedToWishlist ? (
              <Badge className="bg-green-500/20 text-green-300 border-green-500/30 w-full justify-center py-2">
                <Plus className="h-3 w-3 mr-1" />
                Added to Wishlist
              </Badge>
            ) : (
              <Button
                size="sm"
                onClick={handleAddToWishlist}
                disabled={isAddingToWishlist}
                className="w-full bg-accent hover:bg-accent/90 text-white h-8 transition-colors"
              >
                {isAddingToWishlist ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Adding
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-1" />
                    Add to Wishlist
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
