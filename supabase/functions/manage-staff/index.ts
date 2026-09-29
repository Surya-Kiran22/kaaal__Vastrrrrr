// Admin-only staff account management.
//
// Why this exists as a function rather than a browser call: creating an auth
// user needs the service-role key, and that key must never reach the client. So
// the browser asks this function, the function re-checks that the caller is
// really an active admin, and only then does the privileged work.
//
// Actions
//   invite    create a staff/admin user and email a one-time setup link
//   resend    re-send the setup link for an invited account
//   reset     email a password-reset link
//   activate  confirm an invited account out of band (no email needed)
//
// Every action appends a row to `staff_account_events`. Passwords, tokens and
// links are never written to the audit trail.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

type Action = 'invite' | 'resend' | 'reset' | 'activate';
type Role = 'staff' | 'admin';

interface RequestBody {
  action: Action;
  email?: string;
  role?: Role;
  /** Where the emailed link should land. Must be an absolute https URL. */
  redirectTo?: string;
}

const ALLOWED_ACTIONS: readonly Action[] = ['invite', 'resend', 'reset', 'activate'];
const ALLOWED_ROLES: readonly Role[] = ['staff', 'admin'];

/**
 * Browser origins allowed to call this function.
 *
 * The storefront is served from the app's own domain, not from the Supabase
 * origin, so every call is cross-origin. Without the headers below the browser
 * blocks the response before JavaScript can read it, and the function appears
 * to fail even though the request worked.
 *
 * `*` is deliberately never used. It would let any site on the internet attempt
 * calls, and although the admin check below would still reject them, it hands out
 * the fact that the endpoint exists and turns a CSRF attempt into a simple
 * cross-site request.
 */
const RAW_ALLOWED_ORIGINS: readonly string[] = (Deno.env.get('ALLOWED_REDIRECT_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/** Exact origins, e.g. `https://kaalvastr.in`. */
const ALLOWED_ORIGINS: readonly string[] = RAW_ALLOWED_ORIGINS.filter(
  (value) => !value.includes('*'),
);

/**
 * Host suffixes from wildcard entries, e.g. `https://*.vercel.app` -> `.vercel.app`.
 *
 * Vercel gives every deploy its own hostname, so an exact-match list would need a
 * secret edit before each preview build could call this function. The wildcard
 * stays https-only and host-scoped: any site on the internet is still refused.
 */
const ALLOWED_ORIGIN_SUFFIXES: readonly string[] = RAW_ALLOWED_ORIGINS.filter((value) =>
  value.includes('*'),
).map((value) => value.replace(/^https:\/\/\*/i, '').replace(/\/+$/, ''));

function originAllowed(origin: string | null): string | null {
  if (!origin) return null;
  const normalised = origin.replace(/\/+$/, '');
  if (ALLOWED_ORIGINS.includes(normalised)) return origin;
  if (!normalised.startsWith('https://')) return null;
  if (ALLOWED_ORIGIN_SUFFIXES.some((suffix) => normalised.endsWith(suffix))) return origin;
  return null;
}

/**
 * Every header the browser asks permission for during the preflight.
 *
 * supabase-js sends `apikey` on every request, adds `x-client-info`, and this app
 * also sets `x-application-name` globally. Omitting any one of them makes the
 * preflight fail with "does not have HTTP ok status" even when the origin is
 * allowed, so the list here has to be a superset of what the client sends.
 */
const ALLOWED_REQUEST_HEADERS =
  'authorization, content-type, apikey, x-client-info, x-client-version, x-application-name, x-supabase-api-version';

function corsHeaders(request: Request): Record<string, string> {
  const allowed = originAllowed(request.headers.get('origin'));
  if (!allowed) return {};
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': ALLOWED_REQUEST_HEADERS,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

if (RAW_ALLOWED_ORIGINS.length === 0) {
  console.warn(
    'manage-staff: ALLOWED_REDIRECT_ORIGINS is not set, so every browser origin is ' +
      'refused and CORS preflights come back without headers. Fix with: ' +
      'supabase secrets set ALLOWED_REDIRECT_ORIGINS=https://kaalvastr.in,https://*.vercel.app',
  );
}

const json = (body: unknown, status = 200, request?: Request) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(request ? corsHeaders(request) : {}),
    },
  });

const fail = (message: string, status: number, request?: Request) =>
  json({ error: message }, status, request);

/**
 * Only accept links pointing back at the site this function serves.
 *
 * Without this an admin could be tricked into passing an attacker's URL, and
 * Supabase would email a live password-reset token to that host.
 */
function safeRedirect(
  candidate: string | undefined,
  fallback: string,
  supabaseUrl: string,
): string {
  if (!candidate) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('redirectTo must be an absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('redirectTo must use https');
  }
  const own = new URL(supabaseUrl);
  if (parsed.origin === own.origin) return parsed.toString();
  // Reuse the CORS matcher so a deploy that is allowed to *call* this function is
  // also allowed to receive links, including host-scoped wildcards like
  // `https://*.vercel.app`.
  if (originAllowed(parsed.origin)) return parsed.toString();
  throw new Error('redirectTo points at an unrecognised host');
}

/** The app origin every emailed link should return to. */
const APP_ORIGIN = ALLOWED_ORIGINS[0] ?? '';

function requireEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('email is required');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('that is not a valid email address');
  if (email.length > 254) throw new Error('email address is too long');
  return email;
}

function requireRole(value: unknown, fallback: Role = 'staff'): Role {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !ALLOWED_ROLES.includes(value as Role)) {
    throw new Error(`role must be one of ${ALLOWED_ROLES.join(', ')}`);
  }
  return value as Role;
}

Deno.serve(async (request) => {
  // A POST carrying a bearer token is not a CORS-simple request, so the browser
  // sends an OPTIONS preflight first. Answering it is what lets the real call
  // leave the page at all.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return fail('Use POST.', 405, request);
  }

  // A refused origin gets a logged reason instead of an opaque browser CORS
  // failure, which otherwise hides the real cause: a missing or stale
  // ALLOWED_REDIRECT_ORIGINS entry.
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && !originAllowed(requestOrigin)) {
    console.warn(`manage-staff: refused origin ${requestOrigin}`);
    return fail('This origin is not allowed to call this function.', 403);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return fail('Function is missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.', 500, request);
  }

  // --- Identify the caller from their own token, using the anon key so that
  // --- RLS decides what they may see. Trusting a body field here would let
  // --- anyone who found this URL impersonate an admin.
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return fail('Missing Authorization header.', 401, request);
  }
  const token = authHeader.slice(7).trim();

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return fail('Your session has expired. Sign in again.', 401, request);
  }

  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('id, role, status, is_active')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) return fail('Could not verify your account.', 500, request);
  if (!profile) return fail('No profile is attached to this session.', 403, request);
  if (profile.role !== 'admin') return fail('Only an admin can manage staff accounts.', 403, request);
  if (!profile.is_active || profile.status !== 'active') {
    return fail('This admin account is suspended.', 403, request);
  }

  // --- Privileged client. Bypasses RLS by design; only used after the checks
  // --- above have passed.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return fail('Body must be JSON.', 400, request);
  }

  const action = body.action;
  if (typeof action !== 'string' || !ALLOWED_ACTIONS.includes(action as Action)) {
    return fail(`action must be one of ${ALLOWED_ACTIONS.join(', ')}`, 400, request);
  }

  let email: string;
  let redirectTo: string;
  let role: Role = 'staff';

  try {
    email = requireEmail(body.email);
    // Without an explicit allowlist the old default was the Supabase origin,
    // which emails a link to https://<project>.supabase.co/staff/login. That page
    // does not exist, so every invite would dead-end. Fail loudly at setup time
    // instead of sending links that cannot work.
    if (!APP_ORIGIN) {
      return fail(
        'ALLOWED_REDIRECT_ORIGINS is not set, so emailed links would point at the wrong site. Set it to the app origin, then retry.',
        500,
        request,
      );
    }
    redirectTo = safeRedirect(body.redirectTo, `${APP_ORIGIN}/staff/login`, SUPABASE_URL);
    role = requireRole(body.role);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid request.', 400, request);
  }

  const actorId = profile.id as string;
  const audit = async (
    kind: string,
    detail: string,
    profileId: string | null,
  ) => {
    const { error } = await admin.from('staff_account_events').insert({
      profile_id: profileId,
      actor_id: actorId,
      kind,
      detail: detail.slice(0, 500),
    });
    if (error) console.error('audit insert failed', error);
  };

  try {
    // ---------------------------------------------------------------- invite
    if (action === 'invite') {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        // A random placeholder: the emailed setup link sets the real one. The
        // account cannot sign in until it is changed.
        email_confirm: false,
        password: crypto.randomUUID() + 'Kaal!9',
        user_metadata: { full_name: '', invited_by: actorId },
      });
      if (createError) {
        if (/already/i.test(createError.message)) {
          return fail('An account already exists for that address.', 409, request);
        }
        throw createError;
      }

      const newId = created.user?.id ?? null;

      // `handle_new_user` should have made the profile. If the trigger was
      // somehow skipped, refuse rather than leave an orphaned auth user.
      if (newId) {
        const { data: fresh, error: readError } = await admin
          .from('profiles')
          .select('id, role, status')
          .eq('id', newId)
          .maybeSingle();
        if (readError) throw readError;
        if (!fresh) {
          await admin.auth.admin.deleteUser(newId);
          return fail('Could not create the matching profile; nothing was saved.', 500, request);
        }
        if (fresh.role !== 'customer' || fresh.status !== 'invited') {
          await admin.auth.admin.deleteUser(newId);
          return fail('The new account did not start in the invited state; nothing was saved.', 500, request);
        }

        const { error: roleError } = await admin
          .from('profiles')
          .update({
            role,
            invited_by: actorId,
            invited_at: new Date().toISOString(),
          })
          .eq('id', newId);
        if (roleError) throw roleError;
      }

      const { error: linkError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo },
      });
      // A failed email must not silently look like success: the account exists
      // but the invite did not arrive, so say so and record why.
      if (linkError) {
        await audit('invite_sent', `invite link failed to generate: ${linkError.message}`, newId);
        return fail(
          `The account was created but the invite email could not be generated (${linkError.message}). Use "resend" once email is configured.`,
          502,
        );
      }

      await audit('invite_sent', `invited as ${role}`, newId);
      return json({
        ok: true,
        action,
        email,
        role,
        userId: newId,
          message: `Invite sent to ${email}. They can sign in from ${redirectTo}.`,
        }, 200, request);
    }

    // ------------------------------------------------------------- resend/reset
    if (action === 'resend' || action === 'reset') {
      const { data: list, error: listError } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) throw listError;

      const user = list.users.find(
        (candidate) => (candidate.email ?? '').toLowerCase() === email,
      );
      if (!user) return fail('No account exists for that address.', 404, request);

      // Sending a reset link to a suspended account would hand out a credential
      // that still cannot be used, which only wastes the admin's time.
      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('id, role, status')
        .eq('id', user.id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return fail('No profile is attached to that account.', 404, request);
      if (target.status === 'suspended') {
        return fail('That account is suspended. Restore it before sending a link.', 409, request);
      }

      const type = action === 'resend' ? 'invite' : 'recovery';
      const { error: linkError } = await admin.auth.admin.generateLink({
        type,
        email,
        options: { redirectTo },
      });
      if (linkError) {
        await audit(
          action === 'resend' ? 'invite_resent' : 'password_reset_sent',
          `link failed to generate: ${linkError.message}`,
          user.id,
        );
        return fail(`Could not generate the link (${linkError.message}).`, 502, request);
      }

      await audit(
        action === 'resend' ? 'invite_resent' : 'password_reset_sent',
        target.role,
        user.id,
      );
      return json({
        ok: true,
        action,
        email,
        role: target.role,
        userId: user.id,
          message: `A ${action === 'resend' ? 'setup' : 'password reset'} link was sent to ${email}.`,
        }, 200, request);
    }

    // ---------------------------------------------------------------- activate
    // For when email is not working yet. Deliberately does not set a password:
    // the account still needs a reset link before it can be used.
    //
    // The lookup happens first. Previously a missing address fell through to
    // `updateUserById('')`, which threw an opaque "Unexpected error" 500 after a
    // pointless privileged call; a name that does not exist is a plain 404.
    const activateId = await findUserId(admin, email);
    if (!activateId) {
      return fail('No account exists for that address.', 404, request);
    }

    const { data: confirmed, error: confirmError } =
      await admin.auth.admin.updateUserById(activateId, { email_confirm: true });
    if (confirmError) throw confirmError;

    const targetId = confirmed.user?.id ?? null;
    if (targetId) {
      const { error: profileError2 } = await admin
        .from('profiles')
        .update({ status: 'active', is_active: true, activated_at: new Date().toISOString() })
        .eq('id', targetId);
      if (profileError2) throw profileError2;
    }
    await audit('email_verified', 'confirmed by admin (no email)', targetId);
    return json(
      {
        ok: true,
        action,
        email,
        userId: targetId,
        message: `${email} is confirmed. Send a password reset so they can sign in.`,
        },
        200,
        request,
      );
  } catch (error) {
    console.error('manage-staff failed', error);
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return fail(message, 500, request);
  }
});

/**
 * `createClient` is generic over its key type, so the service-role client
 * created above is not assignable to the default-typed `ReturnType`. The loose
 * parameters keep the admin client (and the anon client) usable here.
 */
type ServiceRoleClient = SupabaseClient<any, any, any>;

/** `listUsers` is paginated; walk it until the address is found or pages run out. */
async function findUserId(admin: ServiceRoleClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((candidate) => (candidate.email ?? '').toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}
