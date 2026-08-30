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

import { ADVISOR_NAME } from '@wellkept/core/prompts';
import { adviceDisclosure, RECALL_MATCH_CAVEAT } from '@wellkept/core/advice-disclosure';
import { ADVISOR_AI_CONSENT, INVOICE_AI_CONSENT } from '@wellkept/core/ai-consent-copy';

const ROOT = join(__dirname, '..', '..');

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const WEB_CHAT = read('components', 'ConsultantChat.tsx');
const MOBILE_ADVISOR = read('apps', 'mobile', 'src', 'screens', 'AdvisorScreen.tsx');

const WEB_HEALTH = read('components', 'HealthSummary.tsx');
const MOBILE_HEALTH = read('apps', 'mobile', 'src', 'screens', 'HealthScreen.tsx');

const WEB_MODS = read('components', 'insights', 'ModificationsTab.tsx');
const MOBILE_MODS = read('apps', 'mobile', 'src', 'screens', 'BuildScreen.tsx');

const WEB_SCHEDULE = read('components', 'insights', 'MaintenanceTab.tsx');
const MOBILE_SCHEDULE = read('apps', 'mobile', 'src', 'screens', 'ServiceMilestoneScreen.tsx');

const WEB_ESTIMATE = read('components', 'CostBreakdownTable.tsx');
const MOBILE_ESTIMATE = read('apps', 'mobile', 'src', 'components', 'EstimateWell.tsx');

const WEB_RECALL_CARD = read('components', 'RecallAlerts.tsx');
const WEB_RECALL_MODAL = read('components', 'RecallHistoryModal.tsx');
const MOBILE_RECALL = read('apps', 'mobile', 'src', 'screens', 'RecallDetailScreen.tsx');

/**
 * Source with every comment removed, so an assertion cannot be satisfied by
 * prose that merely *discusses* the thing it is checking for.
 *
 * ⚠ Whole `/* … *\/` regions, not lines that begin with a comment marker. A
 * line-prefix filter looks right and fails on exactly the comments in this
 * codebase: a JSX `{/* … *\/}` block's middle lines start with ordinary words,
 * so the filter kept them — and these files all explain the finding they close
 * directly above the line that closes it. That is the `.tap-target-44` trap
 * from rule 5, which found a string in a comment 600 lines from the rule.
 *
 * Over-removal is the safe direction here: it can only make an assertion harder
 * to satisfy, never easier.
 */
function rendered(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

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

  /*
    ── ⚠ Handoff §1.3 · the claim the other clauses cannot make ──────────────

    "Written by AI" says what produced the text; "from this car's records" says
    what it had. Neither says what it **lacked**, and the gap between reading a
    service history and inspecting a vehicle is the whole of what an owner risks
    misunderstanding when a confident paragraph recommends a repair.

    Lifted verbatim from the Terms, so this also guards the two from drifting.
  */
  it('says the AI has never seen the car, on both surfaces §1.3 names', () => {
    for (const surface of ['consultant', 'health'] as const) {
      expect([surface, /never seen your car/.test(adviceDisclosure(surface))]).toEqual([
        surface,
        true,
      ]);
    }
  });

  it('uses the Terms’ own sentence rather than a paraphrase', () => {
    const terms = read('app', 'terms', 'page.tsx');
    expect(terms).toMatch(/It has never seen your car\./);
  });

  /*
    ── ⚠ The advisor is named now, and the disclosure still must not name him ─

    This was "the name is blocked, do not guess it". It was chosen on 30 Aug —
    the advisor is **Jay** — and the assertion survives the decision with its
    meaning intact rather than being deleted with the blocker.

    §1.3's suggested copy reads *"Written by [advisor name]'s AI…"*, and this
    file deliberately does not use it. The disclosure exists to tell a reader a
    **model** wrote the text; a first name in that sentence reads as a person
    vouching for it, which is the one impression a liability line cannot afford
    to give. "Written by AI" is the claim; "Jay" is the character who delivers
    it everywhere else.

    So: no placeholder, no product name, and no persona name — three ways the
    same sentence goes soft, and the third only became possible today.
  */
  it('ships no placeholder, no product name and no persona name', () => {
    for (const surface of ['consultant', 'health', 'estimate', 'plan'] as const) {
      const copy = adviceDisclosure(surface);
      expect([surface, /\[advisor name\]|\{advisor/i.test(copy)]).toEqual([surface, false]);
      expect([surface, /CrewChief|Well Kept/i.test(copy)]).toEqual([surface, false]);
      expect([surface, new RegExp(`\\b${ADVISOR_NAME}\\b`, 'i').test(copy)]).toEqual([
        surface,
        false,
      ]);
    }
  });

  it('the advisor is named in one place, and every surface reads it from there', () => {
    /*
      The drift this prevents is not cosmetic. The transcript formatter labels
      past turns with this name and feeds them back as the model's own words —
      a model told it is Jay and shown a script attributed to somebody else has
      been handed a third party mid-conversation.

      So the literal may exist once, in the constant. Anywhere else it is a copy
      waiting to be missed by the next rename, which is exactly what the last
      one found.
    */
    expect(ADVISOR_NAME).toBe('Jay');

    const rendered_ = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');

    for (const [name, source] of [
      ['web consultant', WEB_CHAT],
      ['the transcript formatter', read('app', 'actions.ts')],
    ] as const) {
      const body = rendered_(source);
      expect(`${name}: ${body.includes('ADVISOR_NAME')}`).toBe(`${name}: true`);
      expect(`${name}: ${new RegExp(`['\"\`>]${ADVISOR_NAME}[:'\"\`<]`).test(body)}`).toBe(
        `${name}: false`
      );
    }
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

  /*
    ── ⚠ D11 · once per surface, on both clients ─────────────────────────────

    The disclosure module has modelled four surfaces since it was written and
    two of them were rendered by nothing at all. `RECALL_MATCH_CAVEAT` was
    exported, asserted for its wording by the test above, and shown on no
    screen — a constant no client renders is a written fix, not a shipped one,
    which is the distinction this whole round of work is about.

    Table-driven so adding a surface means adding a row: the failure this
    guards is one client quietly lacking what the other has, and that is
    invisible from either side on its own.
  */
  const SURFACES: Array<[string, string, RegExp]> = [
    ['web health', WEB_HEALTH, /adviceDisclosure\('health'\)/],
    ['mobile health', MOBILE_HEALTH, /adviceDisclosure\('health'\)/],
    ['web mods', WEB_MODS, /adviceDisclosure\('plan'\)/],
    ['mobile mods', MOBILE_MODS, /adviceDisclosure\('plan'\)/],
    ['mobile estimate', MOBILE_ESTIMATE, /adviceDisclosure\('estimate'\)/],
    /*
      ⚠ Added 30 Aug, and its absence is the finding. This table was written to
      catch "one client quietly lacking what the other has" — and it shipped
      with an estimate row for mobile and none for the web, so the web's cost
      breakdown rendered a model's figures with no disclosure for six days
      while this suite stayed green.

      A table-driven guard is only as complete as its table. That is the cost
      of the pattern and the reason a missing row has to read as a defect
      rather than as a surface nobody got to.
    */
    ['web estimate', WEB_ESTIMATE, /adviceDisclosure\('estimate'\)/],
  ];

  it.each(SURFACES)('%s renders its disclosure', (_name, source, pattern) => {
    expect(pattern.test(rendered(source))).toBe(true);
  });

  /*
    The schedule is disclosed through `service-provenance.ts` rather than
    `adviceDisclosure('plan')`, and deliberately: that module exists for
    schedule provenance and says the more careful thing ("typical", not
    "manufacturer-recommended"). Two sentences making one disclosure on one
    screen is the duplication these modules exist to avoid.

    ⚠ The web rendered nothing here at all until D11, while mobile had carried
    the label since the module was written — the same list of intervals, from
    the same column, reading as manufacturer fact on one client.
  */
  it.each([
    ['web', WEB_SCHEDULE],
    ['mobile', MOBILE_SCHEDULE],
  ])('%s schedule names its provenance', (_name, source) => {
    expect(rendered(source)).toMatch(/SCHEDULE_BASIS_LABELS\['generated-schedule'\]/);
  });

  it.each([
    ['web recall card', WEB_RECALL_CARD],
    ['web recall modal', WEB_RECALL_MODAL],
    ['mobile recall screen', MOBILE_RECALL],
  ])('%s carries the match caveat', (_name, source) => {
    /*
      ⚠ And never the AI disclosure. A recall is NHTSA's record quoted; "written
      by AI" under a safety notice is false in the one direction that is
      actually dangerous — the reader hedges on a defect notice.
    */
    const body = rendered(source);
    expect(body).toMatch(/RECALL_MATCH_CAVEAT/);
    expect(body).not.toMatch(/adviceDisclosure\(/);
  });

  it('can still detect a surface that lost its disclosure', () => {
    /*
      Anti-vacuous, per rule 5. Every assertion above is a `toMatch` over source
      text, and the whole family would pass forever if `rendered` returned
      something that never matches — or, worse, if it stripped so little that a
      comment satisfied it. Both directions are checked here.
    */
    expect(rendered("const x = 1;\n<Text>{adviceDisclosure('health')}</Text>")).toMatch(
      /adviceDisclosure\('health'\)/
    );

    /*
      ⚠ A real JSX comment, whose middle line starts with an ordinary word. This
      is the exact shape a line-prefix filter kept, and every file this suite
      scans contains one: the finding is explained directly above the line that
      closes it.
    */
    expect(
      rendered("{/*\n  we render adviceDisclosure('health') here\n*/}\n// and adviceDisclosure here")
    ).not.toMatch(/adviceDisclosure/);
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
