#!/usr/bin/env node
/**
 * Staff account management without the Edge Function.
 *
 * `supabase functions deploy` needs the Management API, which this account
 * cannot reach (`Your account does not have the necessary privileges to access
 * this endpoint`). Until that is fixed, this script does the same job from the
 * command line.
 *
 * The one thing it cannot do is create an auth user, because that needs the
 * Admin API and therefore the service-role key. With `KV_SERVICE_ROLE_KEY` set
 * it can do everything, including invites. Without it, it can still reset,
 * reactivate, resuspend and change roles for accounts that already exist.
 *
 *   node --env-file=.env scripts/manage-staff.mjs list
 *   node --env-file=.env scripts/manage-staff.mjs invite someone@example.com --role staff
 *   node --env-file=.env scripts/manage-staff.mjs reset someone@example.com
 *   node --env-file=.env scripts/manage-staff.mjs confirm someone@example.com
 *   node --env-file=.env scripts/manage-staff.mjs role someone@example.com staff
 *   node --env-file=.env scripts/manage-staff.mjs suspend someone@example.com
 *   node --env-file=.env scripts/manage-staff.mjs restore someone@example.com
 *
 * Privileged writes go through `KV_DB_URL` and are recorded in
 * `staff_account_events`, matching what the Edge Function writes.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

const DB_URL = process.env.KV_DB_URL ?? '';
const SUPABASE_URL = process.env.KV_SERVICE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.KV_SERVICE_ROLE_KEY ?? '';

// Mirrors the function's checks so the two paths cannot drift apart.
const ROLES = new Set(['staff', 'admin']);
const PROFILE_COLUMNS =
  'id, email, full_name, role, status, is_active, created_at, invited_at, activated_at, suspended_at, email_verified_at';

const colour = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
};

function fail(message) {
  console.error(`${colour.red}error${colour.reset} ${message}`);
  process.exit(1);
}

function requireEmail(value) {
  if (!value) fail('an email address is required');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${value}" is not a valid email address`);
  return email;
}

function requireAdminEmail() {
  const email = process.env.KV_ADMIN_EMAIL ?? '';
  if (!email) {
    fail('KV_ADMIN_EMAIL is not set. It must be the email of an existing active admin.');
  }
  return email.trim().toLowerCase();
}

function connect() {
  if (!DB_URL) fail('KV_DB_URL is not set. It is the pooled Postgres connection string.');
  return new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    // The pooler does not support prepared statements for the transaction role.
    options: '-c statement_cache_mode=direct',
  });
}

/** Fail closed: confirm the actor really is an active admin before any writes. */
async function requireAdminActor(db) {
  const email = requireAdminEmail();
  const { rows } = await db.query(
    `select id, role, status, is_active
       from public.profiles
      where lower(email) = $1`,
    [email],
  );
  const actor = rows[0];
  if (!actor) fail(`no profile exists for KV_ADMIN_EMAIL (${email})`);
  if (actor.role !== 'admin') fail(`${email} is a ${actor.role}, not an admin`);
  if (!actor.is_active || actor.status !== 'active') fail(`${email} is ${actor.status}`);

  const { rows: adminRows } = await db.query(
    `select count(*)::int as total from public.profiles where role = 'admin' and status = 'active' and is_active`,
  );
  return { id: actor.id, email, adminCount: adminRows[0].total };
}

async function findProfile(db, email) {
  const { rows } = await db.query(
    `select ${PROFILE_COLUMNS} from public.profiles where lower(email) = $1`,
    [email],
  );
  return rows[0] ?? null;
}

async function recordEvent(db, { profileId, actorId, kind, detail }) {
  await db.query(
    `insert into public.staff_account_events (profile_id, actor_id, kind, detail)
     values ($1, $2, $3, $4)`,
    [profileId, actorId, kind, String(detail).slice(0, 500)],
  );
}

/** Never leave the last usable admin locked out. */
async function assertNotLastAdmin(db, target, action) {
  if (target.role !== 'admin' || target.status !== 'active' || !target.is_active) return;
  const { rows } = await db.query(
    `select count(*)::int as total
       from public.profiles
      where role = 'admin' and status = 'active' and is_active and id <> $1`,
    [target.id],
  );
  if (rows[0].total === 0) {
    fail(
      `refusing to ${action} the only active admin. Promote someone else to admin first.`,
    );
  }
}

function requireServiceKey(command) {
  if (!SERVICE_ROLE_KEY) {
    console.error(
      `${colour.red}error${colour.reset} \`${command}\` needs KV_SERVICE_ROLE_KEY.\n` +
        `  Creating or confirming an auth user requires the Admin API, and the service-role\n` +
        `  key must never be committed or sent to the browser.\n` +
        `  Set KV_SERVICE_ROLE_KEY in .env, or deploy the Edge Function instead:\n` +
        `    supabase functions deploy manage-staff`,
    );
    process.exit(1);
  }
  if (!SUPABASE_URL) fail('KV_SERVICE_URL (or VITE_SUPABASE_URL) is not set');
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findAuthUserId(admin, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((candidate) => (candidate.email ?? '').toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function list(db) {
  const { rows } = await db.query(
    `select ${PROFILE_COLUMNS}
       from public.profiles
      order by role, lower(email)`,
  );

  const staff = rows.filter((row) => row.role !== 'customer');
  const customers = rows.filter((row) => row.role === 'customer');

  const line = (row) => {
    const flag = !row.is_active || row.status !== 'active' ? colour.yellow : colour.green;
    const verified = row.email_verified_at ? 'verified' : 'unverified';
    console.log(
      `  ${row.role.padEnd(7)} ${flag}${row.status.padEnd(9)}${colour.reset} ${row.email} ` +
        `${colour.dim}(${verified}, joined ${new Date(row.created_at).toISOString().slice(0, 10)})${colour.reset}`,
    );
  };

  console.log(`${colour.bold}Console accounts (${staff.length})${colour.reset}`);
  if (staff.length === 0) console.log(`  ${colour.dim}none yet${colour.reset}`);
  for (const row of staff) line(row);

  console.log(`\n${colour.bold}Customers (${customers.length})${colour.reset}`);
  for (const row of customers) line(row);
}

async function invite(db, actor, email, role) {
  if (!ROLES.has(role)) fail(`--role must be one of ${[...ROLES].join(', ')}`);
  const admin = requireServiceKey('invite');

  const existing = await findProfile(db, email);
  if (existing) fail(`${email} already exists as ${existing.role}. Use \`role\` to change it.`);

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    // Placeholder: the emailed setup link replaces it. The account cannot sign
    // in until then, which is the point.
    password: `${randomUUID()}Kaal!9`,
  });
  if (error) {
    if (/already/i.test(error.message)) fail(`${email} already has an auth user`);
    throw error;
  }

  const userId = created.user?.id;
  // `handle_new_user` owns profile creation. If it did not run, clean up the
  // orphaned auth user rather than leave a login with no profile behind it.
  const fresh = userId ? await findProfile(db, email) : null;
  if (!fresh) {
    if (userId) await admin.auth.admin.deleteUser(userId);
    fail('the trigger did not create a profile; the auth user was removed again');
  }

  await db.query(
    `update public.profiles
        set role = $2, invited_by = $3, invited_at = now(), status = 'invited', is_active = false
      where id = $1`,
    [fresh.id, role, actor.id],
  );

  const site = process.env.KV_SITE_URL ?? SUPABASE_URL;
  const { error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${site}/staff/login` },
  });

  if (linkError) {
    await recordEvent(db, {
      profileId: fresh.id,
      actorId: actor.id,
      kind: 'invite_sent',
      detail: `invite link failed to generate: ${linkError.message}`,
    });
    fail(
      `account created as ${role}, but the invite link could not be generated (${linkError.message}).\n` +
        `  Run \`confirm\` once email is configured.`,
    );
  }

  await recordEvent(db, {
    profileId: fresh.id,
    actorId: actor.id,
    kind: 'invite_sent',
    detail: `invited as ${role}`,
  });

  console.log(
    `${colour.green}invited${colour.reset} ${email} as ${role} (status: invited, not yet verified).`,
  );
  console.log(
    `${colour.dim}  If the email does not arrive, run \`confirm ${email}\` and then \`reset ${email}\`.${colour.reset}`,
  );
}

async function confirm(db, actor, email) {
  const admin = requireServiceKey('confirm');
  const target = await findProfile(db, email);
  if (!target) fail(`no profile exists for ${email}`);

  const userId = await findAuthUserId(admin, email);
  if (!userId) fail(`no auth user exists for ${email}`);

  const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
  if (error) throw error;

  await db.query(
    `update public.profiles
        set status = 'active', is_active = true, activated_at = coalesce(activated_at, now())
      where id = $1`,
    [target.id],
  );
  await recordEvent(db, {
    profileId: target.id,
    actorId: actor.id,
    kind: 'email_verified',
    detail: 'confirmed by admin (no email)',
  });

  console.log(`${colour.green}confirmed${colour.reset} ${email}.`);
  console.log(
    `${colour.dim}  They still need a password: run \`reset ${email}\` and send them the link.${colour.reset}`,
  );
}

async function reset(db, actor, email) {
  const admin = requireServiceKey('reset');
  const target = await findProfile(db, email);
  if (!target) fail(`no profile exists for ${email}`);
  if (target.status === 'suspended') {
    fail(`${email} is suspended. Run \`restore\` before sending a link.`);
  }

  const userId = await findAuthUserId(admin, email);
  if (!userId) fail(`no auth user exists for ${email}`);

  const site = process.env.KV_SITE_URL ?? SUPABASE_URL;
  const { error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${site}/staff/login` },
  });
  if (error) throw error;

  await recordEvent(db, {
    profileId: target.id,
    actorId: actor.id,
    kind: 'password_reset_sent',
    detail: target.role,
  });
  console.log(`${colour.green}reset link sent${colour.reset} to ${email}.`);
}

async function setRole(db, actor, email, role) {
  if (!ROLES.has(role) && role !== 'customer') {
    fail(`role must be one of ${[...ROLES].join(', ')}, customer`);
  }
  const target = await findProfile(db, email);
  if (!target) fail(`no profile exists for ${email}`);
  if (target.id === actor.id) fail('you cannot change your own role');

  // Reusing the shipped function keeps the rule in one place, but it reads
  // `auth.uid()` which is empty over a direct connection. Mirror the update here
  // and write the same audit row.
  if (role === 'customer') {
    fail('demoting to customer is not supported from here; use `suspend` instead');
  }
  await assertNotLastAdmin(db, target, 'demote');

  await db.query(
    `update public.profiles
        set role = $2, status = 'active', is_active = true, suspended_at = null
      where id = $1`,
    [target.id, role],
  );
  await recordEvent(db, {
    profileId: target.id,
    actorId: actor.id,
    kind: 'role_changed',
    detail: `set to ${role}`,
  });
  console.log(`${colour.green}updated${colour.reset} ${email} → ${role}.`);
}

async function suspend(db, actor, email) {
  const target = await findProfile(db, email);
  if (!target) fail(`no profile exists for ${email}`);
  if (target.id === actor.id) fail('you cannot suspend your own account');
  if (target.status === 'suspended') {
    console.log(`${colour.dim}${email} is already suspended.${colour.reset}`);
    return;
  }
  await assertNotLastAdmin(db, target, 'suspend');

  await db.query(
    `update public.profiles
        set status = 'suspended', is_active = false, suspended_at = now()
      where id = $1`,
    [target.id],
  );
  await recordEvent(db, {
    profileId: target.id,
    actorId: actor.id,
    kind: 'suspended',
    detail: `${target.role} (suspended)`,
  });
  console.log(`${colour.green}suspended${colour.reset} ${email}.`);
}

async function restore(db, actor, email) {
  const target = await findProfile(db, email);
  if (!target) fail(`no profile exists for ${email}`);
  if (target.status !== 'suspended') {
    console.log(`${colour.dim}${email} is not suspended.${colour.reset}`);
    return;
  }

  await db.query(
    `update public.profiles
        set status = 'active', is_active = true, suspended_at = null
      where id = $1`,
    [target.id],
  );
  await recordEvent(db, {
    profileId: target.id,
    actorId: actor.id,
    kind: 'reactivated',
    detail: `${target.role} (reactivated)`,
  });
  console.log(`${colour.green}restored${colour.reset} ${email} as ${target.role}.`);
}

// ---------------------------------------------------------------------------

const USAGE = `${colour.bold}Staff account management${colour.reset}

  manage-staff list
  manage-staff invite <email> --role staff|admin
  manage-staff confirm <email>
  manage-staff reset <email>
  manage-staff role <email> staff|admin
  manage-staff suspend <email>
  manage-staff restore <email>

Requires KV_DB_URL and KV_ADMIN_EMAIL. invite/confirm/reset also need
KV_SERVICE_ROLE_KEY.`;

async function main() {
  const [command, argument, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }

  if (command === 'list') {
    const db = connect();
    await db.connect();
    try {
      await list(db);
    } finally {
      await db.end();
    }
    return;
  }

  if (!command || !argument) fail(USAGE);
  const email = requireEmail(argument);

  const db = connect();
  await db.connect();
  try {
    const actor = await requireAdminActor(db);

    switch (command) {
      case 'invite': {
        const roleFlag = rest.indexOf('--role');
        const role = roleFlag === -1 ? 'staff' : rest[roleFlag + 1];
        await invite(db, actor, email, role);
        break;
      }
      case 'confirm':
        await confirm(db, actor, email);
        break;
      case 'reset':
        await reset(db, actor, email);
        break;
      case 'role':
        await setRole(db, actor, email, rest[0]);
        break;
      case 'suspend':
        await suspend(db, actor, email);
        break;
      case 'restore':
        await restore(db, actor, email);
        break;
      default:
        fail(`unknown command "${command}"\n\n${USAGE}`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`${colour.red}error${colour.reset} ${error?.message ?? error}`);
  if (error?.code) console.error(`${colour.dim}postgres code: ${error.code}${colour.reset}`);
  process.exit(1);
});
