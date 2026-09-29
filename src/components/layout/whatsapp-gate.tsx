import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { MessageCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { buildWhatsappChatLink } from '@/lib/whatsapp';
import { Button } from '@/components/ui/button';

type GateVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'whatsapp' | 'link';
type GateSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

interface WhatsAppGateProps {
  number?: string | null;
  variant?: GateVariant;
  size?: GateSize;
  className?: string;
  children: ReactNode;
  /** Where to send a signed-out visitor after they sign in. */
  returnTo?: string;
  /**
   * Render a bare anchor/Link using only `className`, for surfaces like the
   * mobile menu and inline product copy that cannot use `Button`. Keeps the
   * verification rule in one place instead of re-implementing it per surface.
   */
  unstyled?: boolean;
}

/**
 * WhatsApp is an ordering channel, so it sits behind the same verification gate
 * as checkout: a signed-out or unverified visitor never gets a `wa.me` link to
 * click. Without this they could bypass the cart entirely and negotiate a
 * piece over chat while the site refuses to let them order it.
 *
 * The blocked state is a link to the step that unblocks it, never a dead
 * button, so the requirement does not read as a broken site.
 */
export function WhatsAppGate({
  number,
  variant = 'whatsapp',
  size = 'md',
  className,
  children,
  returnTo,
  unstyled = false,
}: WhatsAppGateProps) {
  const { isAuthenticated, isEmailVerified, status } = useAuth();
  const whatsapp = buildWhatsappChatLink(number);

  if (!whatsapp) return null;

  const allowed = isAuthenticated && isEmailVerified;
  const loginSearch = returnTo ? { redirect: returnTo } : undefined;

  if (unstyled) {
    if (allowed) {
      return (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={className}>
          {children}
        </a>
      );
    }
    if (isAuthenticated) {
      return (
        <Link to="/account/verify" className={className}>
          <ShieldCheck className="h-4 w-4" />
          Verify email to chat
        </Link>
      );
    }
    if (status === 'loading') {
      return (
        <span className={className} aria-disabled="true">
          <MessageCircle className="h-4 w-4" />
          Sign in to chat
        </span>
      );
    }
    return (
      <Link to="/account/login" search={loginSearch} className={className}>
        <MessageCircle className="h-4 w-4" />
        Sign in to chat
      </Link>
    );
  }

  if (allowed) {
    return (
      <Button asChild variant={variant} size={size} className={className}>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      </Button>
    );
  }

  // Signed in but unverified: send them to the OTP step.
  if (isAuthenticated) {
    return (
      <Button asChild variant="outline" size={size} className={className}>
        <Link to="/account/verify">
          <ShieldCheck className="h-4 w-4" />
          Verify email to chat
        </Link>
      </Button>
    );
  }

  // Still resolving the session, or signed out.
  if (status === 'loading') {
    return (
      <Button variant="outline" size={size} className={className} disabled>
        <MessageCircle className="h-4 w-4" />
        Sign in to chat
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size={size} className={className}>
      <Link to="/account/login" search={loginSearch}>
        <MessageCircle className="h-4 w-4" />
        Sign in to chat
      </Link>
    </Button>
  );
}
