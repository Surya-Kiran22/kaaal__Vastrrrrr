import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { authController } from '@/lib/auth-controller';
import { formatDateTime } from '@/lib/format';

const schema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Please enter your name.')
    .max(80, 'Name looks too long.'),
  phone: z
    .string()
    .trim()
    .max(15, 'Phone number looks too long.')
    .regex(/^[+]?[\d\s-]{10,15}$/, 'Use digits, spaces, + or - only.')
    .optional()
    .or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export function AccountPage() {
  const { profile, refreshProfile } = useAuth();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: profile?.full_name ?? '', phone: profile?.phone ?? '' },
  });

  // The profile arrives after the first paint, so seed the form once it does.
  useEffect(() => {
    reset({ fullName: profile?.full_name ?? '', phone: profile?.phone ?? '' });
  }, [profile?.id, profile?.full_name, profile?.phone, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await authController.updateOwnProfile({ fullName: values.fullName, phone: values.phone ?? '' });
      await refreshProfile();
      toast.success('Profile updated');
      reset({ fullName: values.fullName, phone: values.phone ?? '' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update your profile.');
    }
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form
        onSubmit={onSubmit}
        noValidate
        className="edge-light rounded-2xl border border-kv-line bg-kv-card p-7 shadow-glow"
      >
        <h2 className="font-display text-xl tracking-tight text-kv-white">Your details</h2>
        <p className="mt-2 text-sm text-kv-muted">
          Used on your orders and on the WhatsApp messages we prepare for the store.
        </p>

        <div className="mt-6 space-y-5">
          <Field label="Full name" htmlFor="acct-name" required error={errors.fullName?.message}>
            <Input
              id="acct-name"
              autoComplete="name"
              aria-invalid={Boolean(errors.fullName)}
              {...register('fullName')}
            />
          </Field>

          <Field
            label="Mobile number"
            htmlFor="acct-phone"
            hint="Optional"
            error={errors.phone?.message}
          >
            <Input
              id="acct-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(errors.phone)}
              {...register('phone')}
            />
          </Field>

          <Field label="Email" htmlFor="acct-email" hint="Contact the store to change this">
            <Input id="acct-email" value={profile?.email ?? ''} readOnly disabled />
          </Field>

          <Button type="submit" loading={isSubmitting} loadingText="Saving…" disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      </form>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-kv-line bg-kv-surface/40 p-5">
          <p className="eyebrow">Account</p>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-kv-dim">Role</dt>
              <dd className="text-kv-white capitalize">{profile?.role}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-kv-dim">Email verified</dt>
              <dd className={profile?.email_verified_at ? 'text-kv-success' : 'text-kv-warning'}>
                {profile?.email_verified_at ? 'Yes' : 'Not yet'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-kv-dim">Member since</dt>
              <dd className="text-kv-silver">{formatDateTime(profile?.created_at)}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
