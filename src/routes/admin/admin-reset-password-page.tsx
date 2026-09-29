import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { z } from 'zod';

const schema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(72, 'Password must be 72 characters or fewer.'),
    confirmPassword: z.string().min(1, 'Re-enter your new password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

type FormValues = z.infer<typeof schema>;
type LinkState = 'checking' | 'ready' | 'invalid';

/** Supabase hands the recovery token over in the URL fragment. */
const hasRecoveryToken = () => /access_token|token_hash|code=/.test(window.location.hash + window.location.search);

/**
 * The landing page for console password-recovery emails.
 *
 * The client is configured with `detectSessionInUrl`, so following the emailed
 * link signs this browser in with a short-lived recovery session, and that
 * session is what authorises `updateUser`. Nothing here decides who may reset a
 * password — the token in the link is the only credential, and the normal console
 * guards still apply to whatever screen the user reaches afterwards.
 */
export function AdminResetPasswordPage() {
  const [linkState, setLinkState] = useState<LinkState>('checking');
  const [showPasswords, setShowPasswords] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  useEffect(() => {
    let cancelled = false;

    // The token has been read by the time this mounts, so drop the fragment now:
    // it should not survive a refresh or linger in session history.
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const settle = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setLinkState(data.session ? 'ready' : 'invalid');
    };

    /*
     * The token exchange is asynchronous, so a session can legitimately be absent
     * on the first read. Only treat the link as dead after giving the client a
     * moment, otherwise a valid link flashes the expired message.
     */
    const pending = hasRecoveryToken();
    const timer = pending ? window.setTimeout(() => void settle(), 1500) : null;

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        if (timer !== null) window.clearTimeout(timer);
        setLinkState('ready');
      }
    });

    if (!pending) void settle();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setFormError(error.message);
      return;
    }
    setDone(true);
  });

  return (
    <main
      id="main"
      data-console
      className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-16"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-32 top-10 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -right-32 bottom-10 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-kv-line-strong">
            <span className="gold-text font-display text-2xl tracking-[0.3em]">KV</span>
          </div>
          <h1 className="mt-6 text-3xl font-medium">Kaal Vastr</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.4em] text-kv-muted">Password reset</p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Back to store
          </Link>
        </div>

        <div className="glass rounded-3xl p-10">
          {!isSupabaseConfigured ? (
            <div className="mb-6 rounded-xl border border-kv-danger/30 bg-kv-danger/[0.08] p-4 text-sm text-kv-danger">
              Supabase is not configured, so this link cannot be verified.
            </div>
          ) : null}

          {done ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-9 w-9 text-kv-success" aria-hidden />
              <h2 className="mt-5 text-2xl font-medium">Password updated</h2>
              <p className="mt-3 text-sm text-kv-muted">
                You are signed in with your new password and can head straight to the console.
              </p>
              <Button asChild block size="lg" className="mt-8">
                <Link to="/admin/login">Continue</Link>
              </Button>
            </div>
          ) : linkState === 'checking' ? (
            <p className="text-center text-sm text-kv-muted" role="status">
              Checking your reset link…
            </p>
          ) : linkState === 'invalid' ? (
            <div>
              <div className="mb-6 flex gap-3 rounded-xl border border-kv-danger/30 bg-kv-danger/[0.08] p-4 text-sm text-kv-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  This reset link is invalid or has expired. Request a fresh one from the sign-in
                  screen.
                </p>
              </div>
              <Button asChild block size="lg">
                <Link to="/admin/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              {formError ? (
                <div className="flex gap-3 rounded-xl border border-kv-danger/30 bg-kv-danger/[0.08] p-4 text-sm text-kv-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p>{formError}</p>
                </div>
              ) : null}

              <Field
                label="New password"
                htmlFor="admin-reset-password"
                required
                error={errors.password?.message}
              >
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                    aria-hidden
                  />
                  <Input
                    id="admin-reset-password"
                    type={showPasswords ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••••"
                    className="pl-10 pr-11"
                    aria-invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((prev) => !prev)}
                    aria-label={showPasswords ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-kv-dim transition-colors hover:text-kv-white"
                  >
                    {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              <Field
                label="Confirm new password"
                htmlFor="admin-reset-confirm"
                required
                error={errors.confirmPassword?.message}
              >
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                    aria-hidden
                  />
                  <Input
                    id="admin-reset-confirm"
                    type={showPasswords ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••••"
                    className="pl-10"
                    aria-invalid={Boolean(errors.confirmPassword)}
                    {...register('confirmPassword')}
                  />
                </div>
              </Field>

              <Button
                type="submit"
                block
                size="lg"
                loading={isSubmitting}
                loadingText="Saving…"
                disabled={!isSupabaseConfigured}
              >
                Set new password
              </Button>

              <p className="text-center text-2xs uppercase tracking-widest text-kv-dim">
                Minimum 8 characters
              </p>
            </form>
          )}
        </div>
      </motion.div>
    </main>
  );
}
