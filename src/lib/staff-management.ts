import { isSupabaseConfigured, supabaseConfig } from '@/lib/env';
import { authController } from '@/lib/auth-controller';
import { supabase } from '@/lib/supabase';
import type { ProfileRole } from '@/types';

export type StaffAction = 'invite' | 'resend' | 'reset' | 'activate';

export interface StaffActionResult {
  ok: boolean;
  action: string;
  email: string;
  role?: string;
  userId?: string | null;
  message: string;
  /** How the work was actually done, for the audit note in the UI. */
  via: 'function' | 'public-api';
  /** Set when the account exists but a later step did not complete. */
  partial?: string;
}

export class StaffManagementError extends Error {
  /** True when no route is available (function not deployed and the API path failed). */
  readonly notDeployed: boolean;

  constructor(message: string, notDeployed = false) {
    super(message);
    this.name = 'StaffManagementError';
    this.notDeployed = notDeployed;
  }
}

/**
 * The function name must match the folder under `supabase/functions`, because
 * Supabase derives the route from it. A mismatch shows up as a 404 that is very
 * easy to misread as a permissions problem.
 */
const FUNCTION_NAME = 'manage-staff';

const CLI_FALLBACK =
  'If email is not sending yet, add staff from the command line: ' +
  'npm run staff:manage -- invite <email> --role staff';

function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * A password that satisfies Supabase's minimum and is never shown to anyone.
 *
 * The account is unusable until the emailed link is followed, so this exists
 * only to satisfy the `password` column — it is not a credential anyone holds.
 */
function unusablePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out}9aA`;
}

/* -------------------------------------------------------------------------- */
/* Route 1: the Edge Function                                                   */
/* -------------------------------------------------------------------------- */

interface FunctionOutcome {
  result?: StaffActionResult;
  /** Set when the function is simply not there, so the caller should fall back. */
  unavailable?: boolean;
  /** A real answer from a deployed function (403, 409, 502 …). */
  error?: StaffManagementError;
}

async function tryFunction(input: {
  action: StaffAction;
  email: string;
  role?: ProfileRole;
}): Promise<FunctionOutcome> {
  const token = await authController.getAccessToken();
  if (!token) {
    return { error: new StaffManagementError('Your session has expired. Sign in again and retry.') };
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/${FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The function reads the admin identity from this header.
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: input.action,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        redirectTo: `${window.location.origin}/staff/login`,
      }),
    });
  } catch {
    return { unavailable: true };
  }

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // A non-JSON body means the platform returned HTML — usually a 404 from an
    // undeployed function, or a gateway error worth reporting verbatim.
    return response.ok
      ? { error: new StaffManagementError(`${FUNCTION_NAME} returned an unexpected response.`) }
      : {
          error: new StaffManagementError(
            `${FUNCTION_NAME} returned HTTP ${response.status}. ${CLI_FALLBACK}`,
            response.status === 404,
          ),
        };
  }

  if (!response.ok) {
    const message =
      typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`;
    return {
      error: new StaffManagementError(
        response.status === 404 ? `${message} ${CLI_FALLBACK}` : message,
        response.status === 404,
      ),
    };
  }

  return { result: { ...(payload as unknown as StaffActionResult), via: 'function' } };
}

/* -------------------------------------------------------------------------- */
/* Route 2: the public API, which needs no privileged key at all                */
/* -------------------------------------------------------------------------- */

/**
 * Creates the sign-in with the anon key and the admin's own session, then
 * promotes the profile with the `set_account_role` RPC.
 *
 * This exists because deploying the function needs Management API access, which
 * this project does not have. It is deliberately a *fallback*: the function is
 * atomic, can delete a half-created auth user, and supports `activate`, none of
 * which this path can do.
 */
async function inviteViaPublicApi(email: string, role: ProfileRole): Promise<StaffActionResult> {
  const trimmed = email.trim().toLowerCase();

  const { data, error: signUpError } = await supabase.auth.signUp({
    email: trimmed,
    password: unusablePassword(),
    options: { data: { full_name: '' } },
  });

  if (signUpError) {
    if (/already|registered|exists/i.test(signUpError.message)) {
      throw new StaffManagementError(
        'An account already exists for that address. Use “Make staff” on the existing row instead.',
      );
    }
    throw new StaffManagementError(`Could not create the account: ${signUpError.message}`);
  }

  const userId = data.user?.id ?? null;

  // Promote. The trigger may not have run, in which case this fails with a
  // clear message — but the auth user now exists, so say so rather than
  // pretending the whole thing rolled back.
  const { error: promoteError } = await supabase.rpc('set_account_role', {
    target_email: trimmed,
    new_role: role,
    suspend: false,
  });

  if (promoteError) {
    throw new StaffManagementError(
      `The sign-in was created but could not be promoted to ${role}: ${promoteError.message}. ` +
        `They currently exist as a customer account. ${CLI_FALLBACK}`,
    );
  }

  // The emailed link is what actually lets them set a password. A failure here
  // is not fatal to the account, so it is reported as a caveat.
  const { error: emailError } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo: `${window.location.origin}/staff/login`,
  });

  return {
    ok: true,
    action: 'invite',
    email: trimmed,
    role,
    userId,
    via: 'public-api',
    message: emailError
      ? `${trimmed} was added as ${role}. The setup email did not send (${emailError.message}). ${CLI_FALLBACK}`
      : `${trimmed} was added as ${role}. They can set a password from the email we just sent.`,
    partial: emailError ? 'The setup email did not send.' : undefined,
  };
}

async function emailLinkViaPublicApi(action: 'resend' | 'reset', email: string): Promise<StaffActionResult> {
  const trimmed = email.trim().toLowerCase();

  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo: `${window.location.origin}/staff/login`,
  });
  if (error) throw new StaffManagementError(`Could not send the link: ${error.message}`);

  return {
    ok: true,
    action,
    email: trimmed,
    via: 'public-api',
    message: `A sign-in link was sent to ${trimmed}.`,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Runs a privileged staff action, preferring the Edge Function and falling back
 * to the public API when the function is not deployed.
 *
 * The caller's own access token is sent as the bearer credential. The function
 * re-derives the admin check from that token using the anon key, so it trusts
 * the database rather than anything this file asserts — passing `isAdmin: true`
 * from the client would be a security hole, not a shortcut.
 */
export async function callStaffManagement(input: {
  action: StaffAction;
  email: string;
  role?: ProfileRole;
}): Promise<StaffActionResult> {
  if (!isSupabaseConfigured) {
    throw new StaffManagementError('Supabase is not configured, so staff invites are unavailable.');
  }
  if (!isEmailAddress(input.email)) {
    throw new StaffManagementError('Enter a valid email address.');
  }

  const email = input.email.trim().toLowerCase();

  // `activate` confirms an email address out of band, which needs the service
  // role. There is no safe client-side equivalent, so do not pretend otherwise.
  if (input.action === 'activate') {
    const outcome = await tryFunction({ ...input, email });
    if (outcome.error) throw outcome.error;
    if (outcome.result) return outcome.result;
    throw new StaffManagementError(
      `Confirming an account without an email needs the ${FUNCTION_NAME} function, which is not deployed. ${CLI_FALLBACK}`,
      true,
    );
  }

  const outcome = await tryFunction({ ...input, email });
  if (outcome.result) return outcome.result;

  // A real rejection from a deployed function is an answer, not an outage.
  if (outcome.error && !outcome.error.notDeployed) throw outcome.error;

  if (input.action === 'invite') {
    if (!input.role || input.role === 'customer') {
      throw new StaffManagementError('Choose a role of staff or admin.');
    }
    return inviteViaPublicApi(email, input.role);
  }

  return emailLinkViaPublicApi(input.action, email);
}
