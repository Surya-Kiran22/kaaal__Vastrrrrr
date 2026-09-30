import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
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
import { useAuth } from '@/hooks/useAuth';
import { createSessionTimeout, IDLE_LIMIT_MS } from '@/lib/session-timeout';

const IDLE_LIMIT_MINUTES = Math.round(IDLE_LIMIT_MS / 60000);

/**
 * Signs the user out after a stretch of real inactivity, with a grace period so
 * nothing unsaved is lost mid-way.
 *
 * Mounted once from the root route. Applies to every signed-in role, customers
 * included: the console is not the only place a shared device is left open.
 */
export function SessionTimeout() {
  const { isAuthenticated, canUseConsole, signOut } = useAuth();
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof createSessionTimeout> | null>(null);
  const signOutRef = useRef(signOut);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Kept in a ref so the timer never has to be torn down and rebuilt when these
  // change identity, which would restart the idle window mid-warning.
  signOutRef.current = signOut;

  const handleSignOut = useCallback(async () => {
    await signOutRef.current();
    setSecondsLeft(null);
    toast('Signed out after inactivity', {
      description: `You were signed out after ${IDLE_LIMIT_MINUTES} minutes without activity. Sign in again to carry on.`,
    });
    // Console roles belong back at the console door, not the customer account one.
    await navigate({ to: canUseConsole ? '/admin/login' : '/account/login' });
  }, [canUseConsole, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const timer = createSessionTimeout({
      onWarning: setSecondsLeft,
      onTimeout: () => void handleSignOut(),
    });
    timeoutRef.current = timer;
    timer.start();

    return () => {
      timer.stop();
      timeoutRef.current = null;
      setSecondsLeft(null);
    };
  }, [isAuthenticated, handleSignOut]);

  /*
   * A tab left in the background has its timers throttled, so the signout may
   * have come due while nothing was running. `check` opens the warning on focus
   * if the idle window already elapsed. It must not *reset* the window: coming
   * back to the tab is not an interaction, and resetting would make switching
   * windows a way to avoid ever being signed out.
   */
  useEffect(() => {
    if (!isAuthenticated) return;

    const onFocus = () => timeoutRef.current?.check();

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isAuthenticated]);

  const staySignedIn = useCallback(() => {
    timeoutRef.current?.continueSession();
    setSecondsLeft(null);
  }, []);

  const warningOpen = secondsLeft !== null;

  return (
    /*
     * `onOpenChange` is intentionally inert. Escape and an outside click would
     * otherwise dismiss the dialog, and dismissal must not be read as "stay
     * signed in" — the only ways out are the two buttons below.
     */
    <Dialog open={warningOpen} onOpenChange={() => undefined}>
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>Still there?</DialogTitle>
          <DialogDescription>
            You have been inactive for {IDLE_LIMIT_MINUTES} minutes, so this session is about to
            close for security. Signing in again is quick.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="font-display text-4xl text-kv-white">
            {secondsLeft}
            <span className="ml-2 text-base text-kv-muted">seconds left</span>
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={handleSignOut}>
            Sign out now
          </Button>
          <Button onClick={staySignedIn}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
