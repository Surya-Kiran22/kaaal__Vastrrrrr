import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

export type OrderGateBlock =
  | { blocked: false }
  | { blocked: true; reason: 'anonymous' | 'unverified' | 'staff' | 'loading' };

/**
 * Single gate for every "order on WhatsApp" entry point.
 *
 * Ordering is deliberately impossible while signed out: the order has to be
 * written to the database so the customer gets a reference and the staff console
 * has something to dispatch. The product page's "Buy on WhatsApp" button used to
 * open a bare chat link that recorded nothing, which is why this gate exists
 * rather than relying on the cart being hidden.
 *
 * Callers get one of two outcomes: either the action runs, or the shopper is
 * sent to sign in with a `redirect` back to where they were.
 */
export function useOrderGate(onBlocked?: (block: OrderGateBlock) => void) {
  const { canShop, isAuthenticated, isEmailVerified, canUseConsole, status } = useAuth();
  const navigate = useNavigate();

  const evaluate = useCallback((): OrderGateBlock => {
    if (status === 'loading') return { blocked: true, reason: 'loading' };
    if (canShop) return { blocked: false };
    // Staff and admins are not shoppers, so they are never sent to a customer
    // sign-in form; they belong in their console.
    if (canUseConsole) return { blocked: true, reason: 'staff' };
    if (isAuthenticated && !isEmailVerified) return { blocked: true, reason: 'unverified' };
    return { blocked: true, reason: 'anonymous' };
  }, [status, canShop, canUseConsole, isAuthenticated, isEmailVerified]);

  /**
   * Runs `action` when the visitor may order, otherwise explains why not.
   * Returns true when the action was allowed to proceed.
   */
  const requireCustomer = useCallback(
    (action: () => void): boolean => {
      const block = evaluate();

      if (!block.blocked) {
        action();
        return true;
      }

      onBlocked?.(block);

      switch (block.reason) {
        case 'loading':
          // Auth is still resolving; saying "sign in" here would be wrong and
          // could bounce a signed-in customer out of the page.
          return false;
        case 'unverified':
          toast.error('Verify your email with the 6-digit code before ordering.');
          void navigate({ to: '/account/verify' });
          return false;
        case 'staff':
          toast.error('Staff accounts cannot place customer orders.');
          return false;
        default:
          toast('Sign in to order on WhatsApp.', {
            description: 'Your cart, addresses and order history live in your account.',
            action: {
              label: 'Sign in',
              onClick: () => {
                void navigate({
                  to: '/account/login',
                  search: { redirect: window.location.pathname + window.location.search },
                });
              },
            },
          });
          void navigate({
            to: '/account/login',
            search: { redirect: window.location.pathname + window.location.search },
          });
          return false;
      }
    },
    [evaluate, navigate, onBlocked],
  );

  return { requireCustomer, evaluate };
}
