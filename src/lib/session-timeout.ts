/**
 * Idle session timeout.
 *
 * Supabase is configured with `autoRefreshToken`, so an access token that would
 * otherwise expire after an hour is refreshed silently and the browser stays
 * signed in indefinitely. On a shared counter tablet that is the wrong default:
 * the next person inherits the session. This module is the counterweight — real
 * inactivity signs the user out.
 *
 * The logic is deliberately free of React so it can be reasoned about (and
 * tested) on its own; `SessionTimeout` is the thin wrapper that renders it.
 */

/** Inactivity that ends a session. */
export const IDLE_LIMIT_MS = 15 * 60 * 1000;

/** Grace period offered before the signout, so unsaved work can be saved. */
export const WARNING_MS = 60 * 1000;

/**
 * Real input only. `mousemove` is deliberately absent: a pointer drifting across
 * the screen is not the user doing anything, and including it would let a page
 * left open on a counter never time out.
 *
 * `visibilitychange` is also excluded on purpose. Coming back to a tab is not an
 * interaction, and counting it would reset the timer just by switching windows.
 */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
] as const;

/** Rate limit for activity handling; input can fire far faster than we care about. */
const ACTIVITY_THROTTLE_MS = 1000;

export interface SessionTimeoutCallbacks {
  /** The idle window closed. `secondsLeft` counts down to the signout. */
  onWarning: (secondsLeft: number) => void;
  /** The grace period ran out. The owner performs the actual signout. */
  onTimeout: () => void;
}

export interface SessionTimeout {
  /** Begins listening. Idempotent. */
  start: () => void;
  /** Stops listening and clears pending timers. */
  stop: () => void;
  /**
   * Records activity from a source the DOM events cannot cover. Cancels a
   * pending signout.
   */
  continueSession: () => void;
  /**
   * Re-evaluates the idle window without recording any activity.
   *
   * Needed because browsers throttle timers in background tabs, so a tab left
   * open on a counter may have had its signout suppressed. On focus this opens
   * the warning straight away if the window already elapsed, rather than quietly
   * handing the user a fresh idle period just for coming back.
   */
  check: () => void;
  /** True while the warning dialog is showing. */
  isWarning: () => boolean;
}

export interface SessionTimeoutOptions {
  idleLimitMs?: number;
  warningMs?: number;
  /** Injected for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Counts down the warning on a 1s tick.
 *
 * Backed by wall-clock timestamps rather than tick counting, because browsers
 * throttle timers in background tabs: a tab left open overnight must still be
 * signed out when it is focused again, not 60 seconds later.
 */
export function createSessionTimeout(
  callbacks: SessionTimeoutCallbacks,
  options: SessionTimeoutOptions = {},
): SessionTimeout {
  const idleLimitMs = options.idleLimitMs ?? IDLE_LIMIT_MS;
  const warningMs = options.warningMs ?? WARNING_MS;
  const now = options.now ?? (() => Date.now());

  let lastActivity = now();
  let warningStartedAt = 0;
  let running = false;
  let idleTimer: number | null = null;
  let tickTimer: number | null = null;
  let lastHandledActivity = 0;

  const clearTimers = () => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    if (tickTimer !== null) window.clearInterval(tickTimer);
    idleTimer = null;
    tickTimer = null;
  };

  const endWarning = () => {
    warningStartedAt = 0;
    if (tickTimer !== null) window.clearInterval(tickTimer);
    tickTimer = null;
  };

  const signOutNow = () => {
    clearTimers();
    endWarning();
    callbacks.onTimeout();
  };

  const onTick = () => {
    const elapsed = now() - warningStartedAt;
    const secondsLeft = Math.max(0, Math.ceil((warningMs - elapsed) / 1000));
    if (secondsLeft <= 0) {
      signOutNow();
      return;
    }
    callbacks.onWarning(secondsLeft);
  };

  const beginWarning = () => {
    warningStartedAt = now();
    callbacks.onWarning(Math.ceil(warningMs / 1000));
    tickTimer = window.setInterval(onTick, 1000);
  };

  const armIdleTimer = () => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(beginWarning, Math.max(0, idleLimitMs - (now() - lastActivity)));
  };

  const onActivity = () => {
    const stamp = now();
    // A single stray event should not cancel a signout that is seconds away.
    if (stamp - lastHandledActivity < ACTIVITY_THROTTLE_MS) return;
    lastHandledActivity = stamp;
    continueSession();
  };

  function continueSession() {
    if (!running) return;
    lastActivity = now();
    endWarning();
    armIdleTimer();
  }

  function check() {
    if (!running || warningStartedAt > 0) return;
    if (now() - lastActivity >= idleLimitMs) beginWarning();
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastActivity = now();
      lastHandledActivity = 0;
      for (const event of ACTIVITY_EVENTS) {
        window.addEventListener(event, onActivity, { passive: true });
      }
      armIdleTimer();
    },
    stop() {
      if (!running) return;
      running = false;
      clearTimers();
      endWarning();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
    },
    continueSession,
    check,
    isWarning: () => warningStartedAt > 0,
  };
}
