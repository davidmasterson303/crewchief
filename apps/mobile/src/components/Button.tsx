import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { TARGET_MIN, border, brand, radius, space, status, surface, text, type } from '../theme';

export type ButtonVariant = 'primary' | 'quiet' | 'outline' | 'ghost' | 'delete';
export type ButtonSize = 'small' | 'large';

/**
 * The button primitive. Web got one in v8 §8a; this app did not.
 *
 * Six variants, four states each, two sizes — the board's "primitive set"
 * section in full. **States are not optional**: a variant without its pressed
 * and disabled treatment is where every one of this product's contrast defects
 * has come from, and the two worst were both disabled states.
 *
 * ── ⚠ `inverse` is gone, 23 Aug. There is one filled treatment ─────────────
 *
 * There used to be a sixth variant: white fill, near-black ink, for a verb that
 * had to outrank everything. It was well built — four dedicated tokens, four
 * states, measured contrast at each — and it was **against the system**. The
 * readme's override register says it plainly: *"Advisor CTA — white fill →
 * `.btn-primary`; a white button is a foreign colour here."*
 *
 * The v8.3 review found what that cost. `Take a photo`, `That is right` and
 * `Ask` were white; `See suggestions` was cyan. Two filled primaries in one
 * app, and the **more common one was the one the system forbids** — so the
 * screens disagreed with each other about what a primary action looks like,
 * which is the thing a design system exists to stop.
 *
 * The tokens went with it rather than being left dead. `theme/index.ts` carries
 * the rule about why: a token nothing reads is how a retired treatment comes
 * back, one call site at a time, with its argument already written.
 *
 * What survives is the reasoning that made `inverse` worth building — the
 * treatment must be a primitive, not six private copies. Before 15 Aug it lived
 * in sign-in, add-vehicle, the wishlist, the advisor, the invoice scan and the
 * service milestone, diverging the way private copies do: 15pt against 16,
 * weight 600 against 700, letter-spacing on some and not others, on the app's
 * most important control. That is why `primary` is a variant here and not a
 * style anybody may write out.
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
        /*
          The spinner has to be legible on the fill it spins on. `SPINNER`
          carries the exception per variant and `text.primary` is the default —
          the case this was written for was the retired white control, where the
          platform default and `text.primary` were both white on white, giving a
          control that looks empty at exactly the moment it is working.
        */
        <ActivityIndicator color={SPINNER[variant] ?? text.primary} />
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

/**
 * The spinner's ink per variant, where the default is wrong.
 *
 * Only the brand fill needs naming — its ink is `text.onPrimary`, not white.
 * Everything else spins in `text.primary` against a dark or absent fill.
 */
const SPINNER: Partial<Record<ButtonVariant, string>> = {
  primary: text.onPrimary,
};

const styles = StyleSheet.create({
  base: {
    /**
     * ⚠ `radius.pill`, not `radius.button`, as of 23 Aug.
     *
     * The native specs draw every full-width primary as a pill — the vehicle
     * hub's "Ask the advisor", the recall screen's two actions, the wishlist's
     * add. `radius.button` (12) is the web control step, and it reached mobile
     * with the token layer rather than by anyone looking at a native screen.
     *
     * The five-step radius map in the design system assigns `full` to chips,
     * filter pills, status badges and avatars, and `md` to buttons — so this is
     * a **deliberate override of that map for native**, logged in
     * `docs/design-system-drift.md` rather than made quietly. A 12pt corner on
     * a 52pt-tall full-bleed control reads as a web form submit; the phone's
     * own idiom is the pill, and every native spec draws it that way.
     */
    borderRadius: radius.pill,
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
  /**
   * ⚠ `text.muted`, not `text.disabled`, and the two are not interchangeable.
   *
   * `text.disabled` is `#6E6B67` — a dark grey that measures **3.31:1** on the
   * dark `surface.disabled` fill. WCAG 1.4.3 genuinely exempts inactive
   * controls, so that is not a compliance defect and this docblock used to say
   * so and stop there.
   *
   * It stopped being good enough on 23 Aug, when the add-a-car screen started
   * opening with a disabled outline button as its **first control**. This
   * project has already made that call twice — `SignInScreen`'s submit and the
   * advisor's "Ask" were both fixed as disabled states, on the grounds that a
   * control nobody can read leaves you unable to tell what the control even is,
   * and the state a screen *opens in* is the one that matters most.
   *
   * `text.muted` composites to 5.23:1 on `surface.disabled` and is still a
   * clear step down from the `text.primary` these variants use when live, so it
   * reads as inactive without going unreadable.
   *
   * ⚠ Every variant here is a dark fill, which is what makes one disabled ink
   * sufficient. The retired white control needed its own — 50% white on
   * `#B8B8B8` is the opposite mistake — and a light variant returning would
   * need one again rather than inheriting this.
   */
  inertLabel: { color: text.muted },
});
