import { Button } from '@/components/ui/button';
import { Heart, Loader2 } from 'lucide-react';
import { useWishlist } from '@/hooks/useWishlist';

interface ModWishlistButtonProps {
  vehicleId: string;
  modName: string;
  isInWishlist: boolean;
  onWishlistToggleComplete?: () => Promise<void>;
  loading?: boolean;
  size?: 'sm' | 'default';
}

export default function ModWishlistButton({
  vehicleId,
  modName,
  isInWishlist,
  onWishlistToggleComplete,
  loading = false,
  size = 'sm',
}: ModWishlistButtonProps) {
  const { isSaved, isLoading: wishlistLoading, toggleWishlist } = useWishlist({
    vehicleId,
    itemName: modName,
    itemType: 'modification',
    initialIsSaved: isInWishlist,
    onToggleComplete: onWishlistToggleComplete,
  });

  return (
    <Button
      size={size}
      variant={isSaved ? 'outline' : 'default'}
      className={
        isSaved
          ? 'h-7 text-xs border-gray-300 text-gray-700 hover:border-red-600 hover:text-red-600'
          : 'h-7 text-xs bg-accent text-white hover:bg-accent/90'
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
  );
}
