import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/lib/format';

/** Only the display name is editable. Email and phone are deliberately absent. */
const schema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Please enter your name.')
    .max(80, 'Name looks too long.'),
});

type FormValues = z.infer<typeof schema>;

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export function AccountPage() {
  const { profile, refreshProfile, updateOwnProfile, uploadOwnAvatar, updateOwnAvatar } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: profile?.full_name ?? '' },
  });

  // The profile arrives after the first paint, so seed the form once it does.
  useEffect(() => {
    reset({ fullName: profile?.full_name ?? '' });
  }, [profile?.id, profile?.full_name, reset]);

  const username = profile?.username ?? '';
  const initial =
    username.charAt(0).toUpperCase() ||
    profile?.full_name?.trim()?.charAt(0).toUpperCase() ||
    profile?.email?.charAt(0).toUpperCase() ||
    '';

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateOwnProfile({ fullName: values.fullName });
      await refreshProfile();
      toast.success('Profile updated');
      reset({ fullName: values.fullName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update your profile.');
    }
  });

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;

    // Checked here as well as in the controller so an oversized or unsupported
    // file fails instantly instead of after a slow round trip.
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error('Profile photos must be 2 MB or smaller.');
      return;
    }
    if (!AVATAR_TYPES.includes(file.type)) {
      toast.error('Use a JPEG, PNG, WebP or AVIF image.');
      return;
    }

    setUploading(true);
    try {
      await uploadOwnAvatar(file);
      await refreshProfile();
      toast.success('Profile photo updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload that photo.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-8">
        <form
          onSubmit={onSubmit}
          noValidate
          className="edge-light rounded-2xl border border-kv-line bg-kv-card p-7 shadow-glow"
        >
          <h2 className="font-display text-xl tracking-tight text-kv-white">Your details</h2>
          <p className="mt-2 text-sm text-kv-muted">
            Used on your orders and on the WhatsApp messages we prepare for the store.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-5">
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-kv-line bg-kv-surface">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="font-display text-2xl text-kv-silver">{initial}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                aria-label="Change profile photo"
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-kv-line bg-kv-card text-kv-silver transition-colors hover:border-kv-lineStrong hover:text-kv-white disabled:opacity-50"
              >
                <Camera className="h-4 w-4" aria-hidden />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={AVATAR_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => void onPickAvatar(event.target.files?.[0])}
              />
            </div>

            <div className="min-w-0">
              <p className="text-2xs uppercase tracking-widest text-kv-dim">Username</p>
              {/* Generated once from the full name at signup and never editable. */}
              <p className="mt-1 truncate font-mono text-sm text-kv-white">
                {username || 'Generating…'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  loading={uploading}
                  loadingText="Uploading…"
                >
                  {profile?.avatar_url ? 'Replace photo' : 'Upload a photo'}
                </Button>
                {profile?.avatar_url ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await updateOwnAvatar(null);
                        await refreshProfile();
                        toast.success('Profile photo removed');
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : 'Could not remove that photo.',
                        );
                      }
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <Field label="Full name" htmlFor="acct-name" required error={errors.fullName?.message}>
              <Input
                id="acct-name"
                autoComplete="name"
                aria-invalid={Boolean(errors.fullName)}
                {...register('fullName')}
              />
            </Field>

            {/*
              Locked at signup by migration 019: `phone` was dropped from the
              column-level UPDATE grant, so a self-service edit would fail with a
              permission error. Shown read-only with the reason spelled out.
            */}
            <Field
              label="Mobile number"
              htmlFor="acct-phone"
              hint="Locked after signup"
            >
              <Input id="acct-phone" type="tel" value={profile?.phone ?? '—'} readOnly disabled />
            </Field>

            <Field label="Email" htmlFor="acct-email" hint="Locked after signup">
              <Input id="acct-email" value={profile?.email ?? ''} readOnly disabled />
            </Field>

            <p className="flex items-start gap-2 text-2xs leading-relaxed text-kv-dim">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              Your email and mobile number are used to sign in and to reach you about a delivery, so
              they cannot be changed from here. Contact the store if one is wrong.
            </p>

            <Button type="submit" loading={isSubmitting} loadingText="Saving…" disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        </form>
      </div>

      <aside className="space-y-4">
        {!profile?.email_verified_at ? (
          <div className="rounded-2xl border border-kv-warning/30 bg-kv-warning/[0.08] p-5">
            <p className="flex items-center gap-2 text-sm text-kv-warning">
              <TriangleAlert className="h-4 w-4" aria-hidden />
              Email not verified
            </p>
            <p className="mt-2 text-xs leading-relaxed text-kv-muted">
              You can browse, but ordering and WhatsApp checkout stay locked until you confirm your
              email.
            </p>
          </div>
        ) : null}

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
