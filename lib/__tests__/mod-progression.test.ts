/**
 * The next rungs of a build, rather than the whole catalogue.
 *
 * @jest-environment node
 *
 * The fixtures below are the **real `common_mods` of the four cars in the
 * product**, read off the live database on 7 Aug 2026. That matters more here
 * than in most suites: the value of this module is an ordering judgement, and a
 * judgement tested only against invented inputs is a judgement nobody has
 * checked. If the ordering reads wrong on a real car, it is wrong.
 */

import {
  buildStage,
  classifyMod,
  nextRungs,
  progressionSummary,
  showsModifications,
} from '@crewchief/core/mod-progression';

/** 2018 Honda Accord Sport 1.5T — `mild`. */
const ACCORD = [
  { name: 'K&N Drop-in Air Filter', difficulty: 'Easy', purpose: 'Modest airflow improvement, reusable' },
  { name: 'Exhaust Tip Upgrade', difficulty: 'Easy', purpose: 'Cosmetic enhancement' },
  { name: 'Lowering Springs', difficulty: 'Moderate', purpose: 'Handling improvement, lower stance' },
];

/** 2019 BMW M3 Competition — `aggressive`. */
const M3 = [
  { name: 'Burger Motorsports JB4 Tune', difficulty: 'Easy', purpose: 'Safe +60 WHP on stock hardware, piggyback' },
  { name: 'Eventuri Carbon Intake', difficulty: 'Easy', purpose: 'Significant airflow improvement + aggressive sound' },
  { name: 'Eisenmann Race Exhaust', difficulty: 'Moderate', purpose: 'Valved exhaust, full M sound at WOT' },
  { name: 'AP Racing Big Brake Kit (BBK)', difficulty: 'Hard', purpose: 'Required for serious track use at this power' },
];

/** 2020 Subaru WRX — `aggressive`. */
const WRX = [
  { name: 'COBB Accessport Stage 1 Tune', difficulty: 'Easy', purpose: '+40 WHP on stock airbox, best bang/buck' },
  { name: 'Grimmspeed Downpipe', difficulty: 'Moderate', purpose: 'Reduces exhaust backpressure, needed for Stage 2' },
  { name: 'STI Brembo Big Brake Kit', difficulty: 'Moderate', purpose: 'Significant brake upgrade for track use' },
  { name: 'Whiteline Sway Bars (F+R)', difficulty: 'Moderate', purpose: 'Reduces body roll, improves corner exit' },
  { name: 'ARP Rod Bolts', difficulty: 'Hard', purpose: 'Insurance against rod bearing failure under boost' },
];

describe('classifyMod, on the real parts', () => {
  it.each([
    ['COBB Accessport Stage 1 Tune', WRX[0], 'foundation'],
    ['Grimmspeed Downpipe', WRX[1], 'enabling'],
    ['STI Brembo Big Brake Kit', WRX[2], 'control'],
    ['Whiteline Sway Bars', WRX[3], 'control'],
    ['ARP Rod Bolts', WRX[4], 'durability'],
    ['Exhaust Tip Upgrade', ACCORD[1], 'cosmetic'],
    ['Lowering Springs', ACCORD[2], 'control'],
  ])('reads %s as %s', (_label, mod, role) => {
    expect(classifyMod(mod)).toBe(role);
  });

  it('does not read a brake kit as power because its purpose mentions power', () => {
    /*
      The M3's BBK says "Required for serious track use at this power". Both
      "power" and "required for" appear in it, so a naive match order would
      classify the car's brakes as foundation or enabling — and the one piece
      of advice this module exists to give is that brakes come *before* more
      power. Control is matched first for exactly this.
    */
    expect(classifyMod(M3[3])).toBe('control');
  });

  it('keeps a part it does not recognise rather than dropping it', () => {
    // An unusual part on an unusual build is the case this feature is for.
    expect(classifyMod({ name: 'Bespoke Titanium Whatsit' })).toBe('foundation');
  });
});

describe('nextRungs — a handful, not the catalogue', () => {
  it('returns three by default even when more exist', () => {
    expect(nextRungs({ mods: WRX, mindedness: 'aggressive' })).toHaveLength(3);
  });

  it('opens the WRX on the tune, then the chassis', () => {
    // The real ordering judgement, on a real car. Stage 1 first — best gain per
    // pound and nothing has to precede it — then control before the downpipe,
    // which is the step that only exists to unlock more power.
    const names = nextRungs({ mods: WRX, mindedness: 'aggressive' }).map((r) => r.name);

    expect(names[0]).toBe('COBB Accessport Stage 1 Tune');
    expect(names.slice(1)).toEqual(
      expect.arrayContaining(['STI Brembo Big Brake Kit', 'Whiteline Sway Bars (F+R)'])
    );
    expect(names).not.toContain('Grimmspeed Downpipe');
  });

  it('advances as the build advances', () => {
    // The property that makes this a progression rather than a sorted list.
    const first = nextRungs({ mods: WRX, mindedness: 'aggressive' }).map((r) => r.name);

    const later = nextRungs({
      mods: WRX,
      mindedness: 'aggressive',
      completed: ['COBB Accessport Stage 1 Tune', 'STI Brembo Big Brake Kit', 'Whiteline Sway Bars (F+R)'],
    }).map((r) => r.name);

    expect(later).not.toEqual(first);
    expect(later).toEqual(['Grimmspeed Downpipe', 'ARP Rod Bolts']);
  });

  it('never re-suggests something already done', () => {
    const rungs = nextRungs({
      mods: WRX,
      mindedness: 'aggressive',
      completed: ['cobb accessport stage 1 tune'], // case and spacing are the owner's
    });

    expect(rungs.map((r) => r.name)).not.toContain('COBB Accessport Stage 1 Tune');
  });

  it('puts the cosmetic mod last on the Accord, behind the real ones', () => {
    const names = nextRungs({ mods: ACCORD, mindedness: 'mild' }).map((r) => r.name);

    expect(names).toEqual([
      'K&N Drop-in Air Filter',
      'Lowering Springs',
      'Exhaust Tip Upgrade',
    ]);
  });

  describe('what the owner said they wanted', () => {
    it('paces the enabling path for a mild owner rather than hiding it', () => {
      // Was `.not.toContain`. A downpipe is not an improvement on its own, so
      // it sorts late — but "never" was an end state, and a build has no end.
      const names = nextRungs({ mods: WRX, mindedness: 'mild', limit: 99 }).map((r) => r.name);

      expect(names).toContain('Grimmspeed Downpipe');
      expect(names).toContain('COBB Accessport Stage 1 Tune');
    });

    it('shows it to an aggressive owner', () => {
      const names = nextRungs({ mods: WRX, mindedness: 'aggressive', limit: 99 }).map((r) => r.name);

      expect(names).toContain('Grimmspeed Downpipe');
    });

    it('returns nothing for a stock owner', () => {
      // The surface is hidden entirely by VehicleInsights, but a module that
      // answers anyway is one a future caller can misuse.
      expect(nextRungs({ mods: WRX, mindedness: 'stock' })).toEqual([]);
    });
  });

  it('survives a car with no mods on record', () => {
    expect(nextRungs({ mods: [], mindedness: 'aggressive' })).toEqual([]);
  });
});

describe('buildStage', () => {
  it('reads an empty history as unstarted, which is every car today', () => {
    // `modification_tracking` is empty across the product — verified 7 Aug.
    expect(buildStage([])).toBe('unstarted');
  });

  it.each([
    [['a'], 'started'],
    [['a', 'b'], 'started'],
    [['a', 'b', 'c'], 'underway'],
  ])('reads %j as %s', (completed, expected) => {
    expect(buildStage(completed)).toBe(expected);
  });
});

describe('progressionSummary', () => {
  it('frames a cold start as first steps rather than as a gap', () => {
    const rungs = nextRungs({ mods: WRX, mindedness: 'aggressive' });

    expect(progressionSummary(rungs, [])).toBe('3 sensible first steps for this car.');
  });

  it('counts what has been done once there is a build', () => {
    const rungs = nextRungs({ mods: WRX, mindedness: 'aggressive', completed: ['COBB Accessport Stage 1 Tune'] });

    expect(progressionSummary(rungs, ['COBB Accessport Stage 1 Tune'])).toMatch(/^1 done\./);
  });

  it('says so plainly when the ladder is finished', () => {
    expect(progressionSummary([], ['a', 'b'])).toContain('covered the usual ground');
  });

  it('does not claim a finished build when the car simply has no mods listed', () => {
    expect(progressionSummary([], [])).toBe('No modifications on record for this car yet.');
  });
});

/**
 * There is no ceiling, because a build has no end.
 *
 * `getModsForEarnedTier` filtered on `getModTier(difficulty) === earned_tier`,
 * exactly rather than up to. Measured live 7 Aug: every car sat at
 * `earned_tier: 'mild'` bar one, so the WRX owner — who answered "track-ready,
 * high-performance builds" — was shown **one modification out of five**, with
 * the only exit being a table that is empty across the entire product.
 *
 * The first fix replaced that with a ceiling from `performance_mindedness`.
 * David, 7 Aug: *"I don't like the idea of end states anymore. It's a
 * continuum. There's almost always something more you can do."* So the ceiling
 * went too. Nothing is withheld; `mindedness` paces what surfaces first.
 */
describe('showsModifications', () => {
  it.each([['mild'], ['aggressive'], ['moderate'], [null], [undefined], ['']])(
    'shows the surface for %p',
    (value) => {
      // Everything except an explicit "not now" gets the ladder.
      expect(showsModifications(value as string)).toBe(true);
    }
  );

  it('is the one genuine off switch', () => {
    expect(showsModifications('stock')).toBe(false);
  });
});

describe('pacing, not gating', () => {
  it('still reaches the enabling path for a mild owner', () => {
    /*
      This used to be a `filter` that removed `enabling` outright for a mild
      owner — an end state decided from one onboarding answer. A downpipe now
      sorts behind everything that improves the car they already have, and is
      reachable rather than absent.
    */
    const names = nextRungs({ mods: WRX, mindedness: 'mild', limit: 99 }).map((r) => r.name);

    expect(names).toContain('Grimmspeed Downpipe');
  });

  it('sinks the enabling part behind cosmetics for a mild owner, and not for a keen one', () => {
    /*
      The WRX cannot show this on its own: it has no cosmetic part, so
      `enabling` and `durability` are already last and adding a constant to both
      preserves the order. The difference needs something for them to sink
      *behind*, which is what this fixture supplies.

      That is worth stating rather than fixing by picking a different car — a
      pacing rule whose effect is invisible on four of the five real vehicles is
      a weak rule, and the next person should know its reach.
    */
    const mixed = [
      { name: 'Grimmspeed Downpipe', difficulty: 'Moderate', purpose: 'needed for Stage 2' },
      { name: 'Exhaust Tip Upgrade', difficulty: 'Easy', purpose: 'Cosmetic enhancement' },
    ];

    const mild = nextRungs({ mods: mixed, mindedness: 'mild', limit: 99 }).map((r) => r.name);
    const keen = nextRungs({ mods: mixed, mindedness: 'aggressive', limit: 99 }).map((r) => r.name);

    expect(mild).toEqual(['Exhaust Tip Upgrade', 'Grimmspeed Downpipe']);
    expect(keen).toEqual(['Grimmspeed Downpipe', 'Exhaust Tip Upgrade']);
  });

  it('does not change what a mild owner sees first', () => {
    // Pacing must not disturb the top of the ladder — the point is still that
    // the cheap, prerequisite-free gain comes first.
    expect(nextRungs({ mods: WRX, mindedness: 'mild' })[0].name).toBe(
      'COBB Accessport Stage 1 Tune'
    );
  });
});
