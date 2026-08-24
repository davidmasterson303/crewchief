/**
 * Generated advice says so, on both clients, where the advice is.
 *
 * @jest-environment node
 *
 * ── Two findings, one sentence (UX-16 and LEG-05, 24 Aug) ───────────────────
 *
 * **UX-16: the product never said its advice was AI-generated.** The consultant
 * answers in confident prose and nothing on the screen told the reader a model
 * wrote it.
 *
 * **LEG-05: the safety disclaimer lived only on a Terms page nobody opens.** It
 * appeared nowhere near the advice — not under an answer, not beside the health
 * score, not on a recall card.
 *
 * ── Why this guard exists at all ────────────────────────────────────────────
 *
 * Because the failure mode here is not "somebody deletes the disclaimer". It is
 * **one client keeping it and the other losing it**, which is this codebase's
 * single most repeated defect — the health band, the context-kind labels, the
 * markdown tokeniser, `VehicleCard`'s unauthorized delete. Applied to the
 * sentence that limits liability, that is the version worth a build failure.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adviceDisclosure, RECALL_MATCH_CAVEAT } from '@crewchief/core/advice-disclosure';
import { ADVISOR_AI_CONSENT, INVOICE_AI_CONSENT } from '@crewchief/core/ai-consent-copy';

const ROOT = join(__dirname, '..', '..');

const WEB_CHAT = readFileSync(join(ROOT, 'components', 'ConsultantChat.tsx'), 'utf8');
const MOBILE_ADVISOR = readFileSync(
  join(ROOT, 'apps', 'mobile', 'src', 'screens', 'AdvisorScreen.tsx'),
  'utf8'
);

describe('the disclosure itself', () => {
  it('names the thing rather than hedging about accuracy', () => {
    /*
      ⚠ "May contain inaccuracies" is a hedge, not a disclosure — it does not
      tell anybody what the thing is. Every surface has to say a model wrote it.
    */
    for (const surface of ['consultant', 'health', 'estimate', 'plan'] as const) {
      expect([surface, /\bAI\b/.test(adviceDisclosure(surface))]).toEqual([surface, true]);
    }
  });

  it('does not claim the advice is not advice', () => {
    /*
      It plainly is advice; the product's whole proposition is that it advises.
      Claiming otherwise in small print under a paragraph that just recommended
      a repair reads as evasive and persuades nobody, including a court.
    */
    expect(adviceDisclosure('consultant').toLowerCase()).not.toMatch(/not advice|no advice/);
  });

  it('keeps recalls out of it', () => {
    /*
      ⚠ A recall is **not** generated advice — it is NHTSA's own record, quoted.
      "Written by AI" under one would be false in the direction that gets a
      safety notice ignored. What a recall needs is the matching caveat, which
      is a different claim: year/make/model, never VIN.
    */
    expect(RECALL_MATCH_CAVEAT).toMatch(/year, make and model/);
    expect(RECALL_MATCH_CAVEAT).not.toMatch(/\bAI\b/);
  });
});

describe('both clients render it', () => {
  it('is on the web consultant', () => {
    expect(WEB_CHAT).toMatch(/adviceDisclosure\('consultant'\)/);
  });

  it('is on the mobile advisor', () => {
    /*
      ⚠ The half that matters. A disclosure on one client and not the other is
      the defect this repo keeps producing, and it is invisible from either side
      on its own.
    */
    expect(MOBILE_ADVISOR).toMatch(/adviceDisclosure\('consultant'\)/);
  });

  it('neither writes its own wording', () => {
    /*
      A second copy drifts. Both clients import the string; a hardcoded "AI" or
      "mechanic" sentence beside the answer would be a second source of truth
      for the sentence that limits liability.
    */
    for (const [name, source] of [['web', WEB_CHAT], ['mobile', MOBILE_ADVISOR]] as const) {
      const rendered = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('*') && !line.includes('//'))
        .join('\n');

      expect([name, /qualified mechanic/.test(rendered)]).toEqual([name, false]);
    }
  });
});

/**
 * ── LEG-02: the consent is asked in the same words on both clients ──────────
 *
 * Apple amended Guideline 5.1.2(i) in November 2025 to require **explicit
 * permission** before personal data is shared with a third-party AI. The audit
 * asks for a sheet on first invoice scan and first advisor use, **mirrored on
 * the web upload dialog** — and mirrored means the same words.
 *
 * A consent whose wording differs between the two is two different consents,
 * and only one of them is the one somebody actually gave.
 */
describe('the AI consent', () => {
  const SCAN = readFileSync(
    join(ROOT, 'apps', 'mobile', 'src', 'screens', 'InvoiceScanScreen.tsx'),
    'utf8'
  );
  const UPLOAD = readFileSync(join(ROOT, 'components', 'DocumentUploadDialog.tsx'), 'utf8');

  it('names Google rather than "third-party AI services"', () => {
    /*
      The amendment is about a person being able to decide, and deciding needs
      to know **who**. "Third-party AI services" is the phrasing that satisfies
      nobody.
    */
    for (const copy of [INVOICE_AI_CONSENT, ADVISOR_AI_CONSENT]) {
      expect([copy.title, /Google/.test(copy.title + copy.body)]).toEqual([copy.title, true]);
    }
  });

  it('warns that an invoice is not only your own data', () => {
    /*
      ⚠ The part somebody would not think of: an invoice carries the **shop's**
      name and business address. `LEG-09` is the same fact from the retention
      side.
    */
    expect(INVOICE_AI_CONSENT.points.join(' ')).toMatch(/shop’s name and address/);
  });

  it('says what declining costs, so the choice is a real one', () => {
    /*
      Refusal means "no AI features", never "no app" — blocking the product on a
      privacy refusal trades a 5.1.2 problem for a 5.1.1(v)-shaped one.
    */
    for (const copy of [INVOICE_AI_CONSENT, ADVISOR_AI_CONSENT]) {
      expect([copy.decline, copy.declineNote.length > 30]).toEqual([copy.decline, true]);
      expect(copy.declineNote).toMatch(/works the same|by hand/);
    }
  });

  it('is asked on the phone and mirrored on the web', () => {
    expect(SCAN).toMatch(/INVOICE_AI_CONSENT/);
    expect(UPLOAD).toMatch(/INVOICE_AI_CONSENT/);
  });

  it('neither client writes its own wording', () => {
    // A second copy drifts, and this is a consent.
    for (const [name, source] of [['scan', SCAN], ['upload', UPLOAD]] as const) {
      const rendered = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/*'))
        .join('\n');

      expect([name, /goes to Google/.test(rendered)]).toEqual([name, false]);
    }
  });
});
