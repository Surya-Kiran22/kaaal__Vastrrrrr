// Live check of the staff account lifecycle and dispatch permissions.
//
//   $env:KV_DB_URL = "postgresql://..."
//   npm run verify:staff
//
// Verifies the requirement that staff own the dispatch log while admins may
// read it but cannot change it -- and that the rejection happens in the
// database, not only because a button is disabled. All test rows are removed.
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
if (!URL_ || !KEY || !process.env.KV_DB_URL) {
  console.error('Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and KV_DB_URL.');
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

const errCode = (r) => {
  const m = /error_code["\s:]+([a-z_0-9]+)/i.exec(r.raw ?? '');
  const m2 = /SQLSTATE\s+([0-9A-Z]+)/i.exec(r.raw ?? '');
  return m?.[1] ?? m2?.[1] ?? r.raw?.slice(0, 80);
};

// Mirrors what the edge function / bootstrap script does: create the auth user,
// then promote the profile with a role. `confirmed: false` reproduces an
// invited staff member who has not yet entered their OTP code.
async function makeUser(tag, role, { confirmed = true } = {}) {
  const email = `kv.staff.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@gmail.com`;
  const password = `T-${Math.random().toString(36).slice(2, 10)}-Aa1!`;
  const id = crypto.randomUUID();

  await admin.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
        $2, $3, $4, '{"provider":"email","providers":["email"]}', $5::jsonb,
        '', '', '', '', now(), now())`,
    [id, email, bcrypt.hashSync(password, 10), confirmed ? new Date() : null, JSON.stringify({ full_name: `Test ${tag}`, phone: '+91 90000 11111' })],
  );
  await admin.query(
    `insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
     values ($1, $1, $2::jsonb, 'email', $3, now(), now(), now())`,
    [id, JSON.stringify({ sub: id, email, email_verified: confirmed, phone_verified: false }), email],
  );

  if (role !== 'customer') {
    await admin.query(
      `update public.profiles set role = $2, status = $3, email_verified_at = $4 where id = $1`,
      [id, role, confirmed ? 'active' : 'invited', confirmed ? new Date() : null],
    );
  }

  const tok = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  return { email, id, token: tok.data?.access_token, confirmed, role };
}

await admin.connect();

// The audit table is append-only and legitimately holds the owner's bootstrap
// entry, so capture its size now and require it to be unchanged at the end
// rather than demanding zero.
const eventsBefore = Number((await admin.query('select count(*)::int as n from public.staff_account_events')).rows[0].n);

try {
  await admin.query("delete from auth.users where email like 'kv.staff.%@gmail.com'");

  const boss = await makeUser('admin', 'admin');
  const staffer = await makeUser('staffer', 'staff');
  const customer = await makeUser('cust', 'customer');
  const other = await makeUser('other', 'customer');
  const invited = await makeUser('invited', 'staff', { confirmed: false });

  ok(!!boss.token && !!staffer.token && !!customer.token, 'admin, staff and customer all hold a session');
  ok(!invited.token, 'an invited-but-unverified staff account cannot sign in with a password yet', `token=${invited.token ? 'present' : 'absent'}`);

  // ------------------------------------------------------- role escalation
  const selfPromote = await api(`/rest/v1/profiles?id=eq.${customer.id}`, { token: customer.token, method: 'PATCH', body: { role: 'admin' } });
  ok(selfPromote.status >= 400, 'customer cannot promote themselves to admin with a direct write', `status=${selfPromote.status}`);

  const custPromote = await api('/rest/v1/rpc/promote_to_admin', { token: customer.token, method: 'POST', body: { target_email: customer.email } });
  ok(custPromote.status >= 400, 'customer calling promote_to_admin is rejected', `status=${custPromote.status} ${errCode(custPromote)}`);

  const staffPromote = await api('/rest/v1/rpc/promote_to_admin', { token: staffer.token, method: 'POST', body: { target_email: other.email } });
  ok(staffPromote.status >= 400, 'staff cannot promote accounts either', `status=${staffPromote.status}`);

  const adminPromote = await api('/rest/v1/rpc/promote_to_admin', { token: boss.token, method: 'POST', body: { target_email: other.email } });
  ok(adminPromote.status === 200, 'admin CAN promote an account', `status=${adminPromote.status} ${adminPromote.raw.slice(0, 90)}`);

  // Roll the accidental promotion back so later checks stay honest.
  await admin.query("update public.profiles set role = 'customer' where id = $1", [other.id]);
  await admin.query("delete from public.staff_account_events where profile_id = $1", [other.id]);

  const custSetRole = await api('/rest/v1/rpc/set_account_role', { token: customer.token, method: 'POST', body: { target_email: customer.email, new_role: 'admin' } });
  ok(custSetRole.status >= 400, 'customer cannot call set_account_role', `status=${custSetRole.status}`);

  const adminSetRole = await api('/rest/v1/rpc/set_account_role', { token: boss.token, method: 'POST', body: { target_email: customer.email, new_role: 'staff' } });
  ok(adminSetRole.status === 200, 'admin CAN promote a customer to staff', `status=${adminSetRole.status}`);
  await admin.query("update public.profiles set role = 'customer' where id = $1", [customer.id]);
  await admin.query("delete from public.staff_account_events where profile_id = $1", [customer.id]);

  const selfSuspend = await api('/rest/v1/rpc/set_account_role', { token: boss.token, method: 'POST', body: { target_email: boss.email, new_role: 'admin', suspend: true } });
  ok(selfSuspend.status >= 400, 'admin cannot suspend their own account (no lockout)', `status=${selfSuspend.status}`);

  // ------------------------------------------- invited -> verified lifecycle
  const beforeVerify = await admin.query('select status, email_verified_at from public.profiles where id = $1', [invited.id]);
  ok(beforeVerify.rows[0].status === 'invited' && beforeVerify.rows[0].email_verified_at === null, 'invited staff starts unverified', JSON.stringify(beforeVerify.rows[0]));

  // This is what the customer/staff OTP confirmation does inside Supabase.
  await admin.query('update auth.users set email_confirmed_at = now() where id = $1', [invited.id]);
  const afterVerify = await admin.query('select status, email_verified_at, activated_at from public.profiles where id = $1', [invited.id]);
  ok(afterVerify.rows[0].status === 'active', 'verifying the email flips status invited -> active', afterVerify.rows[0].status);
  ok(afterVerify.rows[0].email_verified_at !== null, 'email_verified_at is mirrored from auth.users automatically');
  ok(afterVerify.rows[0].activated_at !== null, 'activated_at is stamped on first verification');

  // ------------------------------------------------------ suspension
  const consoleOk = async (u) => (await api('/rest/v1/rpc/can_use_staff_console', { token: u.token, method: 'POST' })).data;

  // A suspended staff member must not be able to edit their own way back in.
  // This was a real hole: profiles_update_own is row-scoped, not column-scoped,
  // so is_active / status / suspended_at were all self-writable.
  await api('/rest/v1/rpc/set_account_role', { token: boss.token, method: 'POST', body: { target_email: staffer.email, new_role: 'staff', suspend: true } });
  ok((await consoleOk(staffer)) === false, 'suspended staff are locked out of the staff console');
  const selfReinstate = await api(`/rest/v1/profiles?id=eq.${staffer.id}`, {
    token: staffer.token,
    method: 'PATCH',
    body: { is_active: true, status: 'active', suspended_at: null },
  });
  ok(selfReinstate.status >= 400, 'suspended staff cannot self-reinstate via a direct profile write', `status=${selfReinstate.status} ${selfReinstate.raw?.slice(0, 90)}`);
  const selfVerify = await api(`/rest/v1/profiles?id=eq.${staffer.id}`, { token: staffer.token, method: 'PATCH', body: { email_verified_at: new Date().toISOString() } });
  ok(selfVerify.status >= 400, 'staff cannot self-mark their email as verified', `status=${selfVerify.status}`);
  const selfPhone = await api(`/rest/v1/profiles?id=eq.${staffer.id}&select=phone`, { token: staffer.token, method: 'PATCH', body: { phone: '+91 90000 22222' } });
  ok(selfPhone.status === 204, 'staff CAN still edit their own name and phone', `status=${selfPhone.status} ${selfPhone.raw?.slice(0, 90)}`);
  await api('/rest/v1/rpc/set_account_role', { token: boss.token, method: 'POST', body: { target_email: staffer.email, new_role: 'staff', suspend: false } });
  ok((await consoleOk(staffer)) === true, 'reactivating a suspended staff account restores access');

  // ------------------------------------------------------ suspension
  const badSuspend = await admin.query("update public.profiles set status = 'suspended' where id = $1", [customer.id]).then(() => ({ ok: true }), (e) => ({ ok: false, msg: e.message }));
  ok(!badSuspend.ok, 'status=suspended with is_active=true is rejected by a check constraint', badSuspend.msg?.slice(0, 80));

  ok((await consoleOk(staffer)) === true, 'active staff may use the staff console');
  ok((await consoleOk(customer)) === false, 'customer may not use the staff console');
  ok((await consoleOk(boss)) === true, 'admin may use the staff console');


  // --------------------------------------------------------- the dispatch log
  const order = await api('/rest/v1/orders', {
    token: customer.token,
    method: 'POST',
    prefer: 'return=representation',
    body: { customer_name: 'Test Cust', customer_phone: '+91 90000 11111', delivery: { label: 'Home', line1: '1 Test St', city: 'Bengaluru', state: 'KA', pincode: '560001' } },
  });
  ok(order.status === 201 && order.data[0].status === 'placed', 'a new order starts as placed', `status=${order.status} state=${order.data?.[0]?.status}`);
  const orderId = order.data[0].id;

  await api('/rest/v1/order_items', {
    token: customer.token,
    method: 'POST',
    body: [{ order_id: orderId, name: 'Obsidian Tee', color: 'Obsidian', size: 'M', unit_price: 1299, compare_at_price: 1599, quantity: 2, line_total: 2598 }],
  });

  // THE core requirement: nobody can write status directly.
  for (const [label, tok] of [['admin', boss.token], ['staff', staffer.token], ['customer', customer.token]]) {
    const direct = await api(`/rest/v1/orders?id=eq.${orderId}`, { token: tok, method: 'PATCH', body: { status: 'delivered' } });
    ok(direct.status >= 400, `${label} cannot PATCH order status directly`, `status=${direct.status}`);
  }

  const custCancelFlag = await api(`/rest/v1/orders?id=eq.${orderId}`, { token: customer.token, method: 'PATCH', body: { cancel_requested: true } });
  ok(custCancelFlag.status >= 400, 'customer cannot PATCH cancel_requested directly either (RPC only)', `status=${custCancelFlag.status}`);

  // Admin reads the log but must not be able to change it.
  const adminRead = await api(`/rest/v1/orders?id=eq.${orderId}&select=reference,status`, { token: boss.token });
  ok(adminRead.status === 200 && adminRead.data.length === 1, 'admin CAN read the dispatch log', `status=${adminRead.status}`);

  const adminWrite = await api('/rest/v1/rpc/set_order_status', { token: boss.token, method: 'POST', body: { p_order_id: orderId, p_status: 'dispatched' } });
  ok(adminWrite.status >= 400, 'ADMIN IS REJECTED by the database when changing dispatch status', `status=${adminWrite.status} ${errCode(adminWrite)}`);

  const custWrite = await api('/rest/v1/rpc/set_order_status', { token: customer.token, method: 'POST', body: { p_order_id: orderId, p_status: 'dispatched' } });
  ok(custWrite.status >= 400, 'customer is rejected when changing dispatch status', `status=${custWrite.status}`);

  const stillPlaced = await admin.query('select status from public.orders where id = $1', [orderId]);
  ok(stillPlaced.rows[0].status === 'placed', 'the order is untouched after all four rejected attempts', stillPlaced.rows[0].status);

  // Staff can, and each transition is attributed.
  const s1 = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: orderId, p_status: 'contacted', p_note: 'Called the customer' } });
  ok(s1.status === 200 && s1.data?.status === 'contacted', 'staff CAN move an order to contacted', `status=${s1.status}`);
  ok(s1.data?.status_updated_by === staffer.id, 'the transition is attributed to the staff member who made it');
  ok(s1.data?.contacted_at !== null, 'contacted_at is stamped');

  // Backwards transition is rejected.
  const backwards = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: orderId, p_status: 'placed' } });
  ok(backwards.status >= 400, 'a contacted order cannot silently go back to placed', `status=${backwards.status}`);

  const s2 = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: orderId, p_status: 'dispatched' } });
  ok(s2.status === 200 && s2.data?.dispatched_at !== null, 'staff CAN move to dispatched and it is timestamped');

  const cancelAfterDispatch = await api('/rest/v1/rpc/request_order_cancellation', { token: customer.token, method: 'POST', body: { p_order_id: orderId } });
  ok(cancelAfterDispatch.status >= 400, 'customer cannot request cancellation once the order is dispatched', `status=${cancelAfterDispatch.status}`);

  // Cancellation request on a fresh order.
  const order2 = await api('/rest/v1/orders', { token: customer.token, method: 'POST', prefer: 'return=representation', body: { customer_name: 'Test Cust', customer_phone: '+91 90000 11111' } });
  const order2Id = order2.data[0].id;
  const wrongOwner = await api('/rest/v1/rpc/request_order_cancellation', { token: other.token, method: 'POST', body: { p_order_id: order2Id } });
  ok(wrongOwner.status >= 400, "another customer cannot request cancellation of someone else's order", `status=${wrongOwner.status}`);
  const noLeak = !/status/i.test(wrongOwner.raw) || /not found/i.test(wrongOwner.raw);
  ok(noLeak, 'the rejection does not reveal that the order exists', wrongOwner.raw.slice(0, 90));

  const askCancel = await api('/rest/v1/rpc/request_order_cancellation', { token: customer.token, method: 'POST', body: { p_order_id: order2Id } });
  ok(askCancel.status === 200 && askCancel.data?.cancel_requested === true, 'the owner CAN request a cancellation', `status=${askCancel.status}`);

  const staffSeeFlag = await admin.query('select cancel_requested from public.orders where id = $1', [order2Id]);
  ok(staffSeeFlag.rows[0].cancel_requested === true, 'the request is visible for staff to action');

  const adminCannotResolve = await api('/rest/v1/rpc/set_order_status', { token: boss.token, method: 'POST', body: { p_order_id: order2Id, p_status: 'cancelled' } });
  ok(adminCannotResolve.status >= 400, 'admin cannot resolve a cancellation request either', `status=${adminCannotResolve.status}`);

  const staffResolve = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: order2Id, p_status: 'cancelled', p_note: 'Customer asked to cancel' } });
  ok(staffResolve.status === 200 && staffResolve.data?.status === 'cancelled' && staffResolve.data?.cancel_requested === false, 'staff CAN resolve it, and the request flag clears', `status=${staffResolve.status}`);

  const afterCancel = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: order2Id, p_status: 'placed' } });
  ok(afterCancel.status >= 400, 'a cancelled order is terminal', `status=${afterCancel.status}`);

  await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: orderId, p_status: 'delivered' } });
  const afterDelivered = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: orderId, p_status: 'contacted' } });
  ok(afterDelivered.status >= 400, 'a delivered order is terminal', `status=${afterDelivered.status}`);

  const badStatus = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: orderId, p_status: 'teleported' } });
  ok(badStatus.status >= 400, 'an invented status is rejected', `status=${badStatus.status}`);

  const ghostOrder = await api('/rest/v1/rpc/set_order_status', { token: staffer.token, method: 'POST', body: { p_order_id: crypto.randomUUID(), p_status: 'contacted' } });
  ok(ghostOrder.status >= 400, 'a nonexistent order is rejected', `status=${ghostOrder.status}`);

  // -------------------------------------------------------- visibility
  const custSeesOwn = await api('/rest/v1/orders?select=id', { token: customer.token });
  const custSeesCount = await admin.query('select count(*)::int as n from public.orders');
  ok(custSeesOwn.data.length === Number(custSeesCount.rows[0].n) - 0, 'customer sees their own orders', `rows=${custSeesOwn.data.length}`);
  const otherSees = await api('/rest/v1/orders?select=id', { token: other.token });
  ok(otherSees.data.length === 0, "another customer sees none of them", `rows=${otherSees.data.length}`);
  const staffSees = await api('/rest/v1/orders?select=id', { token: staffer.token });
  ok(staffSees.data.length >= 2, 'staff sees the whole dispatch log', `rows=${staffSees.data.length}`);

  const staffProfiles = await api('/rest/v1/profiles?select=id,email,role', { token: staffer.token });
  ok(
    staffProfiles.status === 200 && staffProfiles.data.length === 1 && staffProfiles.data[0].id === staffer.id,
    'staff can read their own profile but nobody else\'s',
    `rows=${staffProfiles.data?.length}`,
  );
  const adminProfiles = await api('/rest/v1/profiles?select=email,role,status', { token: boss.token });
  ok(adminProfiles.status === 200 && adminProfiles.data.length >= 4, 'admin CAN list accounts for the staff screen', `rows=${adminProfiles.data?.length}`);

  const staffEvents = await api('/rest/v1/staff_account_events?select=kind', { token: staffer.token });
  ok(staffEvents.status === 200 && staffEvents.data.length === 0, 'staff cannot read the credential audit trail', `rows=${staffEvents.data?.length}`);
  const adminEvents = await api('/rest/v1/staff_account_events?select=kind,detail', { token: boss.token });
  ok(adminEvents.status === 200 && adminEvents.data.length > 0, 'admin CAN read the credential audit trail', `rows=${adminEvents.data?.length}`);
  const kinds = new Set(adminEvents.data.map((e) => e.kind));
  ok(![...kinds].some((k) => /password|token|otp/i.test(k)), 'the audit trail records no password/token/OTP entries', [...kinds].join(','));

  // anon has no privilege on the table at all, so an error is the expected and
  // stricter outcome; an empty list would also be acceptable.
  const anonEvents = await api('/rest/v1/staff_account_events?select=kind');
  ok(anonEvents.status >= 400 || anonEvents.data?.length === 0, 'anon cannot read the audit trail', `status=${anonEvents.status}`);

  // ------------------------------------------------------------ realtime
  const pub = await admin.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`);
  const published = pub.rows.map((r) => r.tablename);
  for (const t of ['orders', 'order_items', 'products', 'profiles', 'business_settings']) {
    ok(published.includes(t), `${t} is in the supabase_realtime publication`);
  }

  // ------------------------------------------------------------- cleanup
  const emails = [boss, staffer, customer, other, invited].map((u) => u.email);
  await admin.query('delete from auth.users where email = any($1)', [emails]);
  const left = await admin.query(
    `select (select count(*) from public.orders) as o, (select count(*) from public.order_items) as i,
            (select count(*) from public.staff_account_events) as e, (select count(*) from auth.users where email like 'kv.staff.%') as u`,
  );
  ok(
    Number(left.rows[0].o) === 0 && Number(left.rows[0].i) === 0 && Number(left.rows[0].u) === 0 && Number(left.rows[0].e) === eventsBefore,
    'all test rows and users removed, and the real audit trail is untouched',
    JSON.stringify(left.rows[0]),
  );
} catch (e) {
  fail++;
  console.log('FAIL  harness error: ' + (e?.message ?? e));
} finally {
  await admin.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

