import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured } from '@/lib/env';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

type FormValues = z.infer<typeof schema>;

export interface StaffLoginSearch {
  redirect?: string;
  reason?: 'forbidden';
}

/**
 * Separate entrance for staff and admins.
 *
 * `signInForConsole` refuses any account that is not an active staff member or
 * admin and signs the session straight back out, so a customer who finds this
 * URL cannot end up holding a token.
 */
export function StaffLoginPage() {
  const search = useSearch({ from: '/staff/login' });
  const navigate = useNavigate();
  const { signInForConsole, isAuthenticated, canUseConsole, isAdmin } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Someone who already holds a console session should not sit on this form.
  // Admins go to their own dashboard, staff to the dispatch log.
  useEffect(() => {
    if (isAuthenticated && canUseConsole) {
      void navigate({ to: isAdmin ? '/admin' : '/staff', replace: true });
    }
  }, [isAuthenticated, canUseConsole, isAdmin, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const profile = await signInForConsole(values.email, values.password);
      // Admins are sent to their dashboard; staff to the dispatch console.
      void navigate({
        to: profile.role === 'admin' ? '/admin' : '/staff',
        replace: true,
      });
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

        <h1 className="mt-7 font-display text-3xl tracking-tight text-kv-white">Dispatch console</h1>
        <p className="mt-3 text-sm text-kv-muted">
          For store staff. Customers should use the sign-in on the main store.
        </p>

        <div className="edge-light mt-8 rounded-2xl border border-kv-line bg-kv-card p-7 shadow-glow">
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
              <span>That account is not an active staff member. Ask a store owner to restore access.</span>
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

          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <Field label="Work email" htmlFor="staff-email" required error={errors.email?.message}>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="staff-email"
                  type="email"
                  autoComplete="email"
                  className="pl-10"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="staff-password" required error={errors.password?.message}>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
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
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-2xs text-kv-dim">
          Customer?{' '}
          <Link to="/account/login" className="underline underline-offset-2 hover:text-kv-silver">
            Sign in to your account
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
