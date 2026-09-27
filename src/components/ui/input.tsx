import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-lg border border-kv-line bg-kv-surface px-3.5 py-2.5 text-sm text-kv-white placeholder:text-kv-dim transition-colors duration-200 hover:border-kv-lineStrong focus:border-kv-white/50 focus:outline-none focus:ring-1 focus:ring-kv-white/30 disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-kv-danger/70 aria-[invalid=true]:ring-kv-danger/25';

/**
 * Lets a `Field` hand its hint and error ids down to whatever control it wraps,
 * so the message is part of the control's accessible description.
 *
 * Before this, an error was a `role="alert"` paragraph floating next to the
 * input with nothing linking the two: a screen reader announced the text
 * verbatim with no indication of which field it belonged to. Passing the ids
 * through context rather than cloning props into the child keeps
 * `{...register('name')}` working, which React Hook Form relies on.
 */
interface FieldA11y {
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldA11y>({ describedBy: undefined, invalid: false });

function useFieldA11y() {
  return useContext(FieldContext);
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(
    { className, type = 'text', 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props },
    ref,
  ) {
    const field = useFieldA11y();
    return (
      <input
        ref={ref}
        type={type}
        className={cn(fieldBase, className)}
        // An explicit prop still wins, so a page can override the context.
        aria-invalid={invalid ?? (field.invalid || undefined)}
        aria-describedby={describedBy ?? field.describedBy}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea(
    { className, rows = 4, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props },
    ref,
  ) {
    const field = useFieldA11y();
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(fieldBase, 'resize-y', className)}
        aria-invalid={invalid ?? (field.invalid || undefined)}
        aria-describedby={describedBy ?? field.describedBy}
        {...props}
      />
    );
  },
);

export interface FieldProps {
  label: string;
  /** Preferred, but the control's own id is used when this is absent. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  const generatedId = useId();
  const child = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
  const childId = child?.props.id;

  // Precedence matters: if the caller already gave the control an id, that is
  // the id the label must point at, or the two drift apart.
  const controlId = childId ?? htmlFor ?? generatedId;
  const errorId = error ? `${controlId}-error` : undefined;
  const hintId = hint && !error ? `${controlId}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  // Injected only when the caller did not set one, so a `Field` without
  // `htmlFor` still ends up with a real label/control pair.
  const control = child && !childId ? cloneElement(child, { id: controlId }) : children;

  return (
    <FieldContext.Provider value={{ describedBy, invalid: Boolean(error) }}>
      <div className={cn('space-y-1.5', className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={controlId} className="text-xs font-medium tracking-wide text-kv-silver">
            {label}
            {/* Decorative: `required` is already conveyed by the validation. */}
            {required ? (
              <span aria-hidden="true" className="ml-1 text-kv-danger">
                *
              </span>
            ) : null}
          </label>
          {hint && !error ? (
            <span id={hintId} className="text-2xs text-kv-dim">
              {hint}
            </span>
          ) : null}
        </div>
        {control}
        {/*
          `role="alert"` is kept alongside the association: the description alone
          is only spoken when focus reaches the field, and a failed submit does
          not move focus there.
        */}
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-kv-danger">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
