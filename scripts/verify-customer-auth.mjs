// End-to-end check of the customer account layer against a real Supabase
// project. It seeds two throwaway auth users, exercises the signup -> verify ->
// sign-in -> checkout -> order-history path over the real REST API, and asserts
// that neither customer can see the other's data and that anon can see nothing.
//
//   $env:KV_DB_URL = "postgresql://..."   # direct or pooler connection string
//   npm run verify:auth
//
// The two test users and every row that cascades from them are deleted at the
// end, so the database is left exactly as it was found.
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

if (!URL_ || !KEY) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}
if (!process.env.KV_DB_URL) {
  console.error('KV_DB_URL must be set, e.g.\n  $env:KV_DB_URL = "postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres"');
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

// GoTrue's own confirmation email is rate limited on this project, so seed the
// auth rows directly. The handle_new_user trigger fires on INSERT exactly as it
// does for a real /auth/v1/signup, and password grant returns a genuine JWT.
async function makeCustomer(tag) {
  const email = `kv.test.${tag.toLowerCase()}.${Date.now()}@gmail.com`;
  const password = `T-${Math.random().toString(36).slice(2, 10)}-Aa1!`;
  const phone = '+91 90000 0000' + (tag === 'A' ? '1' : '2');
  const full_name = `Test ${tag}`;
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  const meta = { sub: id, email, email_verified: true, phone_verified: false };

  await admin.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
        $2, $3, now(), '{"provider":"email","providers":["email"]}', $4::jsonb,
        '', '', '', '', now(), now())`,
    [id, email, hash, JSON.stringify({ full_name, phone })],
  );
  await admin.query(
    `insert into auth.identities (id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at)
     values ($1, $1, $2::jsonb, 'email', $3, now(), now(), now())`,
    [id, JSON.stringify(meta), email],
  );

  const tok = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!tok.data?.access_token) throw new Error(`signin ${tag} failed: ${tok.status} ${tok.raw}`);
  return { email, id, token: tok.data.access_token, userId: tok.data.user?.id };
}

await admin.connect();
await admin.query("delete from auth.users where email like 'kv.test.%@gmail.com'");

try {
  // ---------------------------------------------------------------- signup
  const a = await makeCustomer('A');
  const b = await makeCustomer('B');
  console.log(`\n   A=${a.email}\n   B=${b.email}\n`);

  // -------------------------------------------------------------- profile
  const profA = await api(`/rest/v1/profiles?id=eq.${a.id}&select=id,role,full_name,phone,is_active`, { token: a.token });
  ok(profA.status === 200 && profA.data.length === 1, 'A can read own profile');
  ok(profA.data[0]?.role === 'customer', 'new signup gets role=customer', profA.data[0]?.role);
  ok(profA.data[0]?.phone === '+91 90000 00001', 'phone copied from signup metadata', String(profA.data[0]?.phone));
  ok(profA.data[0]?.full_name === 'Test A', 'full_name copied from signup metadata');

  const allProf = await api('/rest/v1/profiles?select=id,email', { token: a.token });
  ok(allProf.status === 200 && allProf.data.length === 1 && allProf.data[0].id === a.id, 'A cannot read B\'s profile', `rows=${allProf.data?.length}`);

  // ------------------------------------------------------------ addresses
  const addrEmpty = await api('/rest/v1/addresses?select=id,is_default', { token: a.token });
  ok(addrEmpty.status === 200 && addrEmpty.data.length === 0, 'A starts with an empty address book');

  const addr1 = await api('/rest/v1/addresses', {
    token: a.token,
    method: 'POST',
    prefer: 'return=representation',
    body: { label: 'Home', full_name: 'Test A', phone: '+91 90000 00001', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', is_default: false },
  });
  ok(addr1.status === 201, 'A can create an address', `status=${addr1.status} ${addr1.raw.slice(0, 120)}`);

  const addr2 = await api('/rest/v1/addresses', {
    token: a.token,
    method: 'POST',
    prefer: 'return=representation',
    body: { label: 'Work', full_name: 'Test A', phone: '+91 90000 00001', line1: '44 Residency Rd', city: 'Bengaluru', state: 'Karnataka', pincode: '560025', is_default: true },
  });
  ok(addr2.status === 201, 'A can create a second address', `status=${addr2.status}`);

  const addrs = await api('/rest/v1/addresses?select=label,is_default&order=created_at', { token: a.token });
  const defaults = addrs.data.filter((x) => x.is_default);
  ok(defaults.length === 1 && defaults[0].label === 'Work', 'only one default address survives (trigger demotes the old one)', JSON.stringify(addrs.data));

  const badAddr = await api('/rest/v1/addresses', { token: a.token, method: 'POST', body: { label: 'Broken', full_name: 'No street, no pincode' } });
  ok(badAddr.status === 400, 'incomplete address rejected by CHECK constraints', `status=${badAddr.status} ${badAddr.raw.slice(0, 110)}`);

  const addrDelete = addr2.data?.[0]
    ? await api(`/rest/v1/addresses?id=eq.${addr2.data[0].id}`, { token: a.token, method: 'DELETE' })
    : { status: 0, raw: 'skipped: address 2 was never created' };
  ok(addrDelete.status === 204, 'A can delete an address', `status=${addrDelete.status}`);

  // --------------------------------------------------------------- orders
  const ref = await api('/rest/v1/rpc/new_order_reference', { token: a.token, method: 'POST' });
  ok(ref.status === 200 && /^KV-\d{6}-[0-9A-F]{6}$/.test(ref.data), 'reference generator returns a formatted reference', String(ref.data));

  // Deliberately lie about the money: the DB must overwrite it from the lines.
  const order = await api('/rest/v1/orders', {
    token: a.token,
    method: 'POST',
    prefer: 'return=representation',
    body: { item_count: 999, subtotal: 1, savings: 0, total: 1, customer_name: 'Test A', customer_phone: '+91 90000 00001' },
  });
  ok(order.status === 201, 'A can create an order with no user_id in the payload', `status=${order.status} ${order.raw.slice(0, 160)}`);
  ok(/^KV-\d{6}-[0-9A-F]{6}$/.test(order.data?.[0]?.reference ?? ''), 'order reference is generated server-side in the branded format', String(order.data?.[0]?.reference));
  ok(order.data?.[0]?.reference !== ref.data, 'client cannot dictate the reference (a fresh one was minted)');
  ok(order.data?.[0]?.user_id === a.id, 'order is owned by the JWT subject, not the payload');
  ok(Number(order.data?.[0]?.total) === 0, 'client-supplied totals are zeroed on insert', String(order.data?.[0]?.total));
  const orderId = order.data?.[0]?.id;

  const items = await api('/rest/v1/order_items', {
    token: a.token,
    method: 'POST',
    prefer: 'return=representation',
    body: [
      { order_id: orderId, product_id: null, name: 'Obsidian Tee â€” Boxy', sku: 'KV-TEE-001', color: 'Obsidian', size: 'M', unit_price: 1299, compare_at_price: 1599, quantity: 2, line_total: 2598 },
      { order_id: orderId, product_id: null, name: 'Chrome Hoodie', sku: 'KV-HOD-002', color: 'Silver', size: 'L', unit_price: 2499, compare_at_price: null, quantity: 1, line_total: 2499 },
    ],
  });
  ok(items.status === 201 && items.data.length === 2, 'A can add line items to the order', `status=${items.status} ${items.raw.slice(0, 160)}`);

  const recalc = await api(`/rest/v1/orders?id=eq.${orderId}&select=reference,item_count,subtotal,savings,total,status`, { token: a.token });
  const r = recalc.data?.[0];
  const expectedSubtotal = 1299 * 2 + 2499;
  const expectedSavings = (1599 - 1299) * 2;
  ok(r?.item_count === 3, 'item_count recalculated from lines (client said 999)', String(r?.item_count));
  ok(Number(r?.subtotal) === expectedSubtotal, 'subtotal recalculated from lines', `${r?.subtotal} vs ${expectedSubtotal}`);
  ok(Number(r?.savings) === expectedSavings, 'savings recalculated from compare-at prices', `${r?.savings} vs ${expectedSavings}`);
  ok(Number(r?.total) === expectedSubtotal, 'total equals subtotal (client said 1)', String(r?.total));

  const cheatTotal = await api(`/rest/v1/orders?id=eq.${orderId}`, { token: a.token, method: 'PATCH', body: { total: 1, subtotal: 1 } });
  ok(cheatTotal.status >= 400, 'customer CANNOT rewrite order money columns', `status=${cheatTotal.status}`);

  const cheatCount = await api(`/rest/v1/orders?id=eq.${orderId}`, { token: a.token, method: 'PATCH', body: { item_count: 0 } });
  ok(cheatCount.status >= 400, 'customer CANNOT rewrite item_count', `status=${cheatCount.status}`);

  const cancel = await api('/rest/v1/rpc/request_order_cancellation', { token: a.token, method: 'POST', body: { p_order_id: orderId } });
  ok(cancel.status === 200 && cancel.data?.cancel_requested === true, 'customer CAN request cancellation of their own order', `status=${cancel.status}`);

  const delItems = await api(`/rest/v1/order_items?order_id=eq.${orderId}`, { token: a.token, method: 'DELETE' });
  ok(delItems.status >= 400, 'customer CANNOT delete line items (snapshot integrity)', `status=${delItems.status}`);

  const updItems = await api(`/rest/v1/order_items?id=eq.${items.data[0].id}`, { token: a.token, method: 'PATCH', body: { unit_price: 1 } });
  ok(updItems.status >= 400, 'customer CANNOT reprice a line item', `status=${updItems.status}`);

  // --------------------------------------------------------- cross-account
  const bAddrs = await api('/rest/v1/addresses?select=id,label', { token: b.token });
  ok(bAddrs.status === 200 && bAddrs.data.length === 0, 'B sees none of A\'s addresses', `rows=${bAddrs.data?.length}`);
  const bOrders = await api('/rest/v1/orders?select=id,reference', { token: b.token });
  ok(bOrders.status === 200 && bOrders.data.length === 0, 'B sees none of A\'s orders', `rows=${bOrders.data?.length}`);
  const bPeek = await api(`/rest/v1/orders?id=eq.${orderId}&select=reference`, { token: b.token });
  ok(bPeek.status === 200 && bPeek.data.length === 0, 'B cannot fetch A\'s order by id (owner-scoped, not just list-scoped)');
  const bItemPeek = await api(`/rest/v1/order_items?order_id=eq.${orderId}&select=name`, { token: b.token });
  ok(bItemPeek.status === 200 && bItemPeek.data.length === 0, 'B cannot read A\'s line items via the parent-order policy');

  // ----------------------------------------------------------------- anon
  const anonAddr = await api('/rest/v1/addresses', { method: 'POST', body: { label: 'x', line1: 'y', city: 'z', pincode: '1' } });
  ok(anonAddr.status === 401 || anonAddr.status === 403, 'anon cannot insert an address', `status=${anonAddr.status}`);
  const anonOrders = await api('/rest/v1/orders?select=id,reference');
  ok(anonOrders.status === 200 && anonOrders.data.length === 0, 'anon sees no orders');
  const anonAddrRead = await api('/rest/v1/addresses?select=id,label');
  ok(anonAddrRead.status >= 400 || anonAddrRead.data?.length === 0, 'anon cannot read customer addresses', `status=${anonAddrRead.status}`);
  const anonRef = await api('/rest/v1/rpc/new_order_reference', { method: 'POST' });
  ok(anonRef.status === 401 || anonRef.status === 403, 'anon cannot call the reference generator', `status=${anonRef.status}`);
  const anonProfiles = await api('/rest/v1/profiles?select=id,email,role');
  ok(anonProfiles.status === 200 && anonProfiles.data.length === 0, 'anon sees no profiles');
  const anonElevate = await api(`/rest/v1/profiles?id=eq.${a.id}`, { method: 'PATCH', body: { role: 'admin' } });
  ok(anonElevate.status === 401 || anonElevate.status === 403, 'anon cannot promote a profile to admin', `status=${anonElevate.status}`);

  // ------------------------------------------------- privilege regression
  // Audited without joining information_schema to pg_proc: routine_privileges
  // reports specific_name as `proname_oid`, so a naive join on proname silently
  // matches nothing and reports a false pass.
  const [privs, extFns] = await Promise.all([
    admin.query(`
      select routine_name,
             string_agg(distinct grantee, ',' order by grantee) filter (where grantee in ('PUBLIC', 'anon'))  as pub_or_anon,
             string_agg(distinct grantee, ',' order by grantee) filter (where grantee = 'authenticated')       as authed
        from information_schema.routine_privileges
       where routine_schema = 'public' and privilege_type = 'EXECUTE'
       group by routine_name`),
    admin.query(`
      select distinct p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_depend d on d.objid = p.oid and d.deptype = 'e'
       where n.nspname = 'public'`),
  ]);
  const extNames = new Set(extFns.rows.map((r) => r.proname));
  const appFns = privs.rows.filter((r) => !extNames.has(r.routine_name));

  // Functions a signed-in role legitimately needs: the RLS helpers referenced
  // inside policies, plus the four guarded entry points that re-check a role
  // server-side (staff dispatch, cancellation requests, account management and
  // the staff-console gate). Everything else must be unreachable.
  const authenticatedHelpers = [
    'is_admin',
    'is_staff_or_admin',
    'my_profile_role',
    'my_profile_is_active',
    'promote_to_admin',
    'new_order_reference',
    'set_account_role',
    'set_order_status',
    'request_order_cancellation',
    'can_use_staff_console',
  ];
  // Only these two are referenced by a policy that an anonymous read evaluates,
  // so anon must be able to execute them or public catalogue reads break.
  const anonHelpers = ['is_admin', 'is_staff_or_admin'];

  const mustBeLocked = appFns.filter(
    (r) => !authenticatedHelpers.includes(r.routine_name) && (r.pub_or_anon || r.authed),
  );
  ok(mustBeLocked.length === 0, 'no non-RLS application function is executable by anon/PUBLIC/authenticated', JSON.stringify(mustBeLocked));

  const helperState = Object.fromEntries(
    appFns.filter((r) => authenticatedHelpers.includes(r.routine_name)).map((r) => [r.routine_name, r]),
  );
  const missing = authenticatedHelpers.filter((n) => !helperState[n]?.authed);
  ok(missing.length === 0, `all ${authenticatedHelpers.length} guarded helpers are executable by authenticated`, `missing=${JSON.stringify(missing)}`);
  const leaked = authenticatedHelpers.filter((n) => !anonHelpers.includes(n) && helperState[n]?.pub_or_anon);
  ok(leaked.length === 0, 'no customer/staff-only helper is executable by anon', `leaked=${JSON.stringify(leaked)}`);
  const anonAllowed = anonHelpers.filter((n) => helperState[n]?.pub_or_anon === 'anon');
  ok(anonAllowed.length === anonHelpers.length, 'the 2 policy helpers anon depends on are still executable', JSON.stringify(anonAllowed));
  ok(appFns.length === 21, 'every application function in public is accounted for', `count=${appFns.length}`);

  // And nobody keeps TRUNCATE, which bypasses RLS entirely.
  const truncHolders = await admin.query(`
    select grantee, table_name from information_schema.table_privileges
     where table_schema = 'public' and privilege_type = 'TRUNCATE'
       and grantee in ('anon', 'authenticated')`);
  ok(truncHolders.rows.length === 0, 'no client role holds TRUNCATE on any public table', JSON.stringify(truncHolders.rows));
  const triggerHolders = await admin.query(`
    select grantee, table_name from information_schema.table_privileges
     where table_schema = 'public' and privilege_type in ('TRIGGER', 'REFERENCES')
       and grantee in ('anon', 'authenticated')`);
  ok(triggerHolders.rows.length === 0, 'no client role holds TRIGGER or REFERENCES on any public table', JSON.stringify(triggerHolders.rows));

  // Triggers must still fire after the privilege lockdown.
  const trigStillFires = await api('/rest/v1/addresses', {
    token: a.token,
    method: 'POST',
    prefer: 'return=representation',
    body: { label: 'Post-lockdown', full_name: 'Test A', phone: '+91 90000 00001', line1: '1 Test St', city: 'Bengaluru', state: 'KA', pincode: '560001' },
  });
  ok(trigStillFires.status === 201, 'triggers still fire after revoking their EXECUTE privilege', `status=${trigStillFires.status}`);

  // Public catalogue must be unaffected: anon reads depend on is_staff_or_admin.
  const anonProducts = await api('/rest/v1/products?select=id&limit=50');
  ok(anonProducts.status === 200 && anonProducts.data.length === 12, 'anon can still read all 12 public products after the lockdown', `status=${anonProducts.status} rows=${anonProducts.data?.length}`);
  const anonSettings = await api('/rest/v1/business_settings?select=business_name,whatsapp_number');
  ok(anonSettings.status === 200 && anonSettings.data?.[0]?.business_name === 'Kaal Vastr', 'anon can still read business settings', `status=${anonSettings.status}`);
  const anonAdminHelper = await api('/rest/v1/rpc/is_admin', { method: 'POST' });
  ok(anonAdminHelper.status === 200 && anonAdminHelper.data === false, 'anon calling is_admin() directly returns false', String(anonAdminHelper.data));

  if (trigStillFires.data?.[0]?.id) {
    await api(`/rest/v1/addresses?id=eq.${trigStillFires.data[0].id}`, { token: a.token, method: 'DELETE' });
  }

  // ------------------------------------------------------------- cleanup
  await admin.query('delete from auth.users where email = any($1)', [[a.email, b.email]]);
  const leftovers = await admin.query('select (select count(*) from public.addresses) as a, (select count(*) from public.orders) as o, (select count(*) from public.order_items) as i, (select count(*) from auth.users where email like $1) as u', ['kv-test-%']);
  const L = leftovers.rows[0];
  ok(Number(L.a) === 0 && Number(L.o) === 0 && Number(L.i) === 0 && Number(L.u) === 0, 'test users + all cascading rows removed', JSON.stringify(L));
} catch (e) {
  fail++;
  console.log('FAIL  harness error: ' + (e?.message ?? e));
} finally {
  await admin.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);



