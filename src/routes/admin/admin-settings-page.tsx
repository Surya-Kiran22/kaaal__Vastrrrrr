import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { MessageCircle, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ErrorState, InlineSpinner, toErrorMessage } from '@/components/ui/states';
import { useUpdateBusinessSettings } from '@/hooks/useAdminMutations';
import { useBusinessSettings } from '@/hooks/useProducts';
import { buildWhatsappChatLink, normaliseWhatsappNumber } from '@/lib/whatsapp';

const optionalUrl = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^https?:\/\/.+/i.test(value),
    'Enter a full URL starting with http:// or https://',
  )
  .optional();

const optionalPhone = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^[+]?[\d\s-]{7,18}$/.test(value),
    'Use digits, spaces, + or - only.',
  )
  .optional();

const schema = z.object({
  business_name: z.string().trim().min(2, 'Business name is required.').max(80),
  tagline: z.string().trim().max(80).optional(),
  description: z.string().trim().max(1000, 'Keep the description under 1000 characters.').optional(),
  whatsapp_number: z
    .string()
    .trim()
    .min(8, 'WhatsApp orders cannot be placed without this number.')
    .max(20)
    .regex(/^\+?[\d\s-]{8,20}$/, 'Use digits, spaces, + or - only.'),
  mobile_number: optionalPhone,
  email: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || z.string().email().safeParse(value).success,
      'Enter a valid email address.',
    )
    .optional(),
  address: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{4,10}$/.test(value), 'Enter 4 to 10 digits.')
    .optional(),
  store_timings: z.string().trim().max(160).optional(),
  gst_number: z.string().trim().max(20).optional(),
  upi_id: z.string().trim().max(80).optional(),
  instagram_url: optionalUrl,
  facebook_url: optionalUrl,
  logo_url: optionalUrl,
  hero_image_url: optionalUrl,
});

type FormValues = z.infer<typeof schema>;

export function AdminSettingsPage() {
  const { data: settings, isPending, isError, error, refetch } = useBusinessSettings();
  const save = useUpdateBusinessSettings();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      business_name: 'Kaal Vastr',
      tagline: '',
      description: '',
      whatsapp_number: '',
      mobile_number: '',
      email: '',
      address: '',
      city: '',
      state: '',
      pincode: '',
      store_timings: '',
      gst_number: '',
      upi_id: '',
      instagram_url: '',
      facebook_url: '',
      logo_url: '',
      hero_image_url: '',
    },
  });

  useEffect(() => {
    if (!settings) return;
    reset({
      business_name: settings.business_name ?? '',
      tagline: settings.tagline ?? '',
      description: settings.description ?? '',
      whatsapp_number: settings.whatsapp_number ?? '',
      mobile_number: settings.mobile_number ?? '',
      email: settings.email ?? '',
      address: settings.address ?? '',
      city: settings.city ?? '',
      state: settings.state ?? '',
      pincode: settings.pincode ?? '',
      store_timings: settings.store_timings ?? '',
      gst_number: settings.gst_number ?? '',
      upi_id: settings.upi_id ?? '',
      instagram_url: settings.instagram_url ?? '',
      facebook_url: settings.facebook_url ?? '',
      logo_url: settings.logo_url ?? '',
      hero_image_url: settings.hero_image_url ?? '',
    });
  }, [settings, reset]);

  const whatsappDraft = watch('whatsapp_number');
  const previewLink = buildWhatsappChatLink(normaliseWhatsappNumber(whatsappDraft));

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({
        ...values,
        tagline: values.tagline || null,
        description: values.description || null,
        mobile_number: values.mobile_number || null,
        email: values.email || null,
        address: values.address || null,
        city: values.city || null,
        state: values.state || null,
        pincode: values.pincode || null,
        store_timings: values.store_timings || null,
        gst_number: values.gst_number || null,
        upi_id: values.upi_id || null,
        instagram_url: values.instagram_url || null,
        facebook_url: values.facebook_url || null,
        logo_url: values.logo_url || null,
        hero_image_url: values.hero_image_url || null,
      });
    } catch (mutationError) {
      toast.error(toErrorMessage(mutationError, 'Could not save settings.'));
    }
  });

  if (isPending) {
    return <InlineSpinner label="Loading business settings…" />;
  }

  // The form is only built from loaded settings, so this has to short-circuit
  // before the form renders. The heading is repeated here deliberately: an admin
  // who cannot load settings should still know which screen they are on.
  if (isError) {
    return (
      <div className="space-y-7">
        <header>
          <p className="eyebrow">Configuration</p>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-kv-white">Business settings</h1>
        </header>
        <ErrorState
          title="Could not load settings"
          message={toErrorMessage(error)}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-7">
      <header>
        <p className="eyebrow">Configuration</p>
        <h1 className="mt-3 font-display text-3xl tracking-tight text-kv-white">Business settings</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-kv-muted">
          These values power the storefront footer, the contact page, the home page hero and every WhatsApp order
          link. Nothing here is hard-coded in the interface, so a change applies everywhere immediately.
        </p>
      </header>

      {/* Identity ------------------------------------------------------- */}
      <Section
        title="Store identity"
        description="Shown in the header, footer and browser tab."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Business name" htmlFor="business_name" required error={errors.business_name?.message}>
            <Input id="business_name" {...register('business_name')} aria-invalid={Boolean(errors.business_name)} />
          </Field>
          <Field label="Tagline" htmlFor="tagline" hint="Short line under the name" error={errors.tagline?.message}>
            <Input id="tagline" placeholder="Dark by design." {...register('tagline')} />
          </Field>
          <Field
            label="About the store"
            htmlFor="description"
            className="sm:col-span-2"
            error={errors.description?.message}
          >
            <Textarea id="description" rows={4} {...register('description')} />
          </Field>
          <Field
            label="Hero image URL"
            htmlFor="hero_image_url"
            className="sm:col-span-2"
            hint="Wide image behind the home page hero"
            error={errors.hero_image_url?.message}
          >
            <Input id="hero_image_url" placeholder="https://…" {...register('hero_image_url')} />
          </Field>
          <Field label="Logo URL" htmlFor="logo_url" className="sm:col-span-2" error={errors.logo_url?.message}>
            <Input id="logo_url" placeholder="https://…" {...register('logo_url')} />
          </Field>
        </div>
      </Section>

      {/* WhatsApp ------------------------------------------------------- */}
      <Section
        title="WhatsApp ordering"
        description="Orders are sent to this number. Store it in international format so the link works everywhere."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="WhatsApp number"
            htmlFor="whatsapp_number"
            required
            hint="e.g. 919876543210"
            error={errors.whatsapp_number?.message}
          >
            <Input
              id="whatsapp_number"
              inputMode="tel"
              placeholder="919876543210"
              className="font-mono"
              aria-invalid={Boolean(errors.whatsapp_number)}
              {...register('whatsapp_number')}
            />
          </Field>
          <Field label="Public mobile number" htmlFor="mobile_number" error={errors.mobile_number?.message}>
            <Input id="mobile_number" inputMode="tel" placeholder="+91 98765 43210" {...register('mobile_number')} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" placeholder="contact@kaalvastr.in" {...register('email')} />
          </Field>
          <Field label="UPI ID" htmlFor="upi_id" hint="Shown as business information only" error={errors.upi_id?.message}>
            <Input id="upi_id" placeholder="kaalvastr@upi" className="font-mono" {...register('upi_id')} />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-kv-line bg-kv-surface px-4 py-3">
          <MessageCircle className="h-4 w-4 shrink-0 text-kv-dim" aria-hidden />
          <p className="flex-1 text-2xs text-kv-muted">
            {previewLink
              ? 'Customers will be redirected to this chat when they place an order.'
              : 'Enter a valid number to enable WhatsApp ordering.'}
          </p>
          {previewLink ? (
            <Button asChild variant="whatsapp" size="sm">
              <a href={previewLink} target="_blank" rel="noopener noreferrer">
                Test link
              </a>
            </Button>
          ) : null}
        </div>
      </Section>

      {/* Location ------------------------------------------------------- */}
      <Section title="Store location" description="Appears on the contact page and in the footer.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Street address" htmlFor="address" className="sm:col-span-2" error={errors.address?.message}>
            <Input id="address" placeholder="104, Obsidian Avenue, Khar West" {...register('address')} />
          </Field>
          <Field label="City" htmlFor="city" error={errors.city?.message}>
            <Input id="city" placeholder="Mumbai" {...register('city')} />
          </Field>
          <Field label="State" htmlFor="state" error={errors.state?.message}>
            <Input id="state" placeholder="Maharashtra" {...register('state')} />
          </Field>
          <Field label="PIN code" htmlFor="pincode" error={errors.pincode?.message}>
            <Input id="pincode" inputMode="numeric" placeholder="400052" {...register('pincode')} />
          </Field>
          <Field label="Store timings" htmlFor="store_timings" error={errors.store_timings?.message}>
            <Input
              id="store_timings"
              placeholder="Mon - Sat: 11:00 AM - 9:00 PM | Sun: 12:00 PM - 7:00 PM"
              {...register('store_timings')}
            />
          </Field>
          <Field label="GSTIN" htmlFor="gst_number" className="sm:col-span-2" error={errors.gst_number?.message}>
            <Input id="gst_number" className="font-mono" placeholder="27ABCDE1234F1Z5" {...register('gst_number')} />
          </Field>
        </div>
      </Section>

      {/* Social --------------------------------------------------------- */}
      <Section title="Social links" description="Shown in the footer and contact page. Leave blank to hide.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Instagram URL" htmlFor="instagram_url" error={errors.instagram_url?.message}>
            <Input id="instagram_url" placeholder="https://instagram.com/kaalvastr" {...register('instagram_url')} />
          </Field>
          <Field label="Facebook URL" htmlFor="facebook_url" error={errors.facebook_url?.message}>
            <Input id="facebook_url" placeholder="https://facebook.com/kaalvastr" {...register('facebook_url')} />
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-3 border-t border-kv-line bg-kv-bg/90 px-5 py-4 backdrop-blur-xl">
        <p className="text-2xs text-kv-dim">{isDirty ? 'You have unsaved changes.' : 'No pending changes.'}</p>
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          <Save className="h-4 w-4" />
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-kv-line bg-kv-card p-6">
      <div className="mb-6">
        <h2 className="font-display text-lg tracking-tight text-kv-white">{title}</h2>
        {description ? <p className="mt-1.5 text-xs text-kv-dim">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
