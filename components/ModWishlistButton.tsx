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
      /*
        ── ⚠ UI-01 / UI-03 · both halves of this were unreadable ─────────────

        Saved: `text-gray-700` on a near-black surface at **1.63:1** — a
        light-theme palette class left on a dark product. Unsaved: white on
        `--accent` (cyan-400) at **1.81:1**, with the hover *worse* at 2.19:1.

        Both overrides are deleted rather than recoloured. `components/ui/button.tsx`
        states the rule directly — *"a call site that still needs a colour is a
        bug in the primitive"* — and the two variants already carry the right
        pairs: `default` is `bg-primary` with `text-primary-foreground` at
        5.10:1, `outline` is the token border with `text-foreground`.

        The red hover is kept: it is what tells you the control removes rather
        than adds, and `hover:text-red-600` on the page surface clears the
        floor. Only the resting greys go.
      */
      className={
        isSaved ? 'h-7 text-xs hover:border-red-600 hover:text-red-600' : 'h-7 text-xs'
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
