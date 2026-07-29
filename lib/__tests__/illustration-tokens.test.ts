/**
 * Colour conformance for the vehicle illustration set.
 *
 * @jest-environment node
 *
 * A ratchet, in the same spirit as `internal-fetch-posture`: static analysis
 * over the source, with an allowlist that may only shrink. The review feedback
 * asks for a guard so literal colours "can't come back", and the reason they
 * must not is specific — these twelve shapes are the fallback that appears when
 * a user has no photo, so they render on every surface in the app. A hex here
 * survives a theme change and a hard-coded warm tint is exactly the drift this
 * set was accused of.
 *
 * The rules being enforced, all four from §4:
 *   1. No literal colour values at all — every fill and stroke via a token.
 *   2. No cyan: `--primary`, `--accent`, `--ring` are reserved for actions.
 *   3. No health-ramp tokens: `--ring-good|ok|warn|bad` mean a score.
 *   4. No semantic families: confirm/attention/critical mean status.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', '..', 'components', 'vehicle-illustrations');

/**
 * Tokens the illustrations may reference. Graphite surfaces plus the one
 * foreground grey, and nothing else.
 *
 * **This list may only shrink.** Adding to it is how the set stops being
 * graphite, so a new entry needs David's sign-off, not a passing build.
 */
const ALLOWED_TOKENS = [
  '--background',
  '--secondary',
  '--border',
  '--muted-foreground',
] as const;

/** Cyan, the health ramp, and the semantic families. */
const FORBIDDEN_TOKENS = [
  '--primary',
  '--accent',
  '--ring',
  '--ring-good',
  '--ring-ok',
  '--ring-warn',
  '--ring-bad',
  '--confirm-green',
  '--attention-amber',
  '--critical-red',
  '--destructive',
  '--info',
] as const;

function sources(): Array<{ file: string; text: string }> {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((file) => ({ file, text: readFileSync(join(DIR, file), 'utf8') }));
}

/**
 * Strip block and line comments before scanning.
 *
 * The components carry long design rationale that names forbidden colours on
 * purpose ("no cyan", "no health-ramp colours"). Scanning raw text would make
 * the guard fire on its own documentation, and the usual fix for that — deleting
 * the explanation — is the opposite of what we want.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no literal colour values', () => {
  const patterns: Array<[string, RegExp]> = [
    ['hex', /#[0-9a-fA-F]{3,8}\b/],
    ['rgb()/rgba()', /\brgba?\s*\(/],
    ['hsl() with a literal, not a var', /\bhsla?\s*\(\s*(?!var\()/],
    ['oklch()/lab()/lch()', /\b(?:oklch|oklab|lab|lch)\s*\(/],
    ['colour keyword as a prop value', /(?:fill|stroke)=["'](?!none|hsl\(var\()/],
  ];

  for (const { file, text } of sources()) {
    const body = code(text);
    for (const [label, re] of patterns) {
      it(`${file} contains no ${label}`, () => {
        const hit = re.exec(body);
        expect(hit ? `${file}: ${hit[0]}` : null).toBeNull();
      });
    }
  }
});

describe('only graphite tokens, and no reserved ones', () => {
  it('references nothing outside the allowlist', () => {
    const used = new Set<string>();
    for (const { text } of sources()) {
      const body = code(text);
      // exec loop rather than matchAll — see the note in illustration-grid.
      const re = /var\((--[a-z0-9-]+)/g;
      for (let m = re.exec(body); m; m = re.exec(body)) used.add(m[1]);
    }

    const unexpected = Array.from(used).filter(
      (t) => !(ALLOWED_TOKENS as readonly string[]).includes(t)
    );
    expect(unexpected).toEqual([]);
  });

  it('uses every token it claims to, so the allowlist cannot rot', () => {
    /*
      Without this, the allowlist could keep granting permission for tokens the
      set stopped using, and the guard would slowly stop meaning anything.
    */
    const all = sources()
      .map(({ text }) => code(text))
      .join('\n');
    for (const token of ALLOWED_TOKENS) {
      expect(all).toContain(`var(${token})`);
    }
  });

  it.each(FORBIDDEN_TOKENS)('never references %s', (token) => {
    for (const { file, text } of sources()) {
      // Word-boundary the token so --ring does not match --ring-good's prefix
      // and give a false pass on the specific ramp entries.
      const re = new RegExp(`var\\(${token}(?![a-z0-9-])`);
      expect({ file, hit: re.test(code(text)) }).toEqual({ file, hit: false });
    }
  });
});

describe('the tint prop stays a prop', () => {
  it('never hard-codes a paint colour as a default', () => {
    /*
      `tint` carries the user's vehicle colour and is muted by opacity at the
      point of use. A default value here would paint every car the same colour
      and defeat the "never looks like a photograph" rule.
    */
    for (const { file, text } of sources()) {
      expect({ file, hit: /tint\s*[=:]\s*['"`]/.test(code(text)) }).toEqual({
        file,
        hit: false,
      });
    }
  });

  it('applies the tint at low opacity rather than as a solid fill', () => {
    const frame = readFileSync(join(DIR, 'VehicleIllustration.tsx'), 'utf8');
    const opacity = /tint \? <path d=\{bodyPath\} fill=\{tint\} opacity=\{([\d.]+)\}/.exec(frame);
    expect(opacity).not.toBeNull();
    expect(Number(opacity![1])).toBeLessThanOrEqual(0.3);
  });
});
