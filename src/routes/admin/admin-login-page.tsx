import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
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

export interface AdminLoginSearch {
  redirect?: string;
  reason?: 'forbidden';
}

export function AdminLoginPage() {
  const search = useSearch({ from: '/admin/login' });
  const navigate = useNavigate();
  const { signIn, signOut, isAuthenticated, isAdmin } = useAuth();
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

  // Already signed in as an admin — skip the form.
  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      void navigate({ to: '/admin', replace: true });
    }
  }, [isAuthenticated, isAdmin, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const profile = await signIn(values.email, values.password);
      if (!profile || profile.role !== 'admin' || !profile.is_active || profile.status !== 'active') {
        // Do not leave a non-admin holding a valid session in this browser.
        await signOut();
        throw new Error('This account does not have store admin access.');
      }
      const target = search.redirect?.startsWith('/admin') ? search.redirect : '/admin';
      void navigate({ to: target, replace: true });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Sign in failed. Check your email and password.',
      );
    }
  });

  return (
    <div className="relative flex min-h-[calc(100dvh-6rem)] items-center justify-center px-5 py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.14), transparent 55%)',
        }}
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Back to store
          </Link>
          <h1 className="mt-7 font-display text-3xl tracking-tight text-kv-white">Store admin</h1>
          <p className="mt-3 text-sm text-kv-muted">
            Sign in to manage Kaal Vastr products, images and business settings.
          </p>
        </div>

        <div className="edge-light rounded-2xl border border-kv-line bg-kv-card p-7 shadow-glow">
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
                That account is signed in but does not have product-management access. Ask a store owner to
                promote it to <strong>admin</strong>.
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
          </form>

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
    </div>
  );
}
