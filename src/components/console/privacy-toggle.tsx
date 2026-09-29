import { Eye, EyeOff } from 'lucide-react';
import { usePrivacy } from '@/lib/privacy-context';
import { cn } from '@/lib/utils';

/**
 * Screen-privacy switch for the consoles.
 *
 * Toggles <Money> masking globally. Rendered as a pressed/unpressed toggle
 * button so the current state is announced to assistive technology rather
 * than only being implied by the icon.
 */
export function PrivacyToggle({ className }: { className?: string }) {
  const { hidden, toggle } = usePrivacy();

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
      {hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
      <span>{hidden ? 'Hidden' : 'Amounts'}</span>
    </button>
  );
}
