'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, Loader as Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteAccount } from '@/app/account-actions';
import { createBrowserSupabaseClient } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';
import { signOutAndClearCache } from '@/lib/sign-out';
import { toast } from 'sonner';

const CONFIRM_PHRASE = 'DELETE';

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Counts shown so the user knows exactly what disappears. */
  vehicleCount: number;
}

/**
 * Permanent account deletion — App Store Guideline 5.1.1(v).
 *
 * Apple requires the option to be genuinely available, not buried and not
 * region-gated, and to remove the account rather than deactivate it. It also
 * permits a confirmation step provided it isn't "unnecessarily difficult",
 * which is what the type-to-confirm is: enough friction to prevent a misclick
 * on an irreversible action, not enough to obstruct someone who means it.
 *
 * The inventory is spelled out rather than summarised as "your data" — a user
 * agreeing to deletion should know it takes the invoice images with it.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  vehicleCount,
}: DeleteAccountDialogProps) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  async function handleDelete() {
    if (!confirmed || deleting) return;
    setDeleting(true);

    const result = await deleteAccount();

    if (!result.success) {
      toast.error(result.error ?? 'Could not delete the account.');
      setDeleting(false);
      return;
    }

    // The auth user is gone, so the cookie now references nothing. Clear it
    // locally too, otherwise the browser keeps a session for a dead account —
    // and clear the query cache with it. This is the path where a cache leak
    // is least defensible: the user's stated intent was that the data cease to
    // exist, and rows deleted server-side while their cached copies sit in
    // this tab is the opposite of that.
    await signOutAndClearCache(createBrowserSupabaseClient(), queryClient);

    // Apple requires confirmation that deletion actually happened.
    toast.success('Your account and all its data have been deleted.');
    router.push('/');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={deleting ? undefined : onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'var(--critical-red-wash)' }}
          >
            <TriangleAlert className="h-6 w-6 text-red-400" aria-hidden="true" />
          </div>
          <DialogTitle className="display-serif text-center text-2xl text-foreground">
            Delete your account
          </DialogTitle>
          <DialogDescription className="text-center text-muted-foreground">
            This is permanent and cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded-lg border p-4 text-sm"
          style={{
            background: 'var(--critical-red-wash)',
            borderColor: 'var(--critical-red-border)',
          }}
        >
          <p className="label-uppercase mb-2">What gets deleted</p>
          <ul className="space-y-1 text-foreground/75">
            <li>
              <span className="num font-semibold text-foreground">{vehicleCount}</span>{' '}
              {vehicleCount === 1 ? 'vehicle' : 'vehicles'} and their full history
            </li>
            <li>All maintenance records, wishlists and cost data</li>
            <li>Every uploaded invoice and photo</li>
            <li>Your conversations with the AI consultant</li>
            <li>Your profile and sign-in credentials</li>
          </ul>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-delete" className="text-muted-foreground">
            Type <span className="num font-semibold text-foreground">{CONFIRM_PHRASE}</span> to
            confirm
          </Label>
          <Input
            id="confirm-delete"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoComplete="off"
            disabled={deleting}
            aria-describedby="confirm-delete-help"
          />
          <p id="confirm-delete-help" className="text-xs text-muted-foreground">
            You can export your data first from the section above.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
            className="border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={!confirmed || deleting}
            className="bg-red-500 text-white hover:bg-red-400 disabled:opacity-40"
          >
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Deleting…
              </>
            ) : (
              'Delete my account'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
