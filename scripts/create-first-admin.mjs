// Create the first admin account.
//
//   $env:KV_DB_URL = "postgresql://..."
//   npm run admin:bootstrap -- you@example.com
//   npm run admin:bootstrap -- you@example.com "your-own-password"
//
// Why this exists rather than a call to promote_to_admin():
//
//   promote_to_admin() deliberately refuses to bootstrap. A "no admin exists
//   yet" branch would let any signed-in customer promote themselves, because
//   there is nothing to distinguish the owner from a stranger at that moment.
//   So the very first admin is created out of band, with direct database
//   access, and every promotion after that goes through the guarded function.
//
// What it does, in order:
//
//   1. inserts the auth user unconfirmed, so handle_new_user creates a profile
//      with role = 'customer' exactly as a real signup would;
//   2. sets email_confirmed_at, which fires sync_profile_verification() and
//      proves the verification trigger works rather than faking the column;
//   3. promotes the profile to admin and writes an audit entry.
//
// The password is generated and printed once. Supabase stores only a bcrypt
// hash, so it cannot be recovered afterwards -- change it after signing in.
import crypto from 'node:crypto';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

const DB = process.env.KV_DB_URL;
if (!DB) {
  console.error('KV_DB_URL must be set, e.g.\n  $env:KV_DB_URL = "postgresql://postgres.<ref>:<password>@<pooler>:6543/postgres"');
  process.exit(1);
}

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('usage: npm run admin:bootstrap -- <email> [password]');
  process.exit(1);
}

// Readable enough to retype once, long enough to be worth guessing.
const password =
  process.argv[3] ??
  `KV-${crypto.randomBytes(9).toString('base64url')}-Aa1!`;

if (password.length < 8) {
  console.error('password must be at least 8 characters');
  process.exit(1);
}

const db = new Client({ connectionString: DB });
await db.connect();

try {
  const existing = await db.query(
    "select count(*)::int as n from public.profiles where role = 'admin' and status = 'active'",
  );
  if (existing.rows[0].n > 0 && !process.argv.includes('--force')) {
    console.error(
      `There is already ${existing.rows[0].n} active admin account(s).\n` +
        'To create another admin, sign in as an admin and use set_account_role().\n' +
        'Pass --force only if you are deliberately re-running this.',
    );
    process.exit(1);
  }

  const found = await db.query('select id from auth.users where lower(email) = $1', [email]);
  let userId = found.rows[0]?.id;
  const created = !userId;

  if (created) {
    userId = crypto.randomUUID();
    const meta = { full_name: 'Owner', phone: null };
    await db.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          confirmation_token, email_change, email_change_token_new, recovery_token,
          created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
          $2, $3, null, '{"provider":"email","providers":["email"]}', $4::jsonb,
          '', '', '', '', now(), now())`,
      [userId, email, bcrypt.hashSync(password, 10), JSON.stringify(meta)],
    );
    await db.query(
      `insert into auth.identities (id, user_id, identity_data, provider, provider_id,
          last_sign_in_at, created_at, updated_at)
       values ($1, $1, $2::jsonb, 'email', $3, now(), now(), now())`,
      [userId, JSON.stringify({ sub: userId, email, email_verified: false, phone_verified: false }), email],
    );
    console.log(`created auth user for ${email}`);
  } else {
    await db.query('update auth.users set encrypted_password = $2 where id = $1', [userId, bcrypt.hashSync(password, 10)]);
    console.log(`existing auth user found for ${email}; password reset`);
  }

  // The profile must exist already -- handle_new_user runs on insert.
  const profile = await db.query('select role, status from public.profiles where id = $1', [userId]);
  if (!profile.rows[0]) throw new Error('handle_new_user did not create a profile row');
  console.log(`handle_new_user created profile with role=${profile.rows[0].role} status=${profile.rows[0].status}`);

  // Confirming the email is what fires sync_profile_verification(), so the
  // verified state is produced by the same code path a real OTP uses.
  if (!created) {
    await db.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [userId]);
  } else {
    await db.query('update auth.users set email_confirmed_at = now() where id = $1', [userId]);
  }
  const verified = await db.query(
    'select status, email_verified_at is not null as verified from public.profiles where id = $1',
    [userId],
  );
  console.log(`after confirming the email: status=${verified.rows[0].status} verified=${verified.rows[0].verified}`);

  await db.query(
    `update public.profiles
        set role = 'admin', status = 'active', is_active = true,
            activated_at = coalesce(activated_at, now())
      where id = $1`,
    [userId],
  );
  await db.query(
    `insert into public.staff_account_events (profile_id, actor_id, kind, detail)
     values ($1, $1, 'role_changed', $2)`,
    [userId, 'bootstrapped as first admin (direct database access)'],
  );

  const final = await db.query('select email, role, status, is_active, email_verified_at is not null as verified from public.profiles where id = $1', [userId]);
  console.log('\nfinal profile:', JSON.stringify(final.rows[0]));

  const admins = await db.query("select count(*)::int as n from public.profiles where role = 'admin' and status = 'active'");
  console.log(`active admins: ${admins.rows[0].n}`);

  console.log('\n' + '='.repeat(64));
  console.log('  ADMIN CREDENTIALS  (shown once, cannot be recovered)');
  console.log('='.repeat(64));
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('='.repeat(64));
  console.log('\nSign in at /admin/login, then change the password immediately.');
  console.log('Supabase keeps only a bcrypt hash, so there is no reset-by-me path\nif this is lost -- use the "Reset Password" action on the staff screen\nonce that screen exists, or the Supabase dashboard.');
} finally {
  await db.end();
}
