/**
 * The invoice scanner narrates work it actually did — UX-15, handoff §1.4.
 *
 * @jest-environment node
 *
 * ── What shipped, and why nothing caught it ─────────────────────────────────
 *
 * `InvoiceProcessingLoader` took one boolean and ran its own `setInterval` over
 * four hard-coded stages, advancing with `(prev + 1) % steps.length`.
 *
 * The modulo is the part worth remembering. It **wrapped**: any upload slower
 * than 8.5 seconds ticked "Processing line items" complete with a green check,
 * then began "Uploading file" again — so a user watching a slow scan saw the
 * work finish two or three times. Nothing displayed was ever observed, and no
 * test could have caught it, because the component was internally consistent.
 * It was a correct implementation of a lie.
 *
 * ── ⚠ The fix was not to delete the beat ────────────────────────────────────
 *
 * `CODE_HANDOFF_2026-08-24.md` §1.4 is explicit, and it corrects an earlier
 * reading of this decision: *"not to remove the beat but to make it narrate
 * something real — count up the records actually read, name the file being
 * parsed, show the fields extracted as they land. Same reassurance, no
 * fiction."*
 *
 * So these tests are not "assert the animation is gone". They assert that every
 * figure shown is one the client genuinely holds, and that where it holds none,
 * nothing is shown rather than a timer.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  hasScanDetailToNarrate,
  scanExtractedLine,
  scanFilePosition,
  scanStageLabel,
  type ScanProgress,
} from '@crewchief/core/scan-progress';

const ROOT = join(__dirname, '..', '..');
const LOADER = readFileSync(join(ROOT, 'components', 'InvoiceProcessingLoader.tsx'), 'utf8');
const DIALOG = readFileSync(join(ROOT, 'components', 'DocumentUploadDialog.tsx'), 'utf8');

/** Comments removed, so prose about the defect cannot satisfy an assertion. */
function rendered(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const at = (over: Partial<ScanProgress> = {}): ScanProgress => ({
  stage: 'reading',
  fileName: 'invoice.jpg',
  fileIndex: 1,
  fileCount: 1,
  itemsExtracted: 0,
  ...over,
});

describe('the loader owns no clock', () => {
  /*
    ⚠ The assertion this suite exists for. The component drove itself, so its
    display was decoupled from the upload entirely — the boolean could have been
    `false` for ten seconds and the stages would have kept marching.
  */
  it('runs no timer of its own', () => {
    const body = rendered(LOADER);
    expect(body).not.toMatch(/setInterval|setTimeout/);
  });

  it('keeps no stage state of its own', () => {
    /*
      `useState` for the current step is what made the stages fiction. Every
      value it shows is a prop now, so the only way to display a stage is for
      the upload loop to have entered it.
    */
    expect(rendered(LOADER)).not.toMatch(/useState|useEffect/);
  });

  it('reports no percentage', () => {
    /*
      There cannot honestly be one. The client knows how many files remain and
      nothing at all about how far through a model call it is. A bar that fills
      on a timer claims the work has been measured.
    */
    expect(rendered(LOADER)).not.toMatch(/%\s*`|progress\s*}%|Math\.round\(progress/);
  });

  it('is fed real state by the upload loop', () => {
    const body = rendered(DIALOG);
    expect(body).toMatch(/setScan\(/);
    expect(body).toMatch(/stage:\s*'preparing'/);
    expect(body).toMatch(/stage:\s*'reading'/);
    // Anti-vacuous: the stripper leaves real code alone.
    expect(body).toMatch(/InvoiceProcessingLoader/);
  });
});

describe('the stages match the awaits', () => {
  /*
    Two, not four. `prepareForUpload` and one `fetch`. Everything the server
    does inside that request is one opaque wait from the client, and splitting
    it into "Analyzing content" and "Extracting details" invented a boundary
    nobody could observe.
  */
  it('names the two waits the client can actually see', () => {
    expect(scanStageLabel(at({ stage: 'preparing' }))).toBe('Preparing the file');
    expect(scanStageLabel(at({ stage: 'reading' }))).toBe('Reading the invoice');
  });

  it('says "reading" rather than "analyzing", matching the phone', () => {
    /*
      The mobile scanner already settled this wording — "the model is reading
      the document. Saying so is the difference between 'slow' and 'stuck'" —
      and one wait should not have two vocabularies across two clients.
    */
    const mobile = readFileSync(
      join(ROOT, 'apps', 'mobile', 'src', 'screens', 'InvoiceScanScreen.tsx'),
      'utf8'
    );
    expect(mobile).toMatch(/Reading the invoice/);
    expect(scanStageLabel(at({ stage: 'reading' })).toLowerCase()).toContain('reading');
  });
});

describe('it counts only what has come back', () => {
  it('says nothing about line items while the first file is still in flight', () => {
    /*
      ⚠ "0 line items" before any response is a result reported before there is
      one — the same defect as a progress bar sitting at 0%, which claims the
      work has been measured.
    */
    expect(scanExtractedLine(at({ fileIndex: 1, fileCount: 3, itemsExtracted: 0 }))).toBeNull();
  });

  it('reports the count once a file has been answered for', () => {
    expect(scanExtractedLine(at({ fileIndex: 2, fileCount: 3, itemsExtracted: 7 }))).toBe(
      '7 line items so far'
    );
    expect(scanExtractedLine(at({ fileIndex: 2, fileCount: 3, itemsExtracted: 1 }))).toBe(
      '1 line item so far'
    );
  });

  it('reports a genuine zero once there is one to report', () => {
    /*
      An invoice the model read and found no line items on is a real outcome,
      and distinct from "nothing back yet". The user needs to know rather than
      watch a counter that never moves.
    */
    expect(scanExtractedLine(at({ fileIndex: 2, fileCount: 3, itemsExtracted: 0 }))).toBe(
      '0 line items so far'
    );
  });
});

describe('it shows nothing rather than a timer', () => {
  it('reports no position for a single file', () => {
    // "File 1 of 1" is noise dressed as information, and implies a queue.
    expect(scanFilePosition(at({ fileIndex: 1, fileCount: 1 }))).toBeNull();
    expect(scanFilePosition(at({ fileIndex: 2, fileCount: 4 }))).toBe('File 2 of 4');
  });

  it('has nothing to narrate for one file with nothing back yet', () => {
    /*
      Handoff §1.4: "Where there is genuinely nothing to narrate, show nothing
      rather than a timer." The stage line above it is the one true thing, and
      the detail panel stays absent rather than holding a slot open.
    */
    expect(hasScanDetailToNarrate(at({ fileIndex: 1, fileCount: 1, itemsExtracted: 0 }))).toBe(
      false
    );
  });

  it('has something to narrate as soon as either figure is real', () => {
    // Anti-vacuous, both ways in: a queue alone, or an answer alone.
    expect(hasScanDetailToNarrate(at({ fileIndex: 1, fileCount: 3 }))).toBe(true);
    expect(hasScanDetailToNarrate(at({ fileIndex: 2, fileCount: 2, itemsExtracted: 4 }))).toBe(true);
  });

  it('gates the detail panel on it', () => {
    expect(rendered(LOADER)).toMatch(/hasScanDetailToNarrate\(progress\)/);
  });
});

describe('the wait is described without being estimated', () => {
  it('promises no duration', () => {
    /*
      "About 10 seconds" would be the old defect restated in prose. The honest
      shape of a wait nobody here can measure is to say it is a wait.
    */
    const body = rendered(LOADER);
    expect(body).not.toMatch(/\b\d+\s*(seconds|minutes|mins|secs)\b/i);
  });

  it('announces itself to a screen reader', () => {
    /*
      The old stages were divs that changed colour, so a blind user got a
      spinner and no account of it at all — the progress indicator was, for
      them, purely decorative and purely fictional.
    */
    const body = rendered(LOADER);
    expect(body).toMatch(/aria-live="polite"/);
    expect(body).toMatch(/role="status"/);
  });
});
