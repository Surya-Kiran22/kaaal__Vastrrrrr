import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Loader2, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStaffAction } from '@/hooks/useAccount';
import { StaffManagementError } from '@/lib/staff-management';
import type { ProfileRole } from '@/types';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter their email address.').email('Enter a valid email address.'),
  role: z.enum(['staff', 'admin']),
});

type FormValues = z.infer<typeof schema>;

const ROLE_COPY: Record<ProfileRole, string> = {
  staff: 'Can open the dispatch console and change order status. No catalogue or account access.',
  admin: 'Everything staff can do, plus the catalogue, staff accounts and business settings.',
  customer: 'Not assignable from here. Customers are created by signing up, not by an admin.',
};

export function AddStaffDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const staffAction = useStaffAction();
  // Surfaced inline rather than only as a toast: the common failure here is a
  // setup problem (the Edge Function is not deployed), and a toast that
  // disappears in twelve seconds is easy to miss.
  const [setupProblem, setSetupProblem] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', role: 'staff' },
  });

  const role = watch('role');

  const onSubmit = handleSubmit(async (values) => {
    setSetupProblem(null);
    try {
      await staffAction.mutateAsync({ action: 'invite', email: values.email, role: values.role });
      reset();
      onOpenChange(false);
    } catch (error) {
      if (error instanceof StaffManagementError && error.notDeployed) {
        setSetupProblem(error.message);
        return;
      }
      // Anything else is already reported by the mutation's own toast.
    }
  });

  const close = (next: boolean) => {
    if (!next) setSetupProblem(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a staff account</DialogTitle>
          <DialogDescription>
            This creates the sign-in and emails them a one-time setup link. They choose their own
            password when they follow it — no password is ever set or stored by you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <DialogBody className="space-y-5">
            <Field
              label="Email address"
              htmlFor="invite-email"
              required
              error={errors.email?.message}
              hint="The address they will sign in with."
            >
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                placeholder="teammate@example.com"
                {...register('email')}
              />
            </Field>

            <Field
              label="Role"
              htmlFor="invite-role"
              required
              hint={ROLE_COPY[role] ?? ROLE_COPY.staff}
            >
              <Select
                value={role}
                onValueChange={(next) => setValue('role', next as FormValues['role'])}
              >
                <SelectTrigger id="invite-role" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff — dispatch console only</SelectItem>
                  <SelectItem value="admin">Admin — full access</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {role === 'admin' ? (
              <p className="flex items-start gap-2 rounded-lg border border-kv-warning/25 bg-kv-warning/[0.06] px-3.5 py-3 text-2xs leading-relaxed text-kv-warning">
                <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                Admins can change roles and suspend anyone, including you. Give this to people you
                would trust with your own account.
              </p>
            ) : null}

            {setupProblem ? (
              <div className="rounded-lg border border-kv-danger/30 bg-kv-danger/[0.07] px-3.5 py-3">
                <p className="flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Needs setup
                </p>
                <p className="mt-1.5 text-2xs leading-relaxed text-kv-muted">{setupProblem}</p>
              </div>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={staffAction.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={staffAction.isPending}>
              {staffAction.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {staffAction.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Compact trigger for the section header. */
export function AddStaffButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick}>
      <Plus className="h-3.5 w-3.5" />
      Add staff
    </Button>
  );
}
