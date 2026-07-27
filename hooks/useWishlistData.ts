import { useQuery } from '@tanstack/react-query';

async function fetchWishlistItems(vehicleId: string) {
  const response = await fetch(`/api/v1/wishlist?vehicleId=${vehicleId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch wishlist items');
  }
  const data = await response.json();
  return data.wishlistItems || [];
}

export function useWishlistData(vehicleId: string) {
  return useQuery({
    queryKey: ['wishlist', vehicleId],
    queryFn: () => fetchWishlistItems(vehicleId),
    staleTime: 2 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });
}
