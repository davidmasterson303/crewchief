import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CircleCheck as CheckCircle, X, Check, Heart, Loader as Loader2, TriangleAlert, Wrench, Info } from 'lucide-react';
import { useWishlist } from '@/hooks/useWishlist';

interface IssueCardProps {
  issue: any;
  issueId: string;
  vehicleId: string;
  isCompleted: boolean;
  isNotInterested: boolean;
  isInWishlist: boolean;
  onMarkFixed: (issueId: string, issueName: string) => void;
  onNotApplicable: (issueId: string, status: 'not_interested') => void;
  onWishlistToggleComplete?: () => Promise<void>;
  getSeverityColor: (severity: string) => 'destructive' | 'default' | 'secondary';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export default function IssueCard({
  issue,
  issueId,
  vehicleId,
  isCompleted,
  isNotInterested,
  isInWishlist,
  onMarkFixed,
  onNotApplicable,
  onWishlistToggleComplete,
  getSeverityColor,
  size = 'md',
  loading = false,
}: IssueCardProps) {
  const { isSaved, isLoading: wishlistLoading, toggleWishlist } = useWishlist({
    vehicleId,
    itemName: issue.part,
    itemType: 'issue',
    initialIsSaved: isInWishlist,
    onToggleComplete: onWishlistToggleComplete,
  });

  const isSmall = size === 'sm';

  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case 'High':
        return { cls: 'bg-red-600 text-white border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]', Icon: TriangleAlert, label: 'Critical' };
      case 'Medium':
        return { cls: 'bg-transparent text-orange-300 border-orange-400/55', Icon: Wrench, label: 'Moderate' };
      case 'Low':
        return { cls: 'bg-transparent text-info/85 border-info-border', Icon: Info, label: 'Minor' };
      default:
        return { cls: 'bg-transparent text-slate-300 border-slate-400/40', Icon: Info, label: severity };
    }
  };

  return (
    <div
      className={`${isSmall ? 'p-3' : 'p-4'} border rounded-lg transition-all ${
        isCompleted
          ? 'bg-green-500/10 border-green-400/30'
          : /* "Not interested" is already said twice — by the slate fill and by
               the muted border. The `opacity-60` that used to be here was a
               third signal, and the only one that faded the issue text and its
               controls along with the card. The card is still live: you can
               read it and change your mind about it. */
            isNotInterested
          ? 'bg-slate-800/30 border-slate-700/30'
          : 'bg-slate-900/30 border-slate-700/50 hover:border-cyan-400/30 hover:bg-slate-900/50'
      }`}
    >
      <div className={`flex items-start justify-between ${isSmall ? 'mb-1' : 'mb-2'}`}>
        <div className="flex items-center gap-2 flex-1">
          <span className={`font-medium text-white ${isSmall ? 'text-sm' : 'text-base'}`}>{issue.part}</span>
          {isCompleted && (
            <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-400/50">
              <CheckCircle className="h-3 w-3 mr-1" />
              Fixed
            </Badge>
          )}
          {isNotInterested && (
            <Badge variant="outline" className="bg-slate-500/20 text-slate-400 border-slate-400/30">
              Not Applicable
            </Badge>
          )}
        </div>
        {(() => {
          const { cls, Icon, label } = getSeverityConfig(issue.severity);
          return (
            <Badge variant="outline" className={`${cls} flex items-center gap-1`}>
              <Icon className={`${isSmall ? 'h-2.5 w-2.5' : 'h-3 w-3'} flex-shrink-0`} />
              {label}
            </Badge>
          );
        })()}
      </div>
      <p className={`${isSmall ? 'text-sm' : 'text-base'} text-white/70 ${isSmall ? 'mb-1' : 'mb-2'}`}>
        {issue.description}
      </p>
      <p className={`text-xs text-white/50 ${isSmall ? 'mb-2' : 'mb-3'}`}>
        Typical occurrence: {issue.mileage_range}
      </p>
      {!isCompleted && !isNotInterested && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size={isSmall ? 'sm' : 'default'}
            variant={isSaved ? 'outline' : 'default'}
            className={
              isSaved
                ? `${isSmall ? 'h-7 text-xs' : ''} border-red-400/50 text-red-300 hover:border-red-400 hover:bg-red-500/10`
                : `${isSmall ? 'h-7 text-xs' : ''} bg-cyan-600 text-white hover:bg-cyan-500`
            }
            onClick={toggleWishlist}
            disabled={wishlistLoading || loading}
          >
            {wishlistLoading ? (
              <>
                <Loader2 className={`${isSmall ? 'h-3 w-3' : 'h-4 w-4'} mr-1 animate-spin`} />
                {isSaved ? 'Removing' : 'Adding'}
              </>
            ) : (
              <>
                <Heart className={`${isSmall ? 'h-3 w-3' : 'h-4 w-4'} mr-1 ${isSaved ? 'fill-current' : ''}`} />
                {isSaved ? 'Remove from Wishlist' : 'Add to Wishlist'}
              </>
            )}
          </Button>
          <Button
            size={isSmall ? 'sm' : 'default'}
            variant="outline"
            className={`${isSmall ? 'h-7 text-xs' : ''} bg-green-500/10 text-green-400 border-green-400/50 hover:bg-green-500/20`}
            onClick={() => onMarkFixed(issueId, issue.part)}
            disabled={loading}
          >
            <Check className={`${isSmall ? 'h-3 w-3' : 'h-4 w-4'} mr-1`} />
            Mark Fixed
          </Button>
          <Button
            size={isSmall ? 'sm' : 'default'}
            variant="ghost"
            className={`${isSmall ? 'h-7 text-xs' : ''} text-white/60 hover:bg-white/10 hover:text-white/80`}
            onClick={() => onNotApplicable(issueId, 'not_interested')}
            disabled={loading}
          >
            <X className={`${isSmall ? 'h-3 w-3' : 'h-4 w-4'} mr-1`} />
            Not Applicable
          </Button>
        </div>
      )}
    </div>
  );
}
