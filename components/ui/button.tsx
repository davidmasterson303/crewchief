import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@crewchief/core/utils';

/**
 * The button primitive — v8 §8a.
 *
 * This was stock shadcn until 8 Aug, and `.field` had already made the argument
 * for fixing it here rather than at the call sites: **a call site that still
 * needs a colour is a bug in the primitive.** Five defects, each measured
 * rather than asserted:
 *
 *   - `rounded-md`. The radius happened to land near right, by coincidence —
 *     shadcn's `md` and this app's `md` are different numbers. `rounded-xl` is
 *     the design-system token every other control in the product uses.
 *
 *   - `ring-offset-2`. **An offset gap on a dark surface reads as a hairline
 *     crack, not a ring.** Settled for fields in v7 and never applied here. The
 *     halo now touches the border.
 *
 *   - The `outline` variant filled with `bg-background` — surface-0 — so it
 *     rendered **darker than the card holding it**. A raised control darker
 *     than its container does not read as raised; it reads as a hole. It fills
 *     with nothing now and inherits whatever surface it sits on, so it cannot
 *     come out darker than its container on any of them.
 *
 *   - `h-10` = **40px**, under the 44px floor RB0 rule 3 states for any
 *     interactive target — on the primitive every button in the app is built
 *     from.
 *
 *   - `disabled:opacity-50`. A group alpha multiplies with any alpha inside it,
 *     which is how `ModificationsTab`'s badges reached an effective 0.30. The
 *     disabled state is an explicit fill and explicit ink now, so there is
 *     nothing to multiply and the contrast guard can measure it.
 *
 * ── Two deliberate departures from the design system's spec ─────────────────
 *
 * **44px everywhere, not 40 on a fine pointer.** `tokens/buttons.css` scopes
 * 40px to `(pointer: fine)` and 44px to coarse, arguing a mouse is precise
 * enough for 40. That is reasonable, and this repo's own RB0 rule 3 says 44 for
 * *any* interactive target with no pointer exception. Following the stricter of
 * the two rules costs 4px of desktop density and needs no new Tailwind variant.
 *
 * **Hover does not go up the ramp.** The spec says hover returns to cyan-600
 * (`#0891B2`). Measured against the light ink this now carries, that pairing is
 * **3.51:1 and fails AA** — the same shape of error as the ink row the spec
 * originally omitted. `hover:bg-primary/90` composites toward the page ground
 * instead, which is 5.87:1 and darker rather than lighter. The reasoning is in
 * `app/globals.css` beside `--primary`.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center whitespace-nowrap',
    'rounded-xl text-sm font-medium transition-colors',
    // RB0 rule 3. `min-h` rather than `h` so a button that wraps grows instead
    // of clipping its own label.
    'min-h-[44px]',
    /*
      No ring offset. `focus-visible:ring-2` sits directly on the border, which
      is what makes it read as a halo on a dark surface rather than as a gap.
    */
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    /*
      A stated surface and stated ink. `disabled:opacity-50` is deliberately
      gone — see the docblock, and `text-contrast-floor.test.ts` for why an
      alpha the scan cannot composite is the problem rather than the value.
    */
    'disabled:pointer-events-none disabled:cursor-not-allowed',
    'disabled:bg-[var(--surface-disabled)] disabled:text-[var(--text-disabled)]',
    'disabled:border-[color:var(--border-subtle)]',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        /*
          `bg-transparent`, never `bg-background`. Inherits whatever surface it
          sits on, so it can never render darker than its container — the
          defect this variant shipped with.
        */
        outline:
          'border border-[color:var(--border-field)] bg-transparent hover:border-[color:var(--border-field-hover)] hover:bg-white/4',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-white/5 hover:text-foreground',
        /*
          A link is text, not a target — the 44px floor is about hit areas, and
          applying it here would put 44px of dead space around an inline word.
          `min-h-0` opts out explicitly so the exception is visible rather than
          looking like an oversight.
        */
        link: 'min-h-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'px-4 py-2',
        /*
          `sm` is a DENSITY step, not a licence to go under the floor: it keeps
          the same 44px target and takes its compactness from padding. A control
          that must render smaller than its hit area wants `.tap-target-44`,
          which grows the area without inflating the glyph.
        */
        sm: 'px-3 text-xs',
        lg: 'px-8',
        icon: 'w-11 px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
