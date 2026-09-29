import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { AuthError, authController, isConsoleRole } from '@/lib/auth-controller';
import { isSupabaseConfigured } from '@/lib/env';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

type FormValues = z.infer<typeof schema>;

export interface AccountLoginSearch {
  redirect?: string;
  mode?: 'signin' | 'signup' | 'recovery';
}

export function AccountLoginPage() {
  const search = useSearch({ from: '/account/login' });
  const navigate = useNavigate();
  const { signIn, signOut } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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

  /** Only same-site paths are honoured, so a crafted link cannot bounce a
   *  freshly signed-in customer to an attacker's page. */
  const safeRedirect = (): string => {
    const target = search.redirect;
    return target && target.startsWith('/') && !target.startsWith('//') ? target : '/account';
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    if (recoveryMode) {
      try {
        await authController.requestPasswordReset(
          values.email,
          `${window.location.origin}/account/login`,
        );
        setRecoverySent(true);
        toast.success('Check your inbox for the reset link.');
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Could not send the reset email.');
      }
      return;
    }

    try {
      const profile = await signIn(values.email, values.password);

      // Staff and admin sign in at /admin/login only. A console account that
      // lands here is signed straight back out so it never holds a customer
      // session, and the failure is reported with the *password* error on
      // purpose: telling them "that is a staff account, use the other page"
      // would turn this form into a way to confirm which addresses hold
      // console roles. Staying vague is what makes the isolation work, and it
      // also keeps this form from leaking role information to strangers.
      if (isConsoleRole(profile?.role)) {
        await signOut();
        throw new AuthError(
          'That email and password combination is not recognised.',
          'invalid_credentials',
        );
      }

      void navigate({ to: safeRedirect() as never, replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Sign in failed.');
    }
  });

  return (
    <div className="container-kv flex min-h-[70dvh] items-center justify-center py-16">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Back to store
        </Link>

        <h1 className="mt-7 font-display text-3xl tracking-tight text-kv-white">
          {recoveryMode ? 'Reset your password' : 'Welcome back'}
        </h1>
        <p className="mt-3 text-sm text-kv-muted">
          {recoveryMode
            ? 'Enter the email you registered with and we will send you a reset link.'
            : 'Sign in to see your orders, saved addresses and order history.'}
        </p>

        <div className="edge-light mt-8 rounded-2xl border border-kv-line bg-kv-card p-7 shadow-glow">
          {!isSupabaseConfigured ? (
            <div className="mb-6 rounded-xl border border-kv-danger/30 bg-kv-danger/[0.08] p-4 text-sm text-kv-danger">
              Supabase is not configured. Copy <code className="font-mono">.env.example</code> to{' '}
              <code className="font-mono">.env</code>, add your project URL and anon key, then restart the dev
              server.
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
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <Field label="Email" htmlFor="login-email" required error={errors.email?.message}>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                    aria-hidden
                  />
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="pl-10"
                    aria-invalid={Boolean(errors.email)}
                    {...register('email')}
                  />
                </div>
              </Field>

              {!recoveryMode ? (
                <Field label="Password" htmlFor="login-password" required error={errors.password?.message}>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                      aria-hidden
                    />
                    <Input
                      id="login-password"
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
              ) : null}

              <Button
                type="submit"
                block
                size="lg"
                loading={isSubmitting}
                loadingText={recoveryMode ? 'Sending…' : 'Signing in…'}
                disabled={!isSupabaseConfigured}
              >
                {recoveryMode ? 'Send reset link' : 'Sign in'}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setRecoveryMode((prev) => !prev);
                  setFormError(null);
                }}
                className="w-full text-center text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
              >
                {recoveryMode ? 'Back to sign in' : 'Forgot your password?'}
              </button>
            </form>
          )}
        </div>

        {!recoveryMode ? (
          <p className="mt-6 text-center text-sm text-kv-muted">
            New here?{' '}
            <Link
              to="/account/register"
              search={{ redirect: search.redirect }}
              className="text-kv-white underline underline-offset-4"
            >
              Create an account
            </Link>
          </p>
        ) : null}

        <p className="mt-4 text-center text-2xs text-kv-dim">
          Staff member?{' '}
          <Link to="/staff/login" className="underline underline-offset-2 hover:text-kv-silver">
            Use the dispatch console
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
