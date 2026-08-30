import * as React from 'react';

import { cn } from '@wellkept/core/utils';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Matches `Input`'s `sm` step, for a textarea sitting in a dense form. */
  fieldSize?: 'default' | 'sm';
}

/**
 * The one textarea. Shares every state with `Input` through `.field`.
 *
 * See `input.tsx` for what this was and why it changed.
 *
 * **Height comes from `rows`, not a fixed minimum.** The old `min-h-[80px]` meant
 * a caller wanting anything else had to override it with a className — which is
 * how `QuoteRequestDialogV2` ended up carrying a whole field theme just to change
 * a height. `rows` defaults to 3 and the browser derives the height from it, so
 * `rows={6}` is now the entire API for "taller". `.field-textarea` clears the
 * `min-height` that `.field` sets for inputs so `rows` is actually in charge.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, fieldSize = 'default', ...props }, ref) => {
    return (
      <textarea
        rows={rows}
        className={cn(
          'field field-textarea',
          fieldSize === 'sm' && 'field-sm',
          'disabled:opacity-60',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
