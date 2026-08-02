/**
 * The rules around deleting an account, shared by the web dialog and the
 * mobile one. No React, no network.
 *
 * ── Why this is shared rather than written twice ────────────────────────────
 *
 * App Store guideline 5.1.1(v) requires deletion to be initiated **from inside
 * the reviewed app**, so the mobile flow is not a convenience — it is the one
 * Apple looks at. The web flow already existed. Two implementations of "has the
 * user confirmed" means the surface being reviewed can quietly become the
 * weaker of the two, and nothing would report it: both would still delete
 * accounts, and both would still look right.
 *
 * So the phrase, the comparison and the summary live here, and each surface
 * owns only its own presentation.
 */

/**
 * What the user types to arm the delete button.
 *
 * Apple permits a confirmation step provided it is not "unnecessarily
 * difficult". A single word is enough friction to stop a misclick on an
 * irreversible action and not enough to obstruct someone who means it.
 */
export const DELETION_CONFIRM_PHRASE = 'DELETE';

/**
 * Whether what the user typed counts as confirmation.
 *
 * Trimmed and case-insensitive on purpose. On iOS the keyboard auto-capitalises
 * and the software keyboard readily appends a trailing space, so a strict
 * comparison would leave a user staring at a disabled button having typed
 * exactly what was asked — which reads as a broken screen, not as a safeguard.
 * The friction that matters is having to type the word at all.
 */
export function isDeletionConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === DELETION_CONFIRM_PHRASE;
}

/** What the server reports it destroyed. */
export interface DeletionCounts {
  vehicles: number;
  storageObjects: number;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A sentence naming what was destroyed, for after the fact.
 *
 * Apple asks for confirmation that deletion actually happened, and "done" does
 * not carry that. Counts do — and they are also the only evidence a user will
 * ever get that the invoice images went with the account, since by the time
 * they read this there is nothing left to inspect.
 */
export function describeDeletion(deleted: Partial<DeletionCounts> | null | undefined): string {
  const vehicles = Math.max(0, Math.round(deleted?.vehicles ?? 0));
  const files = Math.max(0, Math.round(deleted?.storageObjects ?? 0));

  if (vehicles === 0 && files === 0) {
    // A real outcome, not an error: an account with nothing in it. Saying "0
    // vehicles and 0 files" invites the reader to wonder what went wrong.
    return 'Your account and all its data have been deleted.';
  }

  const parts = [
    vehicles > 0 ? plural(vehicles, 'vehicle', 'vehicles') : null,
    files > 0 ? plural(files, 'file', 'files') : null,
  ].filter(Boolean) as string[];

  return `Your account has been deleted, along with ${parts.join(' and ')}.`;
}

/**
 * The inventory shown *before* deleting, spelled out rather than summarised.
 *
 * "Your data" is the phrasing that lets someone agree to this without
 * realising it takes the invoice images too. The web dialog established that
 * and the mobile one has to say the same things — this is the list, so neither
 * can quietly drop an item.
 */
export const DELETION_INVENTORY: readonly string[] = [
  'Every vehicle, with its service history and dossier',
  'Every invoice and document you have uploaded, including the images',
  'Every consultant conversation',
  'Your profile and sign-in',
];
