/**
 * The demo's answers, written in advance and never generated.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * David, 30 Aug: *"I don't want a free tier. I think we should have a demo
 * view/mode without real LLM calls so prospects can explore the app without
 * costing anything."*
 *
 * The demo consultant used to make real Gemini calls against a shared ceiling —
 * about $11 a month of exposure to anybody who found the URL. Prospects are now
 * the largest unpaid population in the product, so that arrangement gets worse
 * exactly as the product succeeds. Pre-written answers cost nothing, once,
 * forever.
 *
 * ── ⚠ The honesty constraint, which decides the whole design ────────────────
 *
 * A canned answer presented as though a model had just read this car is the
 * same defect as the scan sweep that depicted an examination nobody performed,
 * the hero timer that counted nothing, and the quote bar that reached 100% while
 * the request was still in flight. Three of those have been removed in the last
 * week. This must not be the fourth.
 *
 * So every answer here is labelled as a sample at the point it is shown —
 * `refusalCopy('demo', 'generate')` carries the wording — and this file is only
 * ever reached when nobody is signed in.
 *
 * ── Why a fixed set of questions rather than fuzzy matching ─────────────────
 *
 * A matcher that finds the "closest" sample answers a question nobody asked.
 * On a product whose entire posture is ranges over verdicts and `unknown` over
 * a guessed default, answering the wrong question confidently is the worst
 * available failure — and it would be invisible, because a plausible answer to
 * the wrong question reads exactly like a good answer.
 *
 * So the demo offers its questions. A typed question that is not one of them
 * gets `null`, and the caller says so. Exploration is not blocked; guessing is.
 *
 * ── ⚠ These are drafts, and they are product copy ───────────────────────────
 *
 * Written against the real seeded records — the mileages, trims and the WRX's
 * genuine NHTSA campaign are read from the database, not invented — but the
 * voice is Design's and the claims are David's to sign off. `REBRAND_PROMPT.md`
 * §5 is explicit that the AI is *"a method, not a personality"*: it says what it
 * read and what it concluded, and never speaks in the first person.
 */

import { DEMO_VEHICLE_IDS } from './demo';

export interface DemoAnswer {
  /** Stable id, so a client can key a list without using the question text. */
  id: string;
  /** Which seeded vehicle this is about. */
  vehicleId: string;
  /** Offered verbatim. The visitor picks it; they do not have to type it. */
  question: string;
  /** The sample answer. Plain paragraphs, no markdown headings. */
  answer: string;
}

const [ACCORD, WRX, M3] = DEMO_VEHICLE_IDS;

/**
 * ⚠ Every claim below is checkable against the seeded row it describes.
 *
 * The 2018 Accord is a 1.5T Sport at 94,800 miles; the 2020 WRX is at 41,200
 * and carries a real open engine-bearing campaign; the 2019 M3 Competition is at
 * 67,400. An answer that drifts from those is a demo that lies about the car
 * sitting next to it on screen, which is worse than no demo.
 */
export const DEMO_ANSWERS: readonly DemoAnswer[] = [
  {
    id: 'accord-oil',
    vehicleId: ACCORD,
    question: 'What should I be doing at this mileage?',
    answer:
      'At 94,800 miles the 1.5T Accord is at the point where the maintenance that matters stops being oil changes and starts being the things that fail quietly. Two are worth booking together: the CVT fluid, which Honda calls a lifetime fill and independent shops generally do not, and the rear differential service if this car has all-wheel drive.\n\nThe 1.5-litre turbo engine has a known pattern of fuel dilution in the oil in cold, short-trip use — oil that smells of petrol on the dipstick is the symptom. It is not a fault on every car and it is worth checking rather than assuming.\n\nExpect $300–$600 for the pair at an independent shop, more at a dealer.',
  },
  {
    id: 'accord-noise',
    vehicleId: ACCORD,
    question: 'There is a rattle from the front over bumps. What is it likely to be?',
    answer:
      'On a car of this age and mileage, a rattle from the front over bumps is most often a sway bar link or a strut mount. Both are inexpensive parts, both are quick to diagnose, and neither is dangerous in the short term — but they are also the two things that get replaced when the real cause is a worn control arm bush, which is not.\n\nThe way to tell them apart is a hand on the strut tower while somebody rocks the car. That is a two-minute check for a mechanic and not something that can be settled from a service history.\n\nA sway bar link is typically $80–$180 fitted. A control arm is $300–$550.',
  },
  {
    id: 'wrx-recall',
    vehicleId: WRX,
    question: 'Is there anything urgent on this car?',
    answer:
      'Yes. NHTSA has an open recall on certain 2020 WRX vehicles for engine bearings assembled with insufficient oil clearance, which can cause premature engine wear and a loss of power while driving. Subaru repairs it free of charge.\n\nThat match is on year, make and model — not on this car\'s VIN — so it means "this campaign covers cars like this one", and a dealer can confirm whether this specific car is affected in about a minute.\n\nNothing else on the record needs attention before the next service interval.',
  },
  {
    id: 'wrx-quote',
    vehicleId: WRX,
    question: 'A shop quoted $1,200 for a clutch. Is that reasonable?',
    answer:
      'For a WRX clutch replacement, $900–$1,600 is the usual range at an independent shop, so $1,200 sits in the middle of it rather than at either end. The spread is mostly labour: the gearbox has to come out, and shop rates vary more than parts prices do.\n\nTwo things change the answer. Whether the quote includes the flywheel — resurfacing or replacing it is normal at the same time, and a quote that omits it is often the cheaper-looking one — and whether the clutch is an OEM part or an uprated aftermarket one, which is a different job with a different feel afterwards.\n\nAsk for the quote itemised. A shop that will not split parts from labour is telling you something.',
  },
  {
    id: 'm3-schedule',
    vehicleId: M3,
    question: 'What does this car cost to run?',
    answer:
      'At 67,400 miles an M3 Competition is past the cheap years. The recurring costs that dominate are tyres, brakes and fluids: a staggered set of performance tyres is $1,200–$1,800 and lasts 12,000–20,000 miles depending on how it is driven, and brakes are $800–$2,000 a pair of axles depending on whether the discs go with the pads.\n\nThe S55 engine\'s known items are the charge pipe, which is a plastic part that splits under boost and is a common preventative upgrade, and crank hub movement, which is rarer, expensive, and mostly discussed in the context of tuned cars.\n\nBudgeting $2,500–$4,000 a year in maintenance for a car driven regularly is realistic. A year with a set of tyres and a brake job is the top of that.',
  },
  {
    id: 'm3-mods',
    vehicleId: M3,
    question: 'What should I do first if I want more power?',
    answer:
      'On a stock S55, the first change most owners make is the charge pipe — not for power, but because the plastic original is a known failure point and any increase in boost makes it likelier. It is inexpensive and it is the thing that strands the car.\n\nAfter that the ordinary first step is a tune, which is where the power actually comes from on a turbocharged engine, and an intake and downpipes if the tune is written for them. The order matters: hardware without a tune to match it usually gives less than either alone.\n\nA tune voids the powertrain warranty and is detectable. That is not an argument against it, but it is a fact worth having before rather than after.',
  },
] as const;

/**
 * What the demo says when it is asked something it does not hold.
 *
 * ⚠ It names the limit rather than apologising for it. "I could not find an
 * answer" reads as a failure and invites a retry; "the demo answers these
 * questions" is a true statement about a sample, and the questions are on
 * screen beside it.
 */
export const DEMO_UNANSWERED =
  'The demo answers a fixed set of questions about these three cars, written in advance. Subscribe to ask anything about your own.';

/** The questions the demo offers for one vehicle, in the order they are shown. */
export function demoQuestionsFor(vehicleId: string): DemoAnswer[] {
  return DEMO_ANSWERS.filter((entry) => entry.vehicleId === vehicleId);
}

/** Normalised so trailing punctuation and casing do not decide a match. */
function normalise(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
}

/**
 * The sample answer for a question, or `null` when it is not one we hold.
 *
 * ⚠ `null` is the important return. The caller must say the demo does not
 * answer that rather than reaching for the nearest thing it has — see the
 * header. A demo that guesses is a product that guesses.
 */
export function demoAnswerFor(vehicleId: string, question: string): DemoAnswer | null {
  const asked = normalise(question);
  return (
    demoQuestionsFor(vehicleId).find((entry) => normalise(entry.question) === asked) ?? null
  );
}
