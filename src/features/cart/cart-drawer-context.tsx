import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface CartDrawerContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /**
   * The WhatsApp checkout lives here rather than inside the drawer so the
   * product page's "Buy on WhatsApp" can open it directly, with one dialog
   * instance shared by every trigger.
   */
  isCheckoutOpen: boolean;
  openCheckout: () => void;
  closeCheckout: () => void;
}

const CartDrawerContext = createContext<CartDrawerContextValue | null>(null);

/**
 * Owns the cart sheet's open state so the header, product cards and product
 * detail page can all open it without prop drilling.
 */
export function CartDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // The sheet behind the checkout dialog should not still be open.
  const openCheckout = useCallback(() => {
    setIsOpen(false);
    setIsCheckoutOpen(true);
  }, []);

  const closeCheckout = useCallback(() => setIsCheckoutOpen(false), []);

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      isCheckoutOpen,
      openCheckout,
      closeCheckout,
    }),
    [isOpen, open, close, toggle, isCheckoutOpen, openCheckout, closeCheckout],
  );

  return <CartDrawerContext.Provider value={value}>{children}</CartDrawerContext.Provider>;
}

export function useCartDrawer(): CartDrawerContextValue {
  const context = useContext(CartDrawerContext);
  if (!context) throw new Error('useCartDrawer must be used inside <CartDrawerProvider>');
  return context;
}
