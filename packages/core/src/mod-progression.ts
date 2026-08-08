/**
 * The next rungs of a build, rather than the whole catalogue.
 *
 * David, 7 Aug 2026: *"we don't have to show 100% of the available mods for the
 * car, just an assortment of next logical progression kind of thing."*
 *
 * ── Why a progression is a different product from a list ────────────────────
 *
 * Maintenance is episodic — something is due, you deal with it, the app has
 * nothing to say for four months. A build is not. It has a next step, and the
 * next step depends on what you have already done, which is a reason to open
 * the app that a catalogue does not provide.
 *
 * ── Why this is not `COMMON_INTERVALS` wearing a different hat ──────────────
 *
 * `service-due.ts` rejects a hardcoded table because "oil every 5,000 miles"
 * is a claim about *a specific car* that a generic table cannot make. The
 * distinction here is exact and worth stating: **the mods come from the
 * vehicle's own knowledge base** — "Grimmspeed Downpipe", "Burger Motorsports
 * JB4", "AP Racing Big Brake Kit" — and this module supplies only the *ordering
 * principle*, which is general engineering practice rather than a per-car fact.
 *
 * Brakes before more power is true of every car. Which brake kit is not, and
 * this file does not say.
 *
 * ── The ordering principle, which is the actual product ─────────────────────
 *
 * A list sorted by difficulty is a list. The value is in the rule:
 *
 *   1. **Foundation** — power that needs nothing else first. Best gain per pound.
 *   2. **Control before more power.** Brakes, suspension, tyres. The one piece of
 *      sequencing advice with a consequence attached, and the one a shop will
 *      not volunteer while selling a tune.
 *   3. **Enabling** — what has to exist before the next power step does.
 *   4. **Durability** — insurance, and it scales with how far the build has gone.
 *   5. **Cosmetic** — last, always. It competes with nothing.
 *
 * ── Cold start is the normal case, not an edge case ─────────────────────────
 *
 * `modification_tracking` is **empty across the entire product** — verified
 * 7 Aug. Nobody has recorded a completed mod, so a ladder that only works once
 * someone has logged history would show nothing to everyone. Foundation rungs
 * come first when nothing is known, which is also the honest answer: with no
 * history, the first step is the first step.
 */

export type ModRole = 'foundation' | 'enabling' | 'control' | 'durability' | 'cosmetic';

/** The difficulty tiers `getModTier` derives from `common_mods[].difficulty`. */
export type ModTier = 'mild' | 'moderate' | 'aggressive';

/**
 * Is there anything to show this owner at all?
 *
 * ── There is no ceiling, because a build has no end ─────────────────────────
 *
 * This was `tierCeiling`, and it stopped a `mild` owner at `moderate` on the
 * reading that "tasteful improvements, nothing crazy" described where they
 * would finish. David, 7 Aug: *"I don't like the idea of end states anymore.
 * It's a continuum. There's almost always something more you can do."*
 *
 * He is right, and the ceiling was the wrong shape twice over. It hard-coded a
 * finish line nobody drew, and it made the onboarding answer a permanent verdict
 * on a question people change their mind about — the whole reason the tab gate
 * needs a way back.
 *
 * So nothing is withheld. `performance_mindedness` changes **what surfaces
 * first**, not what exists: see `ROLE_ORDER` and the pacing below. The handful
 * `nextRungs` returns is the pacing mechanism, and "show the rest" is always one
 * click away.
 *
 * `stock` is the one genuine off switch, and it is "not now" rather than
 * "never" — which is exactly why it owes the owner a way to turn it back on.
 */
export function showsModifications(mindedness: string | null | undefined): boolean {
  return mindedness !== 'stock';
}

export interface ModCandidate {
  name: string;
  purpose?: string;
  difficulty?: 'Easy' | 'Moderate' | 'Hard' | string;
}

export interface ModRung {
  name: string;
  purpose: string;
  difficulty: string;
  role: ModRole;
  /** Why this one is next, in the owner's terms. */
  rationale: string;
}

/**
 * What a mod is *for*, read from its own name and purpose.
 *
 * Keyword matching, in the shape `maintenance-sync.ts`'s `CATEGORY_KEYWORD_MAP`
 * already established for invoice lines. It is deliberately not an AI call:
 * this runs on every render of the screen, the inputs are a dozen short
 * strings, and a model asked to sort five items would be slower, costlier and
 * less repeatable than a rule that can be read and argued with.
 */
const ROLE_KEYWORDS: Array<{ role: ModRole; patterns: RegExp }> = [
  /*
    ⚠ Every noun here carries an optional plural, and that is not tidiness.
    `\bsway bar\b` does not match "Whiteline Sway Bars" — the trailing `s` is a
    word character, so the boundary fails. That silently classified the WRX's
    sway bars as `foundation`, which puts a handling part in the power tier and
    inverts the one rule this module exists to state. "ARP Rod Bolts" only
    landed correctly by luck, matching "Insurance" in its purpose rather than
    its own name.

    Add `s?` to any noun added later.

    Control first in the match order, because a big brake kit's purpose text
    routinely mentions power ("required for serious track use at this power")
    and would otherwise classify as foundation on the word alone.
  */
  {
    role: 'control',
    patterns:
      /\b(brakes?|bbk|calipers?|rotors?|suspension|coilovers?|springs?|sway ?bars?|anti-?roll|tyres?|tires?|wheels?|alignment|chassis|handling|body roll)\b/i,
  },
  {
    role: 'durability',
    patterns:
      /\b(rod bolts?|studs?|gaskets?|coolers?|oil cool|catch cans?|reliability|insurance|failure|charge pipes?|reinforce)\b/i,
  },
  {
    role: 'enabling',
    patterns:
      /\b(downpipes?|intercoolers?|fuel pumps?|injectors?|fuelling|fueling|turbos?|superchargers?|manifolds?|headers?|required for|needed for|supporting)\b/i,
  },
  {
    role: 'cosmetic',
    patterns: /\b(cosmetic|appearance|aesthetics?|tips?|badges?|trim|wrap|lighting|interior)\b/i,
  },
  {
    role: 'foundation',
    patterns: /\b(tunes?|ecu|accessport|piggyback|intakes?|filters?|exhausts?|cat-?back)\b/i,
  },
];

export function classifyMod(mod: ModCandidate): ModRole {
  const haystack = `${mod.name} ${mod.purpose ?? ''}`;

  for (const { role, patterns } of ROLE_KEYWORDS) {
    if (patterns.test(haystack)) return role;
  }

  /*
    Unmatched lands in `foundation` rather than being dropped. A mod this rule
    does not recognise is still a mod the owner's own knowledge base offered,
    and hiding it because a regex did not fire would silently shrink the list
    for the cars with the most unusual parts — precisely the enthusiast builds
    this feature is for.
  */
  return 'foundation';
}

/** Lower sorts earlier. The ordering principle, as data. */
const ROLE_ORDER: Record<ModRole, number> = {
  foundation: 0,
  control: 1,
  enabling: 2,
  durability: 3,
  cosmetic: 4,
};

const EFFORT_ORDER: Record<string, number> = { Easy: 0, Moderate: 1, Hard: 2 };


/**
 * How far a build has gone, from what has actually been completed.
 *
 * Deliberately coarse. With `modification_tracking` empty everywhere, any
 * finer reading would be inventing precision about data that does not exist.
 */
export function buildStage(completed: string[]): 'unstarted' | 'started' | 'underway' {
  if (completed.length === 0) return 'unstarted';
  return completed.length < 3 ? 'started' : 'underway';
}

function rationaleFor(role: ModRole, stage: ReturnType<typeof buildStage>): string {
  switch (role) {
    case 'foundation':
      return stage === 'unstarted'
        ? 'Start here — the most power per pound spent, and nothing else has to come first.'
        : 'Bolt-on gain that needs nothing else in place first.';
    case 'control':
      return 'Worth doing before more power, not after. Stopping and turning are what let you use what you have already added.';
    case 'enabling':
      return 'Unlocks the next power step. On its own the gain is small; without it, the step after cannot happen.';
    case 'durability':
      return 'Insurance rather than performance. It matters more the further the build goes.';
    case 'cosmetic':
      return 'Appearance only — no performance claim, so it competes with nothing on this list.';
  }
}

/**
 * The next rungs, in order.
 *
 * **Returns a handful, not the catalogue**, which is the whole point — a list
 * of everything is what this replaces.
 *
 * `mindedness` is now only ever *whether*, never *how much*. Onboarding asks a
 * yes/no since 7 Aug, because a level is an end state and the dial shows where
 * a car sits without anyone declaring where they mean to stop.
 *
 * There was a pacing rule here — `enabling` and `durability` sank behind
 * everything else for a `mild` owner. It went with the levels: with no levels
 * there is no level to pace by, and keeping it would have penalised every new
 * owner for answering the only question left. One order, for everyone.
 *
 * `stock` gets nothing, and callers should not be asking — `VehicleInsights`
 * hides the surface entirely, and `showsModifications` carries the rule.
 */
export function nextRungs(params: {
  mods: ModCandidate[];
  completed?: string[];
  mindedness?: string | null;
  limit?: number;
}): ModRung[] {
  const { mods, completed = [], mindedness, limit = 3 } = params;

  if (mindedness === 'stock') return [];

  const stage = buildStage(completed);
  const done = new Set(completed.map((name) => name.trim().toLowerCase()));

  const candidates = mods
    .filter((mod) => mod?.name && !done.has(mod.name.trim().toLowerCase()))
    .map((mod) => ({ mod, role: classifyMod(mod) }));

  return candidates
    .sort(
      (a, b) =>
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        (EFFORT_ORDER[a.mod.difficulty ?? 'Moderate'] ?? 1) -
          (EFFORT_ORDER[b.mod.difficulty ?? 'Moderate'] ?? 1) ||
        a.mod.name.localeCompare(b.mod.name)
    )
    .slice(0, limit)
    .map(({ mod, role }) => ({
      name: mod.name,
      purpose: mod.purpose ?? '',
      difficulty: mod.difficulty ?? 'Moderate',
      role,
      rationale: rationaleFor(role, stage),
    }));
}

/**
 * One line for the top of the section — what this build is doing next.
 *
 * Lives here so the screen and any future notification cannot describe the
 * same ladder differently, the same reason `milestoneReason` does.
 */
export function progressionSummary(rungs: ModRung[], completed: string[]): string {
  if (rungs.length === 0) {
    return completed.length > 0
      ? 'Nothing further suggested — this build has covered the usual ground.'
      : 'No modifications on record for this car yet.';
  }

  const stage = buildStage(completed);

  if (stage === 'unstarted') {
    return `${rungs.length} sensible first ${rungs.length === 1 ? 'step' : 'steps'} for this car.`;
  }

  return `${completed.length} done. Here ${rungs.length === 1 ? 'is' : 'are'} the next ${rungs.length}.`;
}
