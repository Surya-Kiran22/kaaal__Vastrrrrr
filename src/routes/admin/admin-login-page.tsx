import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { authController, isConsoleRole } from '@/lib/auth-controller';
import { isSupabaseConfigured } from '@/lib/env';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

type FormValues = z.infer<typeof schema>;

export interface AdminLoginSearch {
  redirect?: string;
  reason?: 'forbidden';
}

export function AdminLoginPage() {
  const search = useSearch({ from: '/admin/login' });
  const navigate = useNavigate();
  const { signIn, signOut, isAuthenticated, isAdmin, isStaff } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /*
   * Recovery is requested here as well as on the customer form. This page is the
   * only console door, so staff reset emails come back to a console URL — they are
   * redirected on to /admin/reset-password, which is where a new password is set.
   */
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Already holding a console session — skip the form and go to the right console.
  useEffect(() => {
    if (isAuthenticated && (isAdmin || isStaff)) {
      void navigate({ to: (isAdmin ? '/admin' : '/staff') as never, replace: true });
    }
  }, [isAuthenticated, isAdmin, isStaff, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    if (recoveryMode) {
      try {
        await authController.requestPasswordReset(
          values.email,
          `${window.location.origin}/admin/reset-password`,
        );
        setRecoverySent(true);
        toast.success('Check the inbox for the reset link.');
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Could not send the reset email.');
      }
      return;
    }

    try {
      const profile = await signIn(values.email, values.password);

      /*
       * One console door for both console roles.
       *
       * Staff sign in here as well as admin, deliberately: this page is
       * independent of the customer account area, so if the shop front ever
       * needs rescuing -- a broken customer guard, a bad cart, anything that
       * makes /account unusable -- there is still exactly one known-good way in.
       *
       * `isConsoleRole` mirrors the `requireConsole` guard in the router, so a
       * successful sign-in here means the destination route will accept the
       * session rather than bouncing straight back to this form.
       */
      if (
        !profile ||
        !isConsoleRole(profile.role) ||
        !profile.is_active ||
        profile.status !== 'active'
      ) {
        // Do not leave a customer holding a valid console session in this browser.
        await signOut();
        throw new Error('This account does not have store console access.');
      }

      // Honour an explicit redirect only if it points at a console route, so a
      // crafted ?redirect= cannot bounce a freshly signed-in operator off-site.
      const requested = search.redirect;
      const target =
        requested && (requested.startsWith('/admin') || requested.startsWith('/staff'))
          ? requested
          : profile.role === 'admin'
            ? '/admin'
            : '/staff';

      void navigate({ to: target as never, replace: true });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Sign in failed. Check your email and password.',
      );
    }
  });

  return (
    <main
      id="main"
      data-console
      className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-32 top-10 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -right-32 bottom-10 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-kv-line-strong">
            <span className="gold-text font-display text-2xl tracking-[0.3em]">KV</span>
          </div>
          <h1 className="mt-6 text-3xl font-medium">Kaal Vastr</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.4em] text-kv-muted">Command Centre</p>
          <p className="mt-4 text-sm text-kv-muted">
            The single door to the dispatch and admin consoles. Customers sign in on the{' '}
            <Link to="/account/login" className="underline underline-offset-2 hover:text-kv-silver">
              account page
            </Link>
            .
          </p>
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
              Supabase is not configured. Copy <code className="font-mono">.env.example</code> to{' '}
              <code className="font-mono">.env</code>, add your project URL and anon key, then restart the dev
              server.
            </div>
          ) : null}

          {search.reason === 'forbidden' ? (
            <div className="mb-6 flex gap-3 rounded-xl border border-kv-warning/30 bg-kv-warning/[0.08] p-4 text-sm text-kv-warning">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                That account is signed in but does not have console access. Ask a store owner to
                promote it to <strong>staff</strong> or <strong>admin</strong>.
              </span>
            </div>
          ) : null}

          {formError ? (
            <div
              role="alert"
              className="mb-6 flex gap-3 rounded-xl border border-kv-danger/30 bg-kv-danger/[0.08] p-4 text-sm text-kv-danger"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          ) : null}

          {recoverySent ? (
            <div className="rounded-xl border border-kv-success/30 bg-kv-success/[0.08] p-4 text-sm text-kv-success">
              If that email is registered, a reset link is on its way. The link opens this page.
            </div>
          ) : recoveryMode ? (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <p className="text-sm text-kv-muted">
                Enter your console email and we will send you a reset link.
              </p>
              <Field label="Email" htmlFor="admin-recovery-email" required error={errors.email?.message}>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                    aria-hidden
                  />
                  <Input
                    id="admin-recovery-email"
                    type="email"
                    autoComplete="email"
                    placeholder="owner@kaalvastr.in"
                    className="pl-10"
                    aria-invalid={Boolean(errors.email)}
                    {...register('email')}
                  />
                </div>
              </Field>
              <Button type="submit" block loading={isSubmitting} loadingText="Sending…">
                Send reset link
              </Button>
              <button
                type="button"
                onClick={() => {
                  setRecoveryMode(false);
                  setRecoverySent(false);
                }}
                className="w-full text-center text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
              >
                Back to sign in
              </button>
            </form>
          ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <Field label="Email" htmlFor="admin-email" required error={errors.email?.message}>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="owner@kaalvastr.in"
                  className="pl-10"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="admin-password" required error={errors.password?.message}>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  className="pl-10 pr-11"
                  aria-invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-kv-dim transition-colors hover:text-kv-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <Button
              type="submit"
              block
              size="lg"
              loading={isSubmitting}
              loadingText="Signing in…"
              disabled={!isSupabaseConfigured}
            >
              <Lock className="h-4 w-4" />
              Sign in
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setRecoveryMode(true)}
                className="text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
              >
                Forgot password
              </button>
            </div>
          </form>
          )}

          <p className="mt-6 flex items-start gap-2 border-t border-kv-line pt-5 text-2xs leading-relaxed text-kv-dim">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Staff and admin accounts are created by a store owner from the{' '}
            <Link to="/admin/accounts" className="underline underline-offset-2 hover:text-kv-silver">
              Accounts
            </Link>{' '}
            screen. Public registration can never reach this area.
          </p>
        </div>
        </motion.div>
      </main>
    );
  }
