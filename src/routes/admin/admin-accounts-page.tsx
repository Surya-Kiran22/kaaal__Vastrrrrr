import { Ban, CheckCircle2, KeyRound, Mail, Send, ShieldCheck, UserCog, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { EmptyState, ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import { StaggerItem, StaggerList } from '@/components/ui/reveal';
import {
  useSetAccountRole,
  useStaffAccounts,
  useStaffAction,
  useStaffEvents,
} from '@/hooks/useAccount';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ProfileRole, StaffAccount } from '@/types';
import { AddStaffButton, AddStaffDialog } from './add-staff-dialog';

const STATUS_TONE = {
  active: 'success',
  invited: 'warning',
  suspended: 'danger',
} as const;

export function AdminAccountsPage() {
  const { profile } = useAuth();
  const [includeCustomers, setIncludeCustomers] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const accounts = useStaffAccounts(includeCustomers);
  const events = useStaffEvents(12);
  const setRole = useSetAccountRole();
  const staffAction = useStaffAction();

  const staff = (accounts.data ?? []).filter(
    (account) => account.role === 'staff' || account.role === 'admin',
  );

  const changeRole = async (account: StaffAccount, role: ProfileRole) => {
    try {
      await setRole.mutateAsync({ email: account.email, role, suspend: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change that role.');
    }
  };

  const toggleSuspension = async (account: StaffAccount) => {
    const suspend = account.status !== 'suspended';
    try {
      // The role must be re-supplied: the function always applies one.
      await setRole.mutateAsync({ email: account.email, role: account.role, suspend });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update that account.');
    }
  };

  /**
   * Resend the setup link to an invited account, or send a password reset to
   * one that has already set a password. Both go through the function, which
   * refuses a suspended account and records the attempt either way.
   */
  const sendLink = async (account: StaffAccount) => {
    try {
      await staffAction.mutateAsync({
        action: account.status === 'invited' ? 'resend' : 'reset',
        email: account.email,
      });
    } catch {
      // The mutation reports its own failures.
    }
  };

  /** Confirm an invited account without waiting for an email. */
  const confirmAccount = async (account: StaffAccount) => {
    try {
      await staffAction.mutateAsync({ action: 'activate', email: account.email });
    } catch {
      // The mutation reports its own failures.
    }
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-kv-white">Staff &amp; admin accounts</h1>
        <p className="mt-2 text-sm text-kv-muted">
          Every account that can reach the dispatch console or this dashboard. Passwords are never displayed or
          stored in readable form.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg text-kv-white">
            <ShieldCheck className="h-4 w-4 text-kv-dim" aria-hidden />
            Console access
          </h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim">
              <input
                type="checkbox"
                className="accent-kv-white"
                checked={includeCustomers}
                onChange={(event) => setIncludeCustomers(event.target.checked)}
              />
              Include customer accounts
            </label>
            <AddStaffButton onClick={() => setInviteOpen(true)} />
          </div>
        </div>

        <AddStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} />

        <ErrorBoundary label="the account list" onRetry={() => void accounts.refetch()}>
          {/*
            Tested before the empty state on purpose. A failed query must not
            read as "No accounts yet", or an admin would conclude every staff
            account had been deleted.
          */}
          {accounts.isPending ? (
            <div className="space-y-3">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-20 w-full rounded-2xl" />
              ))}
            </div>
          ) : accounts.isError ? (
            <ErrorState
              title="Could not load accounts"
              message={toErrorMessage(accounts.error)}
              onRetry={() => void accounts.refetch()}
            />
          ) : (accounts.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No accounts yet"
              description="Customer registrations will appear here."
            />
          ) : (
            <StaggerList as="ul" className="space-y-3">
              {(accounts.data ?? []).map((account, index) => {
                const isSelf = account.id === profile?.id;
                const suspended = account.status === 'suspended';

                return (
                  <StaggerItem
                    as="li"
                    key={account.id}
                    index={index}
                    className={cn(
                      'rounded-2xl border bg-kv-card px-5 py-4',
                      suspended ? 'border-kv-danger/25' : 'border-kv-line',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-kv-white">
                            {account.full_name?.trim() || 'Unnamed'}
                            {isSelf ? (
                              <span className="ml-1.5 text-2xs uppercase tracking-widest text-kv-dim">
                                you
                              </span>
                            ) : null}
                          </p>
                          <Badge tone={account.role === 'admin' ? 'bright' : 'neutral'}>
                            {account.role}
                          </Badge>
                          <Badge tone={STATUS_TONE[account.status ?? 'active']}>
                            {account.status}
                          </Badge>
                          {account.email_verified_at ? null : (
                            <Badge tone="warning">unverified</Badge>
                          )}
                        </div>

                        <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-kv-muted">
                          <Mail className="h-3 w-3 text-kv-dim" aria-hidden />
                          {account.email}
                        </p>
                        <p className="mt-1 text-2xs text-kv-dim">
                          Created {formatDateTime(account.created_at)}
                          {account.activated_at
                            ? ` · active since ${formatDateTime(account.activated_at)}`
                            : ''}
                          {account.suspended_at
                            ? ` · suspended ${formatDateTime(account.suspended_at)}`
                            : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {account.role === 'customer' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void changeRole(account, 'staff')}
                            disabled={setRole.isPending}
                          >
                            <UserCog className="h-3.5 w-3.5" />
                            Make staff
                          </Button>
                        ) : account.role === 'staff' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void changeRole(account, 'admin')}
                            disabled={setRole.isPending || isSelf}
                            title={isSelf ? 'You cannot promote yourself' : undefined}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Make admin
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void changeRole(account, 'staff')}
                            disabled={setRole.isPending || isSelf}
                            title={isSelf ? 'You cannot demote yourself' : undefined}
                          >
                            Make staff
                          </Button>
                        )}

                        {account.status === 'invited' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void sendLink(account)}
                              disabled={staffAction.isPending}
                            >
                              <Send className="h-3.5 w-3.5" />
                              Resend invite
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void confirmAccount(account)}
                              disabled={staffAction.isPending}
                              title="Confirm this account without waiting for the email"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Confirm
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void sendLink(account)}
                            disabled={staffAction.isPending || suspended}
                            title={suspended ? 'Restore this account before sending a link' : undefined}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Reset password
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            suspended ? 'text-kv-success' : 'text-kv-danger hover:text-kv-danger',
                          )}
                          onClick={() => void toggleSuspension(account)}
                          disabled={setRole.isPending || isSelf}
                          title={isSelf ? 'You cannot suspend your own account' : undefined}
                        >
                          {suspended ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Restore
                            </>
                          ) : (
                            <>
                              <Ban className="h-3.5 w-3.5" />
                              Suspend
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerList>
          )}
        </ErrorBoundary>
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-lg text-kv-white">
          <KeyRound className="h-4 w-4 text-kv-dim" aria-hidden />
          Recent account activity
        </h2>
        <p className="-mt-2 text-2xs text-kv-dim">
          Records that an action happened. Passwords, reset links and verification codes are never written here.
        </p>

        <ErrorBoundary label="the activity log" onRetry={() => void events.refetch()}>
          {events.isPending ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : events.isError ? (
            <ErrorState
              title="Could not load the activity log"
              message={toErrorMessage(events.error)}
              onRetry={() => void events.refetch()}
            />
          ) : (events.data ?? []).length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <StaggerList
              as="ul"
              stagger={0.03}
              className="divide-y divide-kv-line rounded-2xl border border-kv-line bg-kv-card"
            >
              {(events.data ?? []).map((event, index) => {
                const who = (accounts.data ?? []).find((account) => account.id === event.profile_id);
                return (
                  <StaggerItem
                    as="li"
                    key={event.id}
                    index={index}
                    className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-kv-silver">
                        <span className="text-kv-white">{who?.email ?? 'Unknown account'}</span>{' '}
                        — {event.kind.replace(/_/g, ' ')}
                      </p>
                      {event.detail ? (
                        <p className="mt-0.5 text-2xs text-kv-dim">{event.detail}</p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-2xs text-kv-dim">{formatDateTime(event.created_at)}</p>
                  </StaggerItem>
                );
              })}
            </StaggerList>
          )}
        </ErrorBoundary>
      </section>

      {staff.length === 0 ? (
        <p className="text-2xs text-kv-dim">
          No staff accounts yet. Promote a trusted account above, then ask them to reset their password.
        </p>
      ) : null}
    </div>
  );
}
