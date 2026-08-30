import * as React from 'react';

import { cn } from '@wellkept/core/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * `sm` drops the control to 34px. There is no `lg` — nothing in the app asked
   * for one, and an unused size is a decision nobody has made yet.
   *
   * Named `fieldSize`, not `size`, and that is not fussiness: `<input size>` is a
   * real DOM attribute meaning "width in characters". Calling this `size` and
   * omitting the native one type-errored immediately — `FormField` extends the
   * input attributes and forwards `size?: number` straight through. Taking the
   * native attribute away to make room for a variant would also have broken any
   * caller legitimately using it. `Textarea` uses the same name for the same
   * reason.
   */
  fieldSize?: 'default' | 'sm';
}

/**
 * The one text input.
 *
 * Stock shadcn until v7 C1: `bg-background border-input … ring-offset-2`. Against
 * this app's tokens that resolved to a fill of `--background` (#100F0D, surface-0)
 * — a field **darker than the card holding it** — with a `--input` border
 * measuring **1.09:1** against that card, and no hover state at all. 64 bare
 * `<Input />` elements shipped like that, and five call sites had hand-themed
 * their way out of it, so three field designs were live at once. The third — what
 * a new caller got by default — was the broken one.
 *
 * Every state now lives in `.field` in `app/globals.css`, so this file is
 * composition and nothing else. **A call site that still needs a colour, border,
 * height or radius is a bug in `.field`, not a special case** — fix it there.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, fieldSize = 'default', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'field',
          fieldSize === 'sm' && 'field-sm',
          // shadcn's file-input reset stays: a file control's button is not a
          // text field, and `.field` has nothing to say about it.
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          'disabled:opacity-60',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
