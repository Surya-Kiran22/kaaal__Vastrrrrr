import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatPrice } from '@/lib/format';
import {
  PRIVACY_MASK,
  PRIVACY_STORAGE_KEY,
  PrivacyContext,
  usePrivacy,
} from '@/lib/privacy-context';
import { cn } from '@/lib/utils';

/**
 * Screen-privacy mode for the consoles.
 *
 * Masks money wherever a <Money> is rendered, so an admin can walk away from
 * an unlocked screen without exposing order values. The preference is
 * persisted per browser and restored on mount; it deliberately defaults to
 * visible so a returning operator is never confused by masked totals.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(PRIVACY_STORAGE_KEY) === '1') setHiddenState(true);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies). Masking
      // is a convenience, so degrade to the default rather than throwing.
    }
  }, []);

  const setHidden = (value: boolean) => {
    setHiddenState(value);
    try {
      window.localStorage.setItem(PRIVACY_STORAGE_KEY, value ? '1' : '0');
    } catch {
      // See above: persistence is best-effort.
    }
  };

  const value = useMemo(() => ({ hidden, toggle: () => setHidden(!hidden), setHidden }), [hidden]);

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

/**
 * Renders an amount in INR, or a mask when privacy mode is on.
 *
 * Tabular figures keep columns aligned, which matters because these values
 * sit inside tables next to unmasked labels.
 */
export function Money({
  value,
  className,
  as: Component = 'span',
}: {
  value: number | string | null | undefined;
  className?: string;
  as?: 'span' | 'p' | 'div';
}) {
  const { hidden } = usePrivacy();
  return (
    <Component className={cn('font-money', className)}>
      {hidden ? PRIVACY_MASK : formatPrice(value)}
    </Component>
  );
}
