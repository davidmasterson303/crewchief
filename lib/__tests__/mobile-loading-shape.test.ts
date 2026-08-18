/**
 * `$rules.loadingShape` — a first load is shaped like its content.
 *
 * @jest-environment node
 *
 * ── The rule, in the baseline's own words ───────────────────────────────────
 *
 * *"Shaped like the content that is coming, not a centred spinner. A blank
 * second on a cold fetch is indistinguishable from broken — and the fetching
 * screens are the ones a reviewer opens first."*
 *
 * `Skeleton` was built for this on 14 August and then adopted by **two** of
 * eight fetching screens. The other six opened as a dot in the middle of an
 * empty field, including vehicle detail — the densest screen in the app and the
 * one a recall notification opens. Found by an external design audit on 16 Aug,
 * not by anything here.
 *
 * ── Why the rule is the *early return*, not the spinner ─────────────────────
 *
 * "No `ActivityIndicator` in a screen" is the rule someone means and it is
 * wrong: a spinner is right for a **job running** — `Button`'s busy state, the
 * invoice scan reading an upload — where there is no shape to promise because
 * nothing is arriving into one.
 *
 * What is decidable, and what the baseline is actually about, is the **initial
 * load**: a `state.kind === 'loading'` early return knows exactly what it is
 * about to render and should stand in for it. That branch is what this checks.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { surface, radius } from '../../apps/mobile/src/theme';

const SCREENS = join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'screens');

function screenFiles(): string[] {
  return readdirSync(SCREENS).filter((f) => f.endsWith('.tsx'));
}

/**
 * The body of an `if (state.kind === 'loading') { … }` early return.
 *
 * Crude on purpose — it takes everything to the closing brace at the same
 * indent. Over-reading can only make this scan *more* likely to spot a spinner
 * and complain; it cannot hide one. A parser that errs toward false positives
 * gets fixed; the other kind gets trusted.
 */
function loadingBranches(source: string): string[] {
  const found: string[] = [];
  const opener = /if \(state\.\w+ === 'loading'\) \{/g;

  let match: RegExpExecArray | null = opener.exec(source);
  while (match !== null) {
    const start = match.index;
    const end = source.indexOf('\n  }', start);
    found.push(source.slice(start, end === -1 ? source.length : end));
    match = opener.exec(source);
  }

  return found;
}

describe('a screen’s first load stands in for its content', () => {
  const screens = screenFiles().map((name) => ({
    name,
    code: readFileSync(join(SCREENS, name), 'utf8'),
  }));

  it('finds loading branches at all, so this cannot pass vacuously', () => {
    const withBranches = screens.filter((s) => loadingBranches(s.code).length > 0);

    // Six screens gained one on 16 Aug; the garage and advisor already had
    // skeletons by another route. A count near zero means the matcher broke.
    expect(withBranches.length).toBeGreaterThan(3);
  });

  it('has no first load that is a bare spinner', () => {
    const offenders = screens.flatMap(({ name, code }) =>
      loadingBranches(code)
        .filter((branch) => branch.includes('<ActivityIndicator'))
        .map(() => name)
    );

    expect(offenders).toEqual([]);
  });

  it('reaches for the primitive rather than a private placeholder', () => {
    const offenders = screens
      .filter(({ code }) => loadingBranches(code).length > 0)
      .filter(({ code }) => !/from '\.\.\/components\/Skeleton'/.test(code))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  it('has a primitive for those shapes to be made of', () => {
    /*
      The other half, and the half a scanner cannot state: an app with no
      spinners and no skeleton is not compliant, it is blank. `SkeletonCard`
      mirrors `Card`'s own surface and radius deliberately — a placeholder whose
      shape does not match what replaces it produces the jump it exists to
      prevent.
    */
    expect(surface.card).toMatch(/^#[0-9A-F]{6}$/i);
    expect(radius.card).toBe(14);
  });

  it('can still detect one, so this is not vacuous', () => {
    const bare = `if (state.kind === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={text.muted} />
      </View>
    );
  }`;

    expect(loadingBranches(bare)).toHaveLength(1);
    expect(loadingBranches(bare)[0]).toContain('<ActivityIndicator');

    const shaped = `if (state.kind === 'loading') {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <SkeletonCard lines={2} />
      </ScrollView>
    );
  }`;

    expect(loadingBranches(shaped)[0]).not.toContain('<ActivityIndicator');
  });
});
