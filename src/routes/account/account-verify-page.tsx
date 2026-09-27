import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, KeyRound, MailCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { authController } from '@/lib/auth-controller';

export interface AccountVerifySearch {
  email?: string;
  justSignedUp?: string;
}

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 45;

export function AccountVerifyPage() {
  const search = useSearch({ from: '/account/verify' });
  const navigate = useNavigate();
  const { isAuthenticated, isEmailVerified } = useAuth();

  const [email, setEmail] = useState(search.email ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);

  // A verified customer has no business on this page.
  useEffect(() => {
    if (isAuthenticated && isEmailVerified) {
      void navigate({ to: '/account', replace: true });
    }
  }, [isAuthenticated, isEmailVerified, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const digitsOnly = useMemo(() => code.replace(/\D/g, '').slice(0, CODE_LENGTH), [code]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (digitsOnly.length !== CODE_LENGTH) {
      setError(`Enter all ${CODE_LENGTH} digits from your email.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await authController.verifySignupCode(email, digitsOnly);
      toast.success('Email verified. Welcome to Kaal Vastr.');
      void navigate({ to: '/account', replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That code was not accepted.');
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (!email) {
      setError('Enter your email address first.');
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    try {
      await authController.resendVerification(email);
      toast.success('A new code is on its way.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not resend the code.');
    }
  };

  return (
    <div className="container-kv flex min-h-[70dvh] items-center justify-center py-16">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <Link
          to="/account/login"
          className="inline-flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Back to sign in
        </Link>

        <div className="mt-7 mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-kv-line bg-kv-surface text-kv-silver">
          <MailCheck className="h-6 w-6" aria-hidden />
        </div>

        <h1 className="font-display text-3xl tracking-tight text-kv-white">Verify your email</h1>
        <p className="mt-3 text-sm leading-relaxed text-kv-muted">
          {search.justSignedUp
            ? 'Almost there. Enter the 6-digit code we just emailed you to activate your account.'
            : 'Enter the 6-digit code we emailed you when you registered.'}
        </p>

        <form onSubmit={onSubmit} noValidate className="edge-light mt-8 rounded-2xl border border-kv-line bg-kv-card p-7 shadow-glow">
          <div className="space-y-5">
            {error ? (
              <div
                role="alert"
                className="flex gap-3 rounded-xl border border-kv-danger/30 bg-kv-danger/[0.08] p-4 text-sm text-kv-danger"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            ) : null}

            <Field label="Email" htmlFor="verify-email" required>
              <Input
                id="verify-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </Field>

            <Field
              label="6-digit code"
              htmlFor="verify-code"
              required
              hint="The code is in the email we sent you"
            >
              <div className="relative">
                <KeyRound
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="verify-code"
                  ref={inputRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={CODE_LENGTH}
                  value={digitsOnly}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setError(null);
                  }}
                  placeholder="000000"
                  className="pl-10 text-center font-mono text-lg tracking-[0.5em]"
                />
              </div>
            </Field>

            <Button
              type="submit"
              block
              size="lg"
              loading={submitting}
              loadingText="Verifying…"
              disabled={digitsOnly.length !== CODE_LENGTH}
            >
              Verify and continue
            </Button>

            <div className="flex items-center justify-between border-t border-kv-line pt-5">
              <p className="text-2xs text-kv-dim">Did not get the code?</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResend}
                disabled={cooldown > 0}
                className="text-kv-silver"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </Button>
            </div>
          </div>
        </form>

        <p className="mt-5 text-center text-2xs leading-relaxed text-kv-dim">
          Verification emails need working SMTP. If nothing arrives, ask the store to confirm your address.
        </p>
      </motion.div>
    </div>
  );
}
