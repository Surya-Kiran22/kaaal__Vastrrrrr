import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { authController } from '@/lib/auth-controller';
import { isSupabaseConfigured } from '@/lib/env';

const schema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Please tell us your name.')
      .max(80, 'Name looks too long.'),
    phone: z
      .string()
      .trim()
      .max(15, 'Phone number looks too long.')
      .regex(/^[+]?[\d\s-]{10,15}$/, 'Use digits, spaces, + or - only.')
      .optional()
      .or(z.literal('')),
    email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(72, 'Password is too long.')
      .regex(/[a-zA-Z]/, 'Include at least one letter.')
      .regex(/\d/, 'Include at least one number.'),
    confirmPassword: z.string().min(1, 'Re-enter your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  });

type FormValues = z.infer<typeof schema>;

export interface AccountRegisterSearch {
  redirect?: string;
}

export function AccountRegisterPage() {
  const search = useSearch({ from: '/account/register' });
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Held between signup and code entry so the user does not retype their email. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', phone: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await authController.signUp({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        phone: values.phone ?? '',
      });

      if (result.needsVerification) {
        setPendingEmail(values.email);
        return;
      }

      // Email confirmations are switched off, so the account is already usable.
      await refreshProfile();
      void navigate({ to: '/account/verify', search: { email: values.email, justSignedUp: '1' } });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create your account.');
    }
  });

  if (pendingEmail) {
    return (
      <div className="container-kv flex min-h-[70dvh] items-center justify-center py-16">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md text-center"
        >
          <h1 className="font-display text-3xl tracking-tight text-kv-white">Check your inbox</h1>
          <p className="mt-3 text-sm leading-relaxed text-kv-muted">
            We sent a 6-digit verification code to <strong className="text-kv-white">{pendingEmail}</strong>.
            Enter it to finish creating your account.
          </p>
          <Button
            className="mt-8"
            size="lg"
            onClick={() =>
              void navigate({ to: '/account/verify', search: { email: pendingEmail, justSignedUp: '1' } })
            }
          >
            Enter the code
          </Button>
          <p className="mt-6 text-2xs text-kv-dim">
            Wrong address?{' '}
            <button
              type="button"
              onClick={() => setPendingEmail(null)}
              className="underline underline-offset-2 hover:text-kv-silver"
            >
              Go back
            </button>
          </p>
        </motion.div>
      </div>
    );
  }

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
          search={{ redirect: search.redirect }}
          className="inline-flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Back to sign in
        </Link>

        <h1 className="mt-7 font-display text-3xl tracking-tight text-kv-white">Create your account</h1>
        <p className="mt-3 text-sm text-kv-muted">
          One account for your cart, saved delivery addresses and order history.
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

          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <Field label="Full name" htmlFor="reg-name" required error={errors.fullName?.message}>
              <div className="relative">
                <UserRound
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="reg-name"
                  autoComplete="name"
                  placeholder="Aarav Sharma"
                  className="pl-10"
                  aria-invalid={Boolean(errors.fullName)}
                  {...register('fullName')}
                />
              </div>
            </Field>

            <Field
              label="Mobile number"
              htmlFor="reg-phone"
              hint="Optional, for order updates"
              error={errors.phone?.message}
            >
              <div className="relative">
                <Phone
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="reg-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="98765 43210"
                  className="pl-10"
                  aria-invalid={Boolean(errors.phone)}
                  {...register('phone')}
                />
              </div>
            </Field>

            <Field label="Email" htmlFor="reg-email" required error={errors.email?.message}>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="pl-10"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </div>
            </Field>

            <Field
              label="Password"
              htmlFor="reg-password"
              required
              hint="At least 8 characters, with a letter and a number"
              error={errors.password?.message}
            >
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                  aria-hidden
                />
                <Input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
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

            <Field label="Confirm password" htmlFor="reg-confirm" required error={errors.confirmPassword?.message}>
              <Input
                id="reg-confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirmPassword)}
                {...register('confirmPassword')}
              />
            </Field>

            <Button
              type="submit"
              block
              size="lg"
              loading={isSubmitting}
              loadingText="Creating your account…"
              disabled={!isSupabaseConfigured}
            >
              Create account
            </Button>
          </form>

          <p className="mt-6 border-t border-kv-line pt-5 text-2xs leading-relaxed text-kv-dim">
            We will email you a 6-digit code to confirm your address. New accounts are always{' '}
            <strong className="text-kv-silver">customers</strong> — staff access is granted separately by the
            store.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
