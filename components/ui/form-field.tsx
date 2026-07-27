'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@crewchief/core/utils';

/**
 * A text field with a real error state.
 *
 * Before this, the only feedback channel was a neutral hint line, so an
 * invalid field looked exactly like a valid one — the message changed colour
 * at most. That fails quietly for anyone scanning, and fails completely for
 * screen reader users, since nothing marked the field invalid.
 *
 * An error here carries all four signals together:
 *
 *   - a critical-coloured border, so the field is findable at a glance
 *   - an icon, so the state does not depend on colour alone
 *   - the message directly beneath, wired via aria-describedby
 *   - aria-invalid, so assistive tech announces it
 *
 * Error copy should say what is wrong AND what would be right. "Invalid VIN"
 * tells someone nothing; "A VIN is 17 characters — this one has 8" tells them
 * what to do next.
 */

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Present means invalid. Absent means valid — there is no separate flag. */
  error?: string | null;
  /** Neutral guidance shown when there is no error. */
  hint?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, hint, id, className, ...props }, ref) => {
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const errorId = `${fieldId}-error`;
    const hintId = `${fieldId}-hint`;
    const invalid = Boolean(error);

    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className="text-muted-foreground">
          {label}
        </Label>

        <Input
          id={fieldId}
          ref={ref}
          aria-invalid={invalid || undefined}
          // Point at whichever message is actually rendered, never both.
          aria-describedby={invalid ? errorId : hint ? hintId : undefined}
          className={cn(invalid && 'border-red-400/60 focus-visible:ring-red-400/50', className)}
          {...props}
        />

        {invalid ? (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-red-400">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);

FormField.displayName = 'FormField';
