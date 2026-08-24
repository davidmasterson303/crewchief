import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';

import { text } from '../theme';

/**
 * Lucide geometry, inlined.
 *
 * ── Why the paths are here and `lucide-react-native` is not ─────────────────
 *
 * The design system's rule is *"real Lucide icons only · no emoji, no glyph
 * stand-ins"*, and its own `components/icons/Icon.jsx` solves it the same way:
 * inlined path data, *"so this design system needs no CDN script and no npm
 * dependency."*
 *
 * ⚠ **The path data is copied from that map, unaltered.** Its prompt is
 * explicit and worth repeating here because it is the rule that keeps this
 * faithful: *"Copy the path data from the real `lucide-react` source for the
 * icon of the same name… Do not redraw or approximate — the geometry must match
 * Lucide exactly."* An icon that is nearly a Lucide icon is the drift nobody
 * can name and everybody can see.
 *
 * The export's own readme says not to ship code from it. This is not its code —
 * it is Lucide's geometry, which that file is itself a copy of, re-expressed in
 * `react-native-svg` primitives because RN has no DOM SVG.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * `Chevron.tsx`, which carried one path and a comment predicting this file:
 * *"When a second icon is needed, this file becomes `Icon.tsx` with a path
 * map — it is not a special case, it is the first entry."* The second icon was
 * needed on 23 Aug, when the vehicle hub's rows turned out to be unreadable
 * without them.
 *
 * ── Icons never carry meaning alone ─────────────────────────────────────────
 *
 * Every one is hidden from the accessibility tree. A row's name comes from its
 * `accessibilityLabel`, and an icon announced beside it is a second thing to
 * move past for no information. That is the export's rule too, and it is the
 * reason `Icon` takes no `accessibilityLabel` prop: there is no correct value
 * for one.
 */

/**
 * ⚠ Sizes are the export's guidance, not free choice: 14–16 inline, 18–20 for
 * an action, 24+ for a feature mark. At 24 and above drop `strokeWidth` to 1.75
 * so the line stays optically even against text.
 */
export type IconName =
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'wrench'
  | 'heart'
  | 'clock'
  | 'file-text'
  | 'gauge'
  | 'sliders'
  | 'search'
  | 'plus'
  | 'check'
  | 'x'
  | 'shield-alert'
  | 'triangle-alert'
  | 'circle-check'
  | 'sparkles'
  | 'car'
  | 'message-square'
  | 'info';

type Element =
  | { tag: 'path'; d: string }
  | { tag: 'circle'; cx: number; cy: number; r: number }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number }
  | { tag: 'polyline'; points: string };

const ICONS: Record<IconName, Element[]> = {
  'chevron-right': [{ tag: 'path', d: 'm9 18 6-6-6-6' }],
  'chevron-left': [{ tag: 'path', d: 'm15 18-6-6 6-6' }],
  /* Lucide's own geometry, rotated the way Lucide rotates them. */
  'chevron-down': [{ tag: 'path', d: 'm6 9 6 6 6-6' }],
  'chevron-up': [{ tag: 'path', d: 'm18 15-6-6-6 6' }],
  wrench: [
    {
      tag: 'path',
      d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    },
  ],
  /*
    ⚠ Not in the export's map — taken from `lucide-react`'s `heart` directly,
    under the rule that says to do exactly that when a name is missing. The
    wishlist spec's row icon is a heart.
  */
  heart: [
    {
      tag: 'path',
      d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
    },
  ],
  clock: [
    { tag: 'circle', cx: 12, cy: 12, r: 10 },
    { tag: 'polyline', points: '12 6 12 12 16 14' },
  ],
  'file-text': [
    { tag: 'path', d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' },
    { tag: 'path', d: 'M14 2v4a2 2 0 0 0 2 2h4' },
    { tag: 'path', d: 'M10 9H8M16 13H8M16 17H8' },
  ],
  gauge: [
    { tag: 'path', d: 'm12 14 4-4' },
    { tag: 'path', d: 'M3.34 19a10 10 0 1 1 17.32 0' },
  ],
  /* `sliders-horizontal`, shortened at the call site's name. Same geometry. */
  sliders: [
    { tag: 'path', d: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3' },
    { tag: 'path', d: 'M14 2v4M8 10v4M16 18v4' },
  ],
  search: [
    { tag: 'circle', cx: 11, cy: 11, r: 8 },
    { tag: 'path', d: 'm21 21-4.3-4.3' },
  ],
  plus: [{ tag: 'path', d: 'M5 12h14M12 5v14' }],
  check: [{ tag: 'path', d: 'M20 6 9 17l-5-5' }],
  x: [{ tag: 'path', d: 'M18 6 6 18M6 6l12 12' }],
  'shield-alert': [
    {
      tag: 'path',
      d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    },
    { tag: 'path', d: 'M12 8v4' },
    { tag: 'path', d: 'M12 16h.01' },
  ],
  'triangle-alert': [
    {
      tag: 'path',
      d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    },
    { tag: 'path', d: 'M12 9v4' },
    { tag: 'path', d: 'M12 17h.01' },
  ],
  'circle-check': [
    { tag: 'circle', cx: 12, cy: 12, r: 10 },
    { tag: 'path', d: 'm9 12 2 2 4-4' },
  ],
  sparkles: [
    {
      tag: 'path',
      d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
    },
  ],
  car: [
    {
      tag: 'path',
      d: 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2',
    },
    { tag: 'circle', cx: 7, cy: 17, r: 2 },
    { tag: 'path', d: 'M9 17h6' },
    { tag: 'circle', cx: 17, cy: 17, r: 2 },
  ],
  'message-square': [
    { tag: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  ],
  info: [
    { tag: 'circle', cx: 12, cy: 12, r: 10 },
    { tag: 'path', d: 'M12 16v-4' },
    { tag: 'path', d: 'M12 8h.01' },
  ],
};

export default function Icon({
  name,
  size = 16,
  color = text.muted,
  strokeWidth,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Defaults to 2, dropping to 1.75 at 24+ so the line stays optically even. */
  strokeWidth?: number;
}) {
  const stroke = strokeWidth ?? (size >= 24 ? 1.75 : 2);

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      /*
        Hidden from the tree, always. An icon never carries meaning alone — the
        row it sits in is named, and announcing the glyph too is one more stop
        on the way past for no information.
      */
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {ICONS[name].map((element, index) => {
        /*
          ⚠ `key` is passed explicitly below, never through this spread. React
          19 warns — "a props object containing a `key` prop is being spread
          into JSX" — and it is right to: a spread `key` is not read as a key,
          so the whole icon silently loses its reconciliation identity. It was
          on screen in the 23 Aug device build.
        */
        const common = {
          stroke: color,
          strokeWidth: stroke,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          fill: 'none',
        };

        if (element.tag === 'circle') {
          return <Circle key={index} {...common} cx={element.cx} cy={element.cy} r={element.r} />;
        }
        if (element.tag === 'rect') {
          return (
            <Rect
              key={index}
              {...common}
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              rx={element.rx}
            />
          );
        }
        if (element.tag === 'polyline') {
          return <Polyline key={index} {...common} points={element.points} />;
        }
        return <Path key={index} {...common} d={element.d} />;
      })}
    </Svg>
  );
}

/** Exported so a guard can assert the map is not silently empty. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
