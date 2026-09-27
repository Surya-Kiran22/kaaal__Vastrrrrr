#!/usr/bin/env node
/**
 * Regenerates `supabase/apply-all.sql` from every file in
 * `supabase/migrations`, in filename order.
 *
 * Why this is a script rather than a hand-maintained file: the migrations are
 * the source of truth, and a concatenated installer that quietly falls behind
 * them is worse than no installer at all — it produces a database that looks
 * right and is missing half the security fixes.
 *
 *   npm run db:bundle
 *
 * The output is meant for the Supabase SQL editor when `supabase db push`
 * cannot reach the Management API. The editor runs a pasted script in one
 * transaction, so the whole schema lands or none of it does.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const outputPath = join(root, 'supabase', 'apply-all.sql');

const files = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql'))
  .sort();

// Lexicographic order is correct here because every migration uses the same
// zero-padded `YYYYMMDDHHMMSS_` prefix.
if (files.length === 0) {
  console.error('No migrations found in supabase/migrations');
  process.exit(1);
}

const header = `-- ===========================================================================
-- Kaal Vastr — combined installer
--
-- GENERATED FILE — do not edit by hand. Run \`npm run db:bundle\` instead.
--
-- Every migration in supabase/migrations concatenated in filename order
-- (${files.length} file${files.length === 1 ? '' : 's'}). Safe to run more than
-- once: statements are "if not exists" / "drop ... if exists" and the demo
-- catalogue upserts on the unique SKU.
--
-- Use this ONLY when \`supabase db push\` is unavailable (for example when your
-- account lacks Management API access to the project).
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   paste this whole file -> Run
--
-- The Supabase SQL editor runs the script in a single transaction, so either
-- the whole schema lands or nothing does.
--
-- After running it, still create the first admin:
--   npm run admin:bootstrap -- owner@example.com
-- ===========================================================================

`;

const parts = [];
for (const name of files) {
  const raw = await readFile(join(migrationsDir, name), 'utf8');
  // A UTF-8 BOM survives readFile and would land in the middle of the bundle,
  // where Postgres rejects it as a syntax error. Windows editors add one often
  // enough that stripping it here is cheaper than diagnosing it later.
  const contents = raw.replace(/^\uFEFF/, '').replace(/\s+$/, '');
  parts.push(
    `-- ###########################################################################\n` +
      `-- FILE: supabase/migrations/${name}\n` +
      `-- ###########################################################################\n` +
      contents +
      '\n',
  );
}

const footer = `-- ###########################################################################
-- END: ${files.length} migrations applied in order.
--
-- Sanity check — should return one row per line:
--   select status, count(*) from public.orders group by status;
--   select role, count(*) from public.profiles group by role;
--   select proname from pg_proc
--    where proname in ('set_order_status','request_order_cancellation',
--                      'set_account_role','can_use_staff_console');
-- ###########################################################################
`;

await writeFile(outputPath, header + parts.join('\n') + '\n' + footer, 'utf8');

const lineCount = (header + parts.join('\n') + footer).split('\n').length;
console.log(
  `Wrote supabase/apply-all.sql — ${files.length} migrations, ${lineCount} lines:\n` +
    files.map((name) => `  ${basename(name)}`).join('\n'),
);
