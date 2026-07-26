import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Heart, Loader as Loader2 } from 'lucide-react';
import { useWishlist } from '@/hooks/useWishlist';

interface MaintenanceItemCardProps {
  item: any;
  vehicleId: string;
  isInWishlist: boolean;
  onAddToHistory: (itemName: string) => void;
  onWishlistToggleComplete?: () => Promise<void>;
  loading?: boolean;
}

export default function MaintenanceItemCard({
  item,
  vehicleId,
  isInWishlist,
  onAddToHistory,
  onWishlistToggleComplete,
  loading = false,
}: MaintenanceItemCardProps) {
  const { isSaved, isLoading: wishlistLoading, toggleWishlist } = useWishlist({
    vehicleId,
    itemName: item.item,
    itemType: 'maintenance',
    initialIsSaved: isInWishlist,
    onToggleComplete: onWishlistToggleComplete,
  });

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case 'Critical':
        return 'bg-red-600 text-white border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
      case 'High':
        return 'bg-transparent text-orange-300 border-orange-400/55';
      case 'Routine':
        return 'bg-transparent text-info/75 border-info-border';
      default:
        return 'bg-transparent text-slate-300 border-slate-400/40';
    }
  };

  return (
    <div className="p-4 border rounded-lg transition-all bg-slate-900/30 border-slate-700/50 hover:border-cyan-400/30 hover:bg-slate-900/50">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-white">{item.item}</h4>
          <p className="text-sm text-white/60 mt-1">Interval: {item.interval}</p>
        </div>
        <Badge variant="outline" className={getPriorityBadgeClass(item.priority)}>
          {item.priority}
        </Badge>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs bg-info-wash text-info border-info-border hover:bg-cyan-500/20"
          onClick={() => onAddToHistory(item.item)}
          disabled={loading}
        >
          <Clock className="h-3 w-3 mr-1" />
          Add to History
        </Button>
        <Button
          size="sm"
          variant={isSaved ? 'outline' : 'default'}
          className={
            isSaved
              ? 'h-7 text-xs border-red-400/50 text-red-300 hover:border-red-400 hover:bg-red-500/10'
              : 'h-7 text-xs bg-cyan-600 text-white hover:bg-cyan-500'
          }
          onClick={toggleWishlist}
          disabled={wishlistLoading || loading}
        >
          {wishlistLoading ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              {isSaved ? 'Removing' : 'Adding'}
            </>
          ) : (
            <>
              <Heart className={`h-3 w-3 mr-1 ${isSaved ? 'fill-current' : ''}`} />
              {isSaved ? 'Remove from Wishlist' : 'Add to Wishlist'}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
