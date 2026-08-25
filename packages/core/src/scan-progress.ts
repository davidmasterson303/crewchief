/**
 * What the invoice scanner is actually doing, said in words.
 *
 * ── ⚠ UX-15 / handoff §1.4 · four steps on a loop, none of them observed ────
 *
 * `InvoiceProcessingLoader` ran its own `setInterval` over four hard-coded
 * stages — *Uploading file* (2000ms), *Analyzing content* (2000ms), *Extracting
 * details* (2500ms), *Processing line items* (2000ms) — and advanced through
 * them with `(prev + 1) % steps.length`.
 *
 * The modulo is the tell. It **wrapped**, so on any upload slower than 8.5
 * seconds the display ticked "Processing line items" green, then started
 * "Uploading file" again from the top, having already claimed the whole
 * sequence complete. Green check marks accumulated against stages that had
 * never reported anything, on a component whose only real input was a boolean.
 *
 * ── The fix is not to delete the beat ───────────────────────────────────────
 *
 * `CODE_HANDOFF_2026-08-24.md` §1.4: *"not to remove the beat but to make it
 * narrate something real — count up the records actually read, name the file
 * being parsed, show the fields extracted as they land. Same reassurance, no
 * fiction."*
 *
 * All three of those are available and none of them was being used:
 *
 *   - **The file being parsed** — `DocumentUploadDialog` already tracks it, and
 *     deliberately keeps the *original* name rather than the reduced copy's.
 *   - **Which file of how many** — it loops over `selectedFiles` by index.
 *   - **The records extracted** — every response carries `itemsExtracted`, and
 *     the dialog already sums them for its toast. They land per file, so they
 *     can be counted up as they arrive rather than announced at the end.
 *
 * ── ⚠ Two stages, because there are two awaits ──────────────────────────────
 *
 * Not four. The client awaits `prepareForUpload` (image reduction, local) and
 * then one `fetch` to `/api/v1/upload-document`. Everything the server does
 * inside that request — storing the file, calling the model, validating that it
 * is an automotive invoice, writing line items — is **one opaque wait** from
 * here. Splitting it into "Analyzing content" and "Extracting details" invented
 * a boundary the client cannot see, and inventing boundaries is how the old
 * component came to be a timer.
 *
 * If those stages are ever wanted, the server has to stream them. Until it
 * does, two honest stages beat four fictional ones.
 */

export type ScanStage =
  /** Reducing the image locally, before anything leaves the device. */
  | 'preparing'
  /** In flight, and the model is reading it. The long one. */
  | 'reading'
  /** Every selected file has been answered for. */
  | 'done';

export interface ScanProgress {
  stage: ScanStage;
  /** The name the user chose, never the reduced copy's. `null` before one is picked. */
  fileName: string | null;
  /** 1-based index of the file being worked on. */
  fileIndex: number;
  /** How many files this run covers. */
  fileCount: number;
  /** Line items extracted so far, across every file already answered for. */
  itemsExtracted: number;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The headline: what is happening right now.
 *
 * ⚠ "Reading" rather than "Analyzing". The mobile scanner already settled this
 * wording — *"the model is reading the document. Saying so is the difference
 * between 'slow' and 'stuck'"* — and the two clients should not describe one
 * wait in two vocabularies.
 */
export function scanStageLabel(progress: ScanProgress): string {
  switch (progress.stage) {
    case 'preparing':
      return 'Preparing the file';
    case 'reading':
      return 'Reading the invoice';
    case 'done':
      return 'Done';
  }
}

/**
 * Which file, of how many — or `null` when there is only one.
 *
 * ⚠ "File 1 of 1" is noise dressed as information. A single-file upload has no
 * position to report, and printing one implies a queue the user does not have.
 */
export function scanFilePosition(progress: ScanProgress): string | null {
  if (progress.fileCount <= 1) return null;
  return `File ${progress.fileIndex} of ${progress.fileCount}`;
}

/**
 * The count that lands as the work lands, or `null` before anything has.
 *
 * ── ⚠ Zero is not "nothing yet" ─────────────────────────────────────────────
 *
 * Returning "0 line items" while the first file is still in flight would be a
 * result reported before there is one — the same defect as a progress bar at
 * 0%, which is a claim that work has been measured. Nothing is said until a
 * file has actually come back.
 *
 * Once one has, `0` is a real answer and is said out loud: an invoice the model
 * read and found no line items on is a genuine outcome, and the user needs to
 * know that rather than watch a counter that never moves.
 */
export function scanExtractedLine(progress: ScanProgress): string | null {
  const answered = progress.stage === 'done' ? progress.fileCount : progress.fileIndex - 1;
  if (answered < 1) return null;

  return `${plural(progress.itemsExtracted, 'line item')} so far`;
}

/**
 * Whether there is anything true to show besides the stage itself.
 *
 * Handoff §1.4: *"Where there is genuinely nothing to narrate, show nothing
 * rather than a timer."* A single file, still in flight, with nothing back yet
 * has exactly one true thing to say — that it is being read — and the rest of
 * the panel stays empty rather than filling with placeholders.
 */
export function hasScanDetailToNarrate(progress: ScanProgress): boolean {
  return scanFilePosition(progress) !== null || scanExtractedLine(progress) !== null;
}
