import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { TARGET_MIN, border, brand, radius, space, status, surface, text, type } from '../theme';

export type ButtonVariant = 'primary' | 'inverse' | 'quiet' | 'outline' | 'ghost' | 'delete';
export type ButtonSize = 'small' | 'large';

/**
 * The button primitive. Web got one in v8 §8a; this app did not.
 *
 * Six variants, four states each, two sizes — the board's "primitive set"
 * section in full. **States are not optional**: a variant without its pressed
 * and disabled treatment is where every one of this product's contrast defects
 * has come from, and the two worst were both disabled states.
 *
 * ── `inverse`, and why it arrived late ──────────────────────────────────────
 *
 * The theme carries four tokens that exist for exactly one treatment — a
 * light-on-dark control that has to outrank everything: `surface.inverse`,
 * `surface.inverseDisabled`, `text.onInverse` and `text.onInverseMuted`. Until
 * 15 Aug **no primitive owned any of them**, so the treatment lived as a
 * private copy in six screens: sign-in, add-vehicle, the wishlist, the advisor,
 * the invoice scan and the service milestone.
 *
 * They diverged the way private copies do — 15pt against 16, weight 600 against
 * 700, letter-spacing on some and not others — and on the app's most important
 * control. It is the CTA a reviewer meets first.
 *
 * ⚠ `inverse` and `primary` are **both** filled and the one-per-screen rule
 * covers them together. A screen with a white "Sign in" and a cyan "Skip" has
 * two controls claiming to be the single verb.
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
        inert && variant === 'inverse' && styles.inertInverse,
        style,
      ]}
    >
      {busy ? (
        /*
          The spinner has to be legible on the fill it spins on. `inverse` is a
          white control, so the platform default and `text.primary` would both
          be white on white — a control that looks empty at exactly the moment
          it is working.
        */
        <ActivityIndicator color={SPINNER[variant] ?? text.primary} />
      ) : (
        <Text
          style={[
            styles[`${size}Label` as const],
            styles[`${variant}Label` as const],
            inert && styles.inertLabel,
            inert && variant === 'inverse' && styles.inertInverseLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The spinner's ink per variant, where the default is wrong.
 *
 * Only the two filled-light cases need naming; everything else spins in
 * `text.primary` against a dark fill.
 */
const SPINNER: Partial<Record<ButtonVariant, string>> = {
  primary: text.onPrimary,
  inverse: text.onInverse,
};

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

  /*
    ── The inverse control ───────────────────────────────────────────────────

    White fill, near-black ink. Used sparingly and never for two controls on one
    screen — it is the treatment for a verb that has to outrank everything else
    on the page, which is why it exists at all rather than being a second
    primary.

    ⚠ Pressed goes **down** to `inverseDisabled`'s neighbourhood in tone while
    the ink stays near-black, so contrast *rises* on press. The rule elsewhere
    in this file is that pressed never lightens under near-white ink; here the
    ink is dark, so the same rule points the same way for the opposite reason.
  */
  inverse: { backgroundColor: surface.inverse },
  inversePressed: { backgroundColor: surface.inverseDisabled },
  inverseLabel: { color: text.onInverse },

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
    A disabled inverse keeps the light treatment rather than dropping to the
    dark disabled fill: a white control that turns dark on the way out reads as
    a different control appearing, not as this one becoming unavailable.

    ⚠ **The ink does not dim with it**, and the first version of this got that
    wrong. Muffling the label to `text.onInverseMuted` measured **4.17:1** on
    this fill — the rendered contrast suite failed it on both sign-in states
    within a minute of the variant existing.

    `surface.inverseDisabled`'s own note in the theme is the answer and it was
    there all along: it "keeps its ink near 9:1 while reading as off". The
    dimmed *fill* is the entire signal. `text.onInverse` on it measures ~10:1,
    so this state is legible rather than merely exempt — WCAG 1.4.3 would have
    let it off, and taking that exemption is how a disabled control becomes
    unreadable instead of unavailable.
  */
  inertInverse: { backgroundColor: surface.inverseDisabled },
  inertInverseLabel: { color: text.onInverse },
  /*
    A disabled ghost keeps no fill — it had none to begin with, and giving it
    one on the way out makes an absent control appear.
  */
  inertGhost: { backgroundColor: 'transparent' },
  inertLabel: { color: text.disabled },
});
