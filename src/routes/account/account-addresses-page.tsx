import { zodResolver } from '@hookform/resolvers/zod';
import { Check, MapPin, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { EmptyState, ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import {
  useAddresses,
  useDeleteAddress,
  useSaveAddress,
  useSetDefaultAddress,
} from '@/hooks/useAccount';
import { formatDeliveryAddress } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import type { Address, AddressDraft } from '@/types';

const schema = z.object({
  label: z.string().trim().min(1, 'Give this address a name.').max(40),
  full_name: z.string().trim().min(2, 'Enter the recipient name.').max(80),
  phone: z
    .string()
    .trim()
    .min(10, 'Enter a 10-digit mobile number.')
    .max(15)
    .regex(/^[+]?[\d\s-]{10,15}$/, 'Use digits, spaces, + or - only.'),
  line1: z.string().trim().min(4, 'Enter the flat or house and street.').max(120),
  line2: z.string().trim().max(120).optional().or(z.literal('')),
  landmark: z.string().trim().max(80).optional().or(z.literal('')),
  city: z.string().trim().min(2, 'Enter the city.').max(60),
  state: z.string().trim().min(2, 'Enter the state.').max(60),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter a 6-digit PIN code.'),
  is_default: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const BLANK: FormValues = {
  label: 'Home',
  full_name: '',
  phone: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
  pincode: '',
  is_default: false,
};

export function AccountAddressesPage() {
  const addresses = useAddresses();
  const save = useSaveAddress();
  const remove = useDeleteAddress();
  const makeDefault = useSetDefaultAddress();

  const [editing, setEditing] = useState<Address | null>(null);
  const [creating, setCreating] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: BLANK });

  const openCreate = () => {
    setEditing(null);
    reset(BLANK);
    setCreating(true);
  };

  const openEdit = (address: Address) => {
    setCreating(false);
    setEditing(address);
    reset({
      label: address.label,
      full_name: address.full_name,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 ?? '',
      landmark: address.landmark ?? '',
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      is_default: address.is_default,
    });
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
    reset(BLANK);
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({
        id: editing?.id,
        draft: values as unknown as AddressDraft,
      });
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the address.');
    }
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight text-kv-white">Saved addresses</h2>
          <p className="mt-1 text-sm text-kv-muted">
            Your default address is offered automatically at checkout.
          </p>
        </div>
        {!creating && !editing ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add address
          </Button>
        ) : null}
      </div>

      {creating || editing ? (
        <form
          onSubmit={onSubmit}
          noValidate
          className="edge-light rounded-2xl border border-kv-line bg-kv-card p-7 shadow-glow"
        >
          <h3 className="font-display text-lg text-kv-white">
            {editing ? 'Edit address' : 'New address'}
          </h3>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field label="Label" htmlFor="addr-label" required error={errors.label?.message}>
              <Input id="addr-label" placeholder="Home, Office…" {...register('label')} />
            </Field>
            <Field label="Recipient name" htmlFor="addr-name" required error={errors.full_name?.message}>
              <Input id="addr-name" autoComplete="name" {...register('full_name')} />
            </Field>
            <Field label="Mobile number" htmlFor="addr-phone" required error={errors.phone?.message}>
              <Input id="addr-phone" type="tel" inputMode="tel" autoComplete="tel" {...register('phone')} />
            </Field>
            <Field label="PIN code" htmlFor="addr-pin" required error={errors.pincode?.message}>
              <Input id="addr-pin" inputMode="numeric" maxLength={6} {...register('pincode')} />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Flat, house and street" htmlFor="addr-line1" required error={errors.line1?.message}>
                <Input id="addr-line1" autoComplete="address-line1" {...register('line1')} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Area, building or block" htmlFor="addr-line2" hint="Optional" error={errors.line2?.message}>
                <Input id="addr-line2" autoComplete="address-line2" {...register('line2')} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Landmark" htmlFor="addr-landmark" hint="Optional" error={errors.landmark?.message}>
                <Input id="addr-landmark" placeholder="Near the water tower" {...register('landmark')} />
              </Field>
            </div>

            <Field label="City" htmlFor="addr-city" required error={errors.city?.message}>
              <Input id="addr-city" autoComplete="address-level2" {...register('city')} />
            </Field>
            <Field label="State" htmlFor="addr-state" required error={errors.state?.message}>
              <Input id="addr-state" autoComplete="address-level1" {...register('state')} />
            </Field>
          </div>

          <label className="mt-5 flex items-center gap-2.5 text-sm text-kv-silver">
            <input type="checkbox" className="accent-kv-white" {...register('is_default')} />
            Use as my default delivery address
          </label>

          <div className="mt-7 flex gap-3">
            <Button type="submit" loading={isSubmitting || save.isPending} loadingText="Saving…">
              <Check className="h-4 w-4" />
              Save address
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <ErrorBoundary label="your addresses" onRetry={() => void addresses.refetch()}>
        {/*
          The add form above stays usable while this fails, so a dropped
          connection on the list must not take the whole screen down with it.
        */}
        {addresses.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ) : addresses.isError ? (
          <ErrorState
            title="Could not load your addresses"
            message={toErrorMessage(addresses.error)}
            onRetry={() => void addresses.refetch()}
          />
        ) : addresses.data && addresses.data.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {addresses.data.map((address) => (
              <li
                key={address.id}
                className={cn(
                  'flex flex-col rounded-2xl border bg-kv-card p-5 transition-colors',
                  address.is_default ? 'border-kv-white/25' : 'border-kv-line',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-kv-white">
                      <MapPin className="h-3.5 w-3.5 text-kv-dim" aria-hidden />
                      {address.label}
                      {address.is_default ? (
                        <span className="text-2xs uppercase tracking-widest text-kv-dim">Default</span>
                      ) : null}
                    </p>
                    <p className="mt-2 text-xs text-kv-silver">
                      {address.full_name} · {address.phone}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-kv-muted">
                      {formatDeliveryAddress(address).join(', ')}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-kv-line pt-4">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(address)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  {!address.is_default ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => makeDefault.mutate(address.id)}
                      disabled={makeDefault.isPending}
                    >
                      <Star className="h-3.5 w-3.5" />
                      Make default
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-kv-danger hover:text-kv-danger"
                    onClick={() => remove.mutate(address.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            title="No saved addresses"
            description="Save one now and checkout will fill it in for you."
            action={<Button onClick={openCreate}>Add your first address</Button>}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}
