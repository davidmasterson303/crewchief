import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { TARGET_MIN, border, brand, radius, space, status, surface, text, type } from '../theme';

export type ButtonVariant = 'primary' | 'quiet' | 'outline' | 'ghost' | 'delete';
export type ButtonSize = 'small' | 'large';

/**
 * The button primitive. Web got one in v8 §8a; this app did not.
 *
 * Five variants, four states each, two sizes — the board's "primitive set"
 * section in full. **States are not optional**: a variant without its pressed
 * and disabled treatment is where every one of this product's contrast defects
 * has come from, and the two worst were both disabled states.
 *
 * ── One filled primary per screen ───────────────────────────────────────────
 *
 * Every screen spec says it, and this is where the temptation lives. `primary`
 * is the screen's single verb; `quiet`, `outline` and `ghost` are the ladder
 * beneath it. Two filled primaries on one screen means neither is one.
 *
 * ── Pressed deepens; it never lightens ──────────────────────────────────────
 *
 * With near-white ink, lighter always means less contrast. The board's first
 * draft sent pressed *up* the ramp to `#0891B2` — 3.51:1, and the exact hex v8
 * removed at 3.68:1. Every variant here presses **down**, and
 * `theme-backdrop.test.tsx` pins the direction rather than any single value.
 *
 * ── Disabled is a fill swap, never a group opacity ──────────────────────────
 *
 * An `opacity` on the container composites everything beneath it, including ink
 * that was compliant at full strength. Not hypothetical: this app put a
 * near-black "Ask" label at **1.61:1** exactly that way, invisible to both
 * guards — the source scan saw no colour literal inside an opacity, and the
 * rendered suite did not composite parent alpha until 7 Aug.
 *
 * WCAG 1.4.3 exempts inactive controls, which is why `text.disabled` may sit
 * below the floor. A deliberate exemption, not an oversight.
 *
 * ── The accessible name survives the spinner ────────────────────────────────
 *
 * The `<Text>` naming a button is swapped for an `ActivityIndicator` while it
 * works, so a control named by its child goes anonymous at exactly the moment
 * it has something to say. Enforced repo-wide by
 * `lib/__tests__/mobile-busy-controls-named.test.ts`.
 */
export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  busy = false,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the spinner and blocks presses. The label stays the accessible name. */
  busy?: boolean;
  disabled?: boolean;
  /**
   * Override the spoken name when the visible text is ambiguous *on this
   * screen* — two controls reading "Add a car" is ambiguous to a screen reader
   * in a way it is not to the eye, which has position to go on.
   *
   * Not for paraphrasing the label; an override that merely restates it makes
   * the two surfaces drift.
   */
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const inert = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy }}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        styles[variant],
        pressed && !inert && styles[`${variant}Pressed` as const],
        inert && styles.inert,
        inert && variant === 'ghost' && styles.inertGhost,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? text.onPrimary : text.primary} />
      ) : (
        <Text
          style={[
            styles[`${size}Label` as const],
            styles[`${variant}Label` as const],
            inert && styles.inertLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },

  /*
    ── Both sizes clear 44pt ─────────────────────────────────────────────────

    "Small" is narrower and lighter in type; it is **not** shorter. The floor is
    a coarse-pointer target rather than a style, and a 36pt button is the most
    common way a design system quietly stops meeting it.
  */
  small: { minHeight: TARGET_MIN, paddingHorizontal: space.md },
  large: { minHeight: 52, paddingHorizontal: space.xl },
  smallLabel: { ...type.ui },
  largeLabel: { ...type.bodyStrong },

  primary: { backgroundColor: brand.primary },
  primaryPressed: { backgroundColor: brand.primaryPressed },
  primaryLabel: { color: text.onPrimary },

  quiet: { backgroundColor: surface.raised },
  quietPressed: { backgroundColor: surface.well },
  quietLabel: { color: text.primary },

  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: border.field },
  outlinePressed: { backgroundColor: surface.raised, borderColor: border.fieldHover },
  outlineLabel: { color: text.primary },

  ghost: { backgroundColor: 'transparent' },
  ghostPressed: { backgroundColor: surface.raised },
  ghostLabel: { color: text.secondary },

  delete: { backgroundColor: status.danger },
  deletePressed: { backgroundColor: status.dangerPressed },
  deleteLabel: { color: text.primary },

  inert: { backgroundColor: surface.disabled, borderColor: 'transparent' },
  /*
    A disabled ghost keeps no fill — it had none to begin with, and giving it
    one on the way out makes an absent control appear.
  */
  inertGhost: { backgroundColor: 'transparent' },
  inertLabel: { color: text.disabled },
});
