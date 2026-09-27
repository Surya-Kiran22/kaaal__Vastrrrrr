import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { variantKey } from '@/lib/utils';
import type { CartLine, CartTotals, StoreProduct } from '@/types';

const STORAGE_KEY = 'kaal-vastr.cart.v1';
const MAX_QTY_PER_LINE = 10;

interface CartState {
  lines: CartLine[];
}

type CartAction =
  | { type: 'hydrate'; lines: CartLine[] }
  | { type: 'add'; line: CartLine }
  | { type: 'setQuantity'; id: string; quantity: number }
  | { type: 'remove'; id: string }
  | { type: 'clear' };

const EMPTY: CartState = { lines: [] };

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'hydrate':
      return { lines: action.lines };

    case 'add': {
      const existing = state.lines.find((line) => line.id === action.line.id);
      if (!existing) return { lines: [...state.lines, action.line] };

      return {
        lines: state.lines.map((line) =>
          line.id === action.line.id
            ? {
                ...line,
                quantity: clamp(
                  line.quantity + action.line.quantity,
                  1,
                  Math.min(line.maxQuantity, MAX_QTY_PER_LINE),
                ),
                // Refresh the stock ceiling in case the store restocked.
                maxQuantity: Math.max(line.maxQuantity, action.line.maxQuantity),
                unitPrice: action.line.unitPrice,
                image: action.line.image ?? line.image,
              }
            : line,
        ),
      };
    }

    case 'setQuantity':
      return {
        lines: state.lines
          .map((line) =>
            line.id === action.id
              ? {
                  ...line,
                  quantity: clamp(action.quantity, 1, Math.min(line.maxQuantity, MAX_QTY_PER_LINE)),
                }
              : line,
          )
          .filter((line) => line.quantity > 0),
      };

    case 'remove':
      return { lines: state.lines.filter((line) => line.id !== action.id) };

    case 'clear':
      return EMPTY;

    default:
      return state;
  }
}

export interface AddToCartInput {
  product: StoreProduct;
  size: string | null;
  color: string | null;
  quantity: number;
  units: number;
}

export type AddResult =
  | { added: true }
  | { added: false; reason: 'locked' | 'unavailable' | 'sold-out' };

export interface CartContextValue {
  lines: CartLine[];
  totals: CartTotals;
  isEmpty: boolean;
  /**
   * False for anonymous visitors, staff and admins. The cart drawer, the
   * header icon and every add-to-cart control key off this single flag so they
   * cannot drift apart.
   */
  canShop: boolean;
  /** Quantity of a specific variant already in the cart. */
  quantityOf: (productId: string, color: string | null, size: string | null) => number;
  addItem: (input: AddToCartInput) => AddResult;
  setQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<CartLine>;
  return (
    typeof line.id === 'string' &&
    typeof line.productId === 'string' &&
    typeof line.name === 'string' &&
    typeof line.sku === 'string' &&
    typeof line.unitPrice === 'number' &&
    Number.isFinite(line.unitPrice) &&
    typeof line.quantity === 'number' &&
    line.quantity > 0
  );
}

function readStoredCart(): CartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isCartLine)
      .map((line) => ({
        ...line,
        color: line.color ?? null,
        size: line.size ?? null,
        image: line.image ?? null,
        compareAt: typeof line.compareAt === 'number' ? line.compareAt : null,
        category: line.category ?? 'Apparel',
        maxQuantity: clamp(line.maxQuantity ?? MAX_QTY_PER_LINE, 1, MAX_QTY_PER_LINE),
        quantity: clamp(line.quantity, 1, Math.min(line.maxQuantity ?? MAX_QTY_PER_LINE, MAX_QTY_PER_LINE)),
      }));
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, EMPTY);
  // Persisting before the stored cart is read back would wipe a returning
  // visitor's cart, so writing is gated on hydration finishing first.
  const hydrated = useRef(false);
  const { canShop, status } = useAuth();

  useEffect(() => {
    // Hold the stored cart only once we know who is looking. Reading it during
    // the auth 'loading' phase would briefly expose a previous customer's cart
    // to whoever is about to sign in.
    if (status === 'loading') return;
    dispatch({ type: 'hydrate', lines: canShop ? readStoredCart() : [] });
    hydrated.current = true;
  }, [canShop, status]);

  // A staff member signing in on a shared shop computer must not inherit the
  // previous customer's cart, so the lines are dropped rather than hidden.
  useEffect(() => {
    if (status === 'loading' || canShop) return;
    if (state.lines.length > 0) dispatch({ type: 'clear' });
  }, [canShop, status, state.lines.length]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      if (canShop) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.lines));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode / quota exceeded — the cart still works for this session.
    }
  }, [state.lines, canShop]);

  const quantityOf = useCallback(
    (productId: string, color: string | null, size: string | null) => {
      const id = `${productId}::${variantKey(color, size)}`;
      return state.lines.find((line) => line.id === id)?.quantity ?? 0;
    },
    [state.lines],
  );

  const addItem = useCallback(
    ({ product, size, color, quantity, units }: AddToCartInput): AddResult => {
      if (!canShop) {
        toast.error('Please sign in to start shopping.');
        return { added: false, reason: 'locked' };
      }

      if (!product.inStock) {
        toast.error('This piece is currently unavailable.');
        return { added: false, reason: 'unavailable' };
      }

      if (units <= 0) {
        toast.error('That size and colour combination is sold out.');
        return { added: false, reason: 'sold-out' };
      }

      const wants = clamp(quantity, 1, MAX_QTY_PER_LINE);
      const maxQuantity = Math.max(1, Math.min(units, product.maxSelectableQuantity, MAX_QTY_PER_LINE));
      if (wants > units) {
        toast.error(`Only ${units} left in ${[color, size].filter(Boolean).join(' / ')}.`);
      }

      const id = `${product.id}::${variantKey(color, size)}`;
      dispatch({
        type: 'add',
        line: {
          id,
          productId: product.id,
          name: product.name,
          slug: product.slug,
          sku: product.sku,
          image: product.primaryImage,
          color,
          size,
          unitPrice: product.price,
          compareAt: product.compareAt,
          quantity: Math.min(wants, maxQuantity),
          maxQuantity,
          category: product.category,
        },
      });

      toast.success(`${product.name} added to cart`);
      return { added: true };
    },
    [canShop],
  );

  const setQuantity = useCallback((id: string, quantity: number) => {
    dispatch({ type: 'setQuantity', id, quantity });
  }, []);

  const removeItem = useCallback((id: string) => {
    dispatch({ type: 'remove', id });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: 'clear' });
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const totals = useMemo<CartTotals>(() => {
    const subtotal = state.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const listTotal = state.lines.reduce(
      (sum, line) => sum + (line.compareAt ?? line.unitPrice) * line.quantity,
      0,
    );
    return {
      itemCount: state.lines.reduce((sum, line) => sum + line.quantity, 0),
      lineCount: state.lines.length,
      subtotal,
      savings: Math.max(0, Math.round(listTotal - subtotal)),
      total: subtotal,
    };
  }, [state.lines]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines: state.lines,
      totals,
      isEmpty: state.lines.length === 0,
      canShop,
      quantityOf,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
    }),
    [state.lines, totals, canShop, quantityOf, addItem, setQuantity, removeItem, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside <CartProvider>');
  return context;
}
