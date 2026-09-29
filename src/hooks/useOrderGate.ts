import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

/** The blocked half of OrderGateBlock, named so it can be a parameter type. */
export type OrderGateDenial = {
  blocked: true;
  reason: 'anonymous' | 'unverified' | 'staff' | 'loading';
};

export type OrderGateBlock = { blocked: false } | OrderGateDenial;

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
   * Explains a block and, where that makes sense, routes the shopper onwards.
   * Split out of requireCustomer so a caller with nothing to run - the cart's
   * empty state, for instance - can raise the same prompt without inventing an
   * empty callback, and so the redirect logic exists in exactly one place.
   */
  const explainBlock = useCallback(
    (block: OrderGateDenial) => {
      switch (block.reason) {
        case 'loading':
          // Auth is still resolving; saying "sign in" here would be wrong and
          // could bounce a signed-in customer out of the page.
          return;
        case 'unverified':
          toast.error('Verify your email with the 6-digit code before ordering.');
          void navigate({ to: '/account/verify' });
          return;
        case 'staff':
          toast.error('Staff accounts cannot place customer orders.');
          return;
        default:
          // Wording is deliberately not "sign in to order on WhatsApp": the same
          // prompt is raised when adding to the cart and from the cart's empty
          // state, and "start shopping" is the accurate ask in all three.
          toast('Sign in to start shopping.', {
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
      }
    },
    [navigate],
  );

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
      explainBlock(block);
      return false;
    },
    [evaluate, explainBlock, onBlocked],
  );

  /**
   * Raises the same prompt without running anything. For surfaces that must not
   * be available to a signed-out visitor at all, and which have no action to
   * guard.
   */
  const requestSignIn = useCallback(() => {
    const block = evaluate();
    if (!block.blocked) return;
    onBlocked?.(block);
    explainBlock(block);
  }, [evaluate, explainBlock, onBlocked]);

  return { requireCustomer, requestSignIn, evaluate };
}
