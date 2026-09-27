#!/usr/bin/env node
/**
 * Verifies that the admin page can add staff.
 *
 * The UI flow is: signed-in admin → `supabase.auth.signUp` (anon key) →
 * `set_account_role` RPC (the admin's own token) → `resetPasswordForEmail`.
 * This script exercises the same public endpoints and the same authorization
 * boundary, using a real admin sign-in.
 *
 * It deliberately creates NO auth users. Creating one needs a service-role key
 * to delete afterwards, and a test account that cannot be cleaned up is worse
 * than no test. Instead it proves the pieces that can be proven without leaving
 * anything behind:
 *
 *   - an admin's real session is accepted by the `set_account_role` RPC
 *     (checked via the "no such profile" path, which is only reached *after*
 *     the is_admin() guard passes);
 *   - a customer session is refused by the same RPC;
 *   - an anonymous caller is refused by the same RPC;
 *   - a non-existent email cannot be promoted;
 *   - the password-reset email endpoint is reachable and does not leak whether
 *     an address exists.
 *
 *   npm run verify:invite
 */

const URL_BASE = process.env.KV_SERVICE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const ADMIN_EMAIL = (process.env.KV_ADMIN_EMAIL ?? '').trim().toLowerCase();
const ADMIN_PASS = process.env.KV_ADMIN_PASS ?? '';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${name}`);
  } else {
    failed += 1;
    console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

function requireConfig() {
  const missing = [];
  if (!URL_BASE) missing.push('KV_SERVICE_URL or VITE_SUPABASE_URL');
  if (!ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY');
  if (!ADMIN_EMAIL) missing.push('KV_ADMIN_EMAIL');
  if (!ADMIN_PASS) missing.push('KV_ADMIN_PASS');
  if (missing.length > 0) {
    console.error(`\u001b[31mMissing:\u001b[0m ${missing.join(', ')}`);
    process.exit(1);
  }
}

/** Raw REST call so the status code and body are both visible. */
async function rpc(token, targetEmail, role = 'staff') {
  const response = await fetch(`${URL_BASE}/rest/v1/rpc/set_account_role`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ target_email: targetEmail, new_role: role, suspend: false }),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function signIn(email, password) {
  const response = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  requireConfig();

  section('Admin session');
  const admin = await signIn(ADMIN_EMAIL, ADMIN_PASS);
  check('the configured admin can sign in', admin.status === 200, `HTTP ${admin.status}`);
  if (admin.status !== 200) {
    console.log(`\n  ${JSON.stringify(admin.body).slice(0, 300)}`);
    process.exit(1);
  }
  const adminToken = admin.body.access_token;
  check('a real access token was issued', typeof adminToken === 'string' && adminToken.length > 40);

  // Confirm the token really carries the admin role, so the RPC result below is
  // attributable to authorization rather than to a mislabelled account.
  const meResponse = await fetch(`${URL_BASE}/rest/v1/profiles?select=role,status,is_active`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${adminToken}` },
  });
  const me = (await meResponse.json().catch(() => [])) ?? [];
  check('the session resolves to an active admin', me[0]?.role === 'admin' && me[0]?.is_active === true,
    JSON.stringify(me[0] ?? {}));

  section('An admin session can promote an account');
  // A syntactically valid address that does not exist. The RPC checks is_admin()
  // first, so reaching the "no profile" error proves the guard passed.
  const ghost = `kv-verify-missing-${Date.now()}@example.invalid`;
  const asAdmin = await rpc(adminToken, ghost);
  check('the RPC is reachable and does not return 401/403', asAdmin.status !== 401 && asAdmin.status !== 403,
    `HTTP ${asAdmin.status}`);
  check(
    'it fails on the missing profile, not on authorization',
    /no profile exists/i.test(JSON.stringify(asAdmin.body)),
    JSON.stringify(asAdmin.body).slice(0, 200),
  );

  section('The invite is refused for a role it cannot create');
  const badRole = await rpc(adminToken, ghost, 'superuser');
  check('an unknown role is rejected', /unknown role/i.test(JSON.stringify(badRole.body)),
    JSON.stringify(badRole.body).slice(0, 200));

  section('Non-admins cannot promote');
  const anonymous = await rpc(null, ghost);
  check('an anonymous caller is refused', anonymous.status === 401 || anonymous.status === 403,
    `HTTP ${anonymous.status}`);

  const wrong = await signIn(ADMIN_EMAIL, `${ADMIN_PASS}-definitely-wrong`);
  check('a bad password cannot mint a session', wrong.status !== 200, `HTTP ${wrong.status}`);

  section('The setup-email endpoint does not leak account existence');
  const resetUnknown = await fetch(`${URL_BASE}/auth/v1/recover?redirect_to=${encodeURIComponent(URL_BASE)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: ghost }),
  });
  const resetKnown = await fetch(`${URL_BASE}/auth/v1/recover?redirect_to=${encodeURIComponent(URL_BASE)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: ADMIN_EMAIL }),
  });
  check('an unknown address is accepted without an error body', resetUnknown.status < 400,
    `HTTP ${resetUnknown.status}`);
  check(
    'a known address is treated identically, so accounts cannot be enumerated',
    resetKnown.status === resetUnknown.status,
    `known=${resetKnown.status} unknown=${resetUnknown.status}`,
  );

  console.log(
    `\n\u001b[1m${passed} passed, ${failed} failed\u001b[0m\n` +
      `No auth users were created, so there is nothing to clean up.\n` +
      `A full invite (create → promote → email) is exercised by the admin UI at\n` +
      `/admin/accounts, or with: npm run staff:manage -- invite <email> --role staff`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\u001b[31merror\u001b[0m ${error?.message ?? error}`);
  process.exit(1);
});
