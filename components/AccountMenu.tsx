'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, Settings, LogOut, Loader as Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createBrowserSupabaseClient } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';
import { toast } from 'sonner';

/**
 * Account menu — the only route to settings, and to signing out.
 *
 * Neither existed before. Settings matters beyond convenience: App Store
 * Guideline 5.1.1(v) requires account deletion to be genuinely discoverable,
 * and Apple's wording points at account settings specifically. A settings
 * page nothing links to would not have satisfied it.
 *
 * Sign-out clears the TanStack Query cache as well as the Supabase session.
 * Without that, cached vehicle and dashboard data survives in memory and the
 * next account to sign in on the same browser tab briefly sees the previous
 * user's garage before refetching.
 */
export function AccountMenu() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);

    try {
      await createBrowserSupabaseClient().auth.signOut();
    } catch {
      // Sign out locally regardless — a failed round trip should not strand
      // someone in a session they have asked to leave.
    }

    // Order matters: drop cached data before navigating, so nothing renders
    // another account's vehicles in the gap.
    queryClient.clear();

    toast.success('Signed out');
    router.push('/login');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="tap-target-44 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <User className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52 border-border bg-card">
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4 text-info" aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-border" />

        <DropdownMenuItem
          onClick={handleSignOut}
          disabled={signingOut}
          className="cursor-pointer"
        >
          {signingOut ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
