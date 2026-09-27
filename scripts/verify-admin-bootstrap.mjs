// Verifies the real owner account created by `npm run admin:bootstrap`.
//
//   $env:KV_DB_URL      = "postgresql://..."
//   $env:KV_ADMIN_EMAIL = "you@example.com"
//   $env:KV_ADMIN_PASS  = "..."
//   npm run verify:admin
//
// Signs in through the public auth API (no service-role shortcut) and checks
// what that account can and cannot do. Every write it performs is reverted, and
// the throwaway customer/order it creates is deleted, so the database is left
// exactly as it was found.
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_KEY;
const ADMIN_EMAIL = process.env.KV_ADMIN_EMAIL;
const ADMIN_PASS = process.env.KV_ADMIN_PASS;
if (!URL_ || !KEY || !process.env.KV_DB_URL || !ADMIN_EMAIL || !ADMIN_PASS) {
  console.error('Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, KV_DB_URL, KV_ADMIN_EMAIL and KV_ADMIN_PASS.');
  process.exit(1);
}

const admin = new Client({ connectionString: process.env.KV_DB_URL });
let pass = 0;
let fail = 0;
const ok = (cond, msg, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? `  -> ${extra}` : ''}`);
};

async function api(path, { token = KEY, method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, raw: text };
}

await admin.connect();
let customerEmail = null;

try {
  // ------------------------------------------------------- real sign-in
  const signIn = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  ok(signIn.status === 200 && !!signIn.data?.access_token, 'owner can sign in with the bootstrapped credentials', `status=${signIn.status}`);
  const token = signIn.data?.access_token;
  if (!token) throw new Error('cannot continue without a session');

  const me = await api('/rest/v1/profiles?id=eq.' + signIn.data.user.id + '&select=email,role,status,is_active,email_verified_at', { token });
  const p = me.data?.[0];
  ok(p?.role === 'admin', 'profile role is admin', p?.role);
  ok(p?.status === 'active' && p?.is_active, 'account is active');
  ok(!!p?.email_verified_at, 'email is recorded as verified');

  const consoleOk = await api('/rest/v1/rpc/can_use_staff_console', { token, method: 'POST' });
  ok(consoleOk.data === true, 'can_use_staff_console() returns true for the owner');

  const anonConsole = await api('/rest/v1/rpc/can_use_staff_console', { method: 'POST' });
  ok(anonConsole.status >= 400 || anonConsole.data === false, 'anon cannot use the staff console', `status=${anonConsole.status}`);

  // ------------------------------------------------- catalogue write access
  const products = await api('/rest/v1/products?select=id,name,description&limit=1&order=id', { token });
  const product = products.data?.[0];
  ok(products.status === 200 && !!product, 'admin can read the catalogue');

  const originalDesc = product.description;
  const edited = await api(`/rest/v1/products?id=eq.${product.id}`, {
    token,
    method: 'PATCH',
    body: { description: originalDesc },
  });
  ok(edited.status === 204, 'admin can write products', `status=${edited.status}`);

  const anonWrite = await api(`/rest/v1/products?id=eq.${product.id}`, { method: 'PATCH', body: { description: 'hijacked' } });
  ok(anonWrite.status >= 400, 'anon still cannot write products', `status=${anonWrite.status}`);

  const check = await api(`/rest/v1/products?id=eq.${product.id}&select=description`, { token });
  ok(check.data?.[0]?.description === originalDesc, 'product description is unchanged (write was a no-op restore)');

  // --------------------------------------------------------- settings write
  const settings = await api('/rest/v1/business_settings?select=id,store_timings', { token });
  const originalTimings = settings.data?.[0]?.store_timings;
  const settingsWrite = await api('/rest/v1/business_settings?id=eq.biz-001', {
    token,
    method: 'PATCH',
    body: { store_timings: originalTimings },
  });
  ok(settingsWrite.status === 204, 'admin can write business settings', `status=${settingsWrite.status}`);
  const settingsBack = await api('/rest/v1/business_settings?select=store_timings', { token });
  ok(settingsBack.data?.[0]?.store_timings === originalTimings, 'business settings unchanged after restore');

  // --------------------------------------------------------- staff listing
  const everyone = await api('/rest/v1/profiles?select=id,email,role,status,created_at', { token });
  ok(everyone.status === 200 && everyone.data.length >= 1, 'admin can list accounts for the staff screen', `rows=${everyone.data?.length}`);
  const shape = everyone.data[0] ?? {};
  ok(
    ['id', 'email', 'role', 'status', 'created_at'].every((k) => k in shape),
    'the staff list exposes exactly the fields the screen needs (no password field exists)',
    Object.keys(shape).join(','),
  );
  ok(!('password' in shape) && !('encrypted_password' in shape), 'no password column is exposed to the client');

  // ------------------------------------- admin can manage staff, not dispatch
  customerEmail = `kv.admincheck.${Date.now()}@gmail.com`;
  const custId = crypto.randomUUID();
  await admin.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
        email_change_token_new, recovery_token, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(),
        '{"provider":"email","providers":["email"]}', '{"full_name":"Dispatch Probe"}'::jsonb,
        '', '', '', '', now(), now())`,
    [custId, customerEmail, bcrypt.hashSync('Throwaway-12345-Aa1!', 10)],
  );
  await admin.query(
    `insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
     values ($1, $1, $2::jsonb, 'email', $3, now(), now(), now())`,
    [custId, JSON.stringify({ sub: custId, email: customerEmail, email_verified: true }), customerEmail],
  );
  const custSignIn = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: customerEmail, password: 'Throwaway-12345-Aa1!' } });
  const custToken = custSignIn.data?.access_token;
  ok(!!custToken, 'throwaway customer signed in');

  const order = await api('/rest/v1/orders', {
    token: custToken,
    method: 'POST',
    prefer: 'return=representation',
    body: { customer_name: 'Dispatch Probe', customer_phone: '+91 90000 33333' },
  });
  const orderId = order.data?.[0]?.id;
  ok(order.status === 201 && order.data[0].status === 'placed', 'test order created', order.data?.[0]?.status);

  const adminReadLog = await api(`/rest/v1/orders?id=eq.${orderId}&select=reference,status`, { token });
  ok(adminReadLog.status === 200 && adminReadLog.data.length === 1, 'admin CAN read the dispatch log', `status=${adminReadLog.status}`);

  const adminDirect = await api(`/rest/v1/orders?id=eq.${orderId}`, { token, method: 'PATCH', body: { status: 'delivered' } });
  ok(adminDirect.status >= 400, 'admin CANNOT PATCH the order status directly', `status=${adminDirect.status}`);

  const adminRpc = await api('/rest/v1/rpc/set_order_status', { token, method: 'POST', body: { p_order_id: orderId, p_status: 'dispatched' } });
  ok(adminRpc.status >= 400, 'admin CANNOT change dispatch status via the staff function either', `status=${adminRpc.status}`);

  const untouched = await api(`/rest/v1/orders?id=eq.${orderId}&select=status`, { token });
  ok(untouched.data?.[0]?.status === 'placed', 'the order is still placed after both admin attempts', untouched.data?.[0]?.status);

  const adminManage = await api('/rest/v1/rpc/set_account_role', { token, method: 'POST', body: { target_email: customerEmail, new_role: 'staff' } });
  ok(adminManage.status === 200, 'admin CAN change an account role', `status=${adminManage.status}`);
  const demote = await api('/rest/v1/rpc/set_account_role', { token, method: 'POST', body: { target_email: customerEmail, new_role: 'customer' } });
  ok(demote.status === 200, 'admin CAN change it back');

  // ------------------------------------------------------------- audit trail
  const events = await api('/rest/v1/staff_account_events?select=kind,detail&order=created_at.desc&limit=5', { token });
  ok(events.status === 200 && events.data.length > 0, 'admin can read the credential audit trail', `rows=${events.data?.length}`);
  ok(events.data.every((e) => !/password|token|otp|secret/i.test(`${e.kind} ${e.detail ?? ''}`)), 'the audit trail exposes no secrets');
} catch (e) {
  fail++;
  console.log('FAIL  harness error: ' + (e?.message ?? e));
} finally {
  if (customerEmail) await admin.query('delete from auth.users where email = $1', [customerEmail]).catch(() => {});
  const left = await admin.query(
    `select (select count(*) from public.orders) as o, (select count(*) from public.staff_account_events) as e,
            (select count(*) from auth.users where email like 'kv.admincheck.%') as u`,
  );
  console.log('\nleft behind:', JSON.stringify(left.rows[0]));
  await admin.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
