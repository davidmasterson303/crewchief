import { StyleSheet, Text } from 'react-native';

/**
 * Contrast measured on a **rendered** screen, not on a colour literal.
 *
 * ── What the source scan cannot see ─────────────────────────────────────────
 *
 * `lib/__tests__/mobile-text-contrast.test.ts` reads every `color:
 * 'rgba(255,255,255,α)'` out of the StyleSheets and checks α against the AA
 * floor. That found nine sub-floor styles and was worth writing, but it is a
 * proxy in three ways it cannot fix:
 *
 *   - **A colour that is not a literal is invisible to it.** `healthBandHex()`
 *     returns one, and any conditional or prop-driven style produces one. The
 *     scan sees a function call.
 *   - **It cannot know what is actually behind the text.** It assumes the
 *     screen background. A card, an inset panel or the white advisor CTA is a
 *     different backdrop, and the same colour passes on one and fails on
 *     another.
 *   - **It cannot know which styles are applied together.** React Native
 *     merges arrays and later entries win; the scan reads each declaration in
 *     isolation.
 *
 * This walks the tree a screen actually produced, flattens each `Text`'s style
 * the way the platform does, and measures the result.
 *
 * ── Why the scan is kept as well ────────────────────────────────────────────
 *
 * It runs on every `npm test` from the repo root and covers **every** style in
 * the app, including ones on screens no render test mounts. This covers fewer
 * styles, far more truthfully. Neither is a superset of the other.
 */

/** Every CrewChief screen renders on this. */
export const SCREEN_BACKGROUND = '#080808';

/** WCAG 2.1 AA. Large text — 18pt, or 14pt bold — may use 3:1. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

type RGB = [number, number, number];

/** `#rgb`, `#rrggbb`, `rgb()` and `rgba()` — the forms this app actually uses. */
export function parseColor(input: string): { rgb: RGB; alpha: number } | null {
  const value = input.trim();

  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1];

    return {
      rgb: [
        parseInt(digits.slice(0, 2), 16),
        parseInt(digits.slice(2, 4), 16),
        parseInt(digits.slice(4, 6), 16),
      ],
      alpha: 1,
    };
  }

  return null;
}

/** Lay `foreground` over `background`, honouring the foreground's alpha. */
function composite(foreground: { rgb: RGB; alpha: number }, background: RGB): RGB {
  return background.map((b, i) =>
    foreground.alpha * foreground.rgb[i] + (1 - foreground.alpha) * b
  ) as RGB;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;

  // A translucent backdrop over an unknown parent is not something this can
  // resolve honestly, so it composites the backdrop onto the screen first.
  const backdrop = composite(bg, parseColor(SCREEN_BACKGROUND)!.rgb);
  const text = luminance(composite(fg, backdrop));
  const behind = luminance(backdrop);

  const [lighter, darker] = text > behind ? [text, behind] : [behind, text];
  return (lighter + 0.05) / (darker + 0.05);
}

export interface TextAudit {
  text: string;
  color: string;
  fontSize: number;
  bold: boolean;
  required: number;
  ratio: number;
}

/** A node of the rendered host tree, as `toJSON()` produces it. */
interface HostNode {
  type?: string;
  props?: Record<string, unknown>;
  children?: (HostNode | string)[] | null;
}

/**
 * Depth-first, carrying the backdrop down.
 *
 * ── Why the backdrop has to be derived, not passed ──────────────────────────
 *
 * A screen is not one surface. The vehicle detail screen puts near-black text
 * on a **white** advisor button, two feet from white text on a translucent
 * card. Auditing the whole screen against one colour reported that button as
 * 1.09:1 — a catastrophic failure that is actually the best contrast on the
 * screen, measured against the wrong thing.
 *
 * So each `View` that declares a `backgroundColor` composites onto whatever it
 * sits on, and `Text` is measured against the surface it truly lands on.
 */
function walk(
  node: HostNode | string | null | undefined,
  backdrop: RGB,
  found: { node: HostNode; backdrop: RGB }[] = []
): { node: HostNode; backdrop: RGB }[] {
  if (!node || typeof node === 'string') return found;

  let surface = backdrop;

  const style = StyleSheet.flatten(node.props?.style as never) as
    | { backgroundColor?: string }
    | undefined;

  if (typeof style?.backgroundColor === 'string') {
    const parsed = parseColor(style.backgroundColor);
    // A translucent panel over its own parent, not over the screen — which is
    // how a card on a card ends up lighter than either.
    if (parsed) surface = composite(parsed, backdrop);
  }

  if (node.type === 'Text') found.push({ node, backdrop: surface });
  for (const child of node.children ?? []) walk(child, surface, found);

  return found;
}

/** The string content directly under a node, ignoring nested elements. */
function ownText(node: HostNode): string {
  return (node.children ?? [])
    .filter((child): child is string => typeof child === 'string')
    .join('');
}

/**
 * Every `Text` a screen rendered, with the contrast it actually achieves
 * against the surface it actually sits on.
 *
 * Walks `toJSON()` — the **host tree**, after React has resolved every
 * component, conditional and style array. That is the difference from reading
 * a StyleSheet: this is what the platform was handed, not what the source
 * declared.
 */
export function auditText(
  view: { toJSON: () => unknown },
  rootBackground: string = SCREEN_BACKGROUND
): TextAudit[] {
  const tree = view.toJSON() as HostNode | HostNode[] | null;
  const roots = Array.isArray(tree) ? tree : [tree];
  const base = parseColor(rootBackground)!.rgb;

  return roots
    .flatMap((root) => walk(root, base))
    .map(({ node, backdrop }) => {
      const style = StyleSheet.flatten(node.props?.style as never) as
        | { color?: string; fontSize?: number; fontWeight?: string }
        | undefined;

      const color = style?.color;

      /*
        Nested runs — the advisor's bold spans — inherit their parent's colour
        and declare none of their own. Skipped rather than guessed at: the
        parent is audited and carries the colour that actually applies.
      */
      if (typeof color !== 'string') return null;

      const parsed = parseColor(color);
      if (!parsed) return null;

      const text = luminance(composite(parsed, backdrop));
      const behind = luminance(backdrop);
      const [lighter, darker] = text > behind ? [text, behind] : [behind, text];
      const ratio = (lighter + 0.05) / (darker + 0.05);

      const fontSize = style?.fontSize ?? 14;
      const weight = style?.fontWeight;
      const bold = weight === 'bold' || Number(weight ?? 400) >= 700;

      return {
        text: ownText(node),
        color,
        fontSize,
        bold,
        required: fontSize >= 18 || (fontSize >= 14 && bold) ? AA_LARGE : AA_NORMAL,
        ratio,
      };
    })
    .filter((audit): audit is TextAudit => audit !== null);
}

/** The audits that fail their own requirement, formatted for an assertion. */
export function belowFloor(audits: TextAudit[]): string[] {
  return audits
    .filter((audit) => audit.ratio < audit.required)
    .map(
      (audit) =>
        `"${audit.text || '(no text)'}" ${audit.color} @${audit.fontSize}pt = ${audit.ratio.toFixed(2)}:1 (needs ${audit.required})`
    );
}
