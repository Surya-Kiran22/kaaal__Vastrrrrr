import { createContext, useContext } from 'react';

export type PrivacyContextValue = {
  /** True while monetary values are masked. */
  hidden: boolean;
  toggle: () => void;
  setHidden: (value: boolean) => void;
};

export const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export const PRIVACY_STORAGE_KEY = 'kv-privacy';
export const PRIVACY_MASK = '•••••••';

const VISIBLE_FALLBACK: PrivacyContextValue = {
  hidden: false,
  toggle: () => {},
  setHidden: () => {},
};

/**
 * Safe to call outside a provider - returns a permanently-visible no-op
 * context so a component can be rendered standalone (e.g. in isolation).
 */
export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext) ?? VISIBLE_FALLBACK;
}
