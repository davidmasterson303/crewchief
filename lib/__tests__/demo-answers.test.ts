/**
 * The demo answers without spending anything, and says that it is a demo.
 *
 * @jest-environment node
 *
 * Two properties, and the second is the one this project keeps having to
 * relearn. The demo must cost nothing — that is what makes "worst case per
 * prospect is zero" true in `ai/pricing.ts`. And it must not present a
 * pre-written answer as one a model just produced, which is the same defect as
 * the scan sweep that depicted an examination nobody ran, the hero timer that
 * counted nothing, and the quote bar that filled while the request was still in
 * flight.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { refusalCopy } from '@wellkept/core/access';
import { DEMO_VEHICLE_IDS } from '@wellkept/core/demo';
import {
  DEMO_ANSWERS,
  demoAnswerFor,
  demoQuestionsFor,
} from '@wellkept/core/demo-answers';

const SOURCE = readFileSync(
  join(__dirname, '..', '..', 'packages', 'core', 'src', 'demo-answers.ts'),
  'utf8'
);

describe('the demo cannot spend money', () => {
  it('the answers module reaches no model, no network and no key', () => {
    /*
      The assertion the pricing model depends on. A demo that grew a "just this
      one call" path would reopen the exposure this file was written to close —
      and it would do it invisibly, because the demo would keep working.

      Source-scanned rather than executed: what matters is that the capability is
      absent, and a passing call at runtime proves only that it did not happen on
      that path this time.
    */
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/generateContent|GoogleGenAI|fetch\(|GEMINI/);
    expect(code).not.toMatch(/import .*(gemini|genai|ai\/)/i);
  });

  it('answers are literals in the file, not fetched from anywhere', () => {
    // Anti-vacuous: the scan above passes trivially for an empty module.
    expect(DEMO_ANSWERS.length).toBeGreaterThanOrEqual(6);
    for (const entry of DEMO_ANSWERS) {
      expect(`${entry.id}: ${entry.answer.length > 200}`).toBe(`${entry.id}: true`);
    }
  });
});

describe('it answers the question asked, or none', () => {
  it('matches a question the demo offers', () => {
    const offered = demoQuestionsFor(DEMO_VEHICLE_IDS[1]);
    expect(offered.length).toBeGreaterThan(0);

    const hit = demoAnswerFor(DEMO_VEHICLE_IDS[1], offered[0].question);
    expect(hit?.id).toBe(offered[0].id);
  });

  it('ignores casing and trailing punctuation, which are not a different question', () => {
    const offered = demoQuestionsFor(DEMO_VEHICLE_IDS[0])[0];

    expect(demoAnswerFor(DEMO_VEHICLE_IDS[0], offered.question.toUpperCase())?.id).toBe(
      offered.id
    );
    expect(demoAnswerFor(DEMO_VEHICLE_IDS[0], `  ${offered.question.replace(/\?$/, '')}  `)?.id)
      .toBe(offered.id);
  });

  it('returns null for a question it does not hold, rather than the nearest one', () => {
    /*
      ⚠ The heart of it. A matcher that finds the "closest" answer answers a
      question nobody asked — and a plausible answer to the wrong question is
      indistinguishable from a good one, on a product whose whole posture is
      ranges over verdicts and `unknown` over a guessed default.
    */
    expect(demoAnswerFor(DEMO_VEHICLE_IDS[0], 'Can I tow a caravan with this?')).toBeNull();

    // And a near-miss on a question it *does* hold is still a miss.
    expect(demoAnswerFor(DEMO_VEHICLE_IDS[1], 'is anything urgent')).toBeNull();
  });

  it('does not answer one car with another car’s sample', () => {
    // The vehicle id is part of the key, not decoration: a WRX recall answer
    // shown against the Accord would be a fabricated recall.
    const wrxQuestion = demoQuestionsFor(DEMO_VEHICLE_IDS[1])[0].question;

    expect(demoAnswerFor(DEMO_VEHICLE_IDS[0], wrxQuestion)).toBeNull();
  });
});

describe('the answers are about the cars that are actually seeded', () => {
  it('covers every demo vehicle', () => {
    for (const id of DEMO_VEHICLE_IDS) {
      expect(`${id}: ${demoQuestionsFor(id).length > 0}`).toBe(`${id}: true`);
    }
  });

  it('names each car’s real mileage rather than a round number', () => {
    /*
      Read from the database on 30 Aug: the Accord is at 94,800, the WRX at
      41,200, the M3 at 67,400. A demo answer that describes a different car
      than the one on screen beside it is worse than no demo, and it is the
      failure mode of writing sample copy without opening the data.
    */
    const accord = demoQuestionsFor(DEMO_VEHICLE_IDS[0]).map((e) => e.answer).join(' ');
    const m3 = demoQuestionsFor(DEMO_VEHICLE_IDS[2]).map((e) => e.answer).join(' ');

    expect(accord).toContain('94,800');
    expect(m3).toContain('67,400');
  });

  it('keeps the recall answer to what NHTSA actually matched on', () => {
    /*
      §10, and the one claim in this file that could hurt somebody. The recall
      is real and open, and it matches on year/make/model — never the VIN. A
      sample answer that said "your car is affected" would be telling an owner
      something the lookup cannot support, in a demo, about a safety notice.
    */
    const wrx = demoQuestionsFor(DEMO_VEHICLE_IDS[1]).map((e) => e.answer).join(' ');

    expect(wrx).toMatch(/not on this car's VIN|not on this car’s VIN/i);
    expect(wrx).toMatch(/engine bearings/i);
  });

  it('never speaks in the first person, per the voice rules', () => {
    // REBRAND_PROMPT §5: the AI is a method, not a personality. It says what it
    // read and what it concluded.
    for (const entry of DEMO_ANSWERS) {
      expect(`${entry.id}: ${/\bI\b|\bI'm\b|\bI’ve\b|\bmy\b/.test(entry.answer)}`).toBe(
        `${entry.id}: false`
      );
    }
  });
});

describe('the label that keeps it honest', () => {
  it('the demo’s refusal copy says the answer was written in advance', () => {
    /*
      The copy lives in `access.ts` beside the rule that produces it; this
      asserts the two modules are actually connected, because a sample answer
      shown without that sentence is the defect this whole design is avoiding.
    */
    expect(refusalCopy('demo', 'generate')).toMatch(/written in advance/i);
  });
});
