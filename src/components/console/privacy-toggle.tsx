import { Eye, EyeOff } from 'lucide-react';
import { usePrivacy } from '@/lib/privacy-context';
import { cn } from '@/lib/utils';

/**
 * Screen-privacy switch for the consoles.
 *
 * Toggles <Money> masking globally. Rendered as a pressed/unpressed toggle
 * button so the current state is announced to assistive technology rather
 * than only being implied by the icon.
 *
 * `variant="nav"` matches the sidebar row it sits in in the reference
 * dashboard, so it lines up with the section links and the sign-out button.
 */
export function PrivacyToggle({
  className,
  variant = 'chip',
}: {
  className?: string;
  variant?: 'chip' | 'nav';
}) {
  const { hidden, toggle } = usePrivacy();
  const icon = hidden ? (
    <EyeOff className="h-4 w-4" aria-hidden />
  ) : (
    <Eye className="h-4 w-4" aria-hidden />
  );

  if (variant === 'nav') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={hidden}
        title={hidden ? 'Show amounts' : 'Hide amounts'}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-kv-muted transition hover:bg-white/5 hover:text-white',
          hidden && 'text-kv-white',
          className,
        )}
      >
        {icon}
        <span className="tracking-wide">{hidden ? 'Amounts hidden' : 'Amounts'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      title={hidden ? 'Show amounts' : 'Hide amounts'}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-kv-line bg-kv-card px-3 py-1.5 text-2xs uppercase tracking-widest text-kv-muted transition-colors hover:border-kv-lineStrong hover:text-kv-white',
        hidden && 'border-kv-white/40 text-kv-white',
        className,
      )}
    >
      {icon}
      <span>{hidden ? 'Hidden' : 'Amounts'}</span>
    </button>
  );
}
