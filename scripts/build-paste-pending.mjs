#!/usr/bin/env node
/**
 * Builds a paste-ready SQL file from a *chosen* set of migrations.
 *
 * `build-apply-all.mjs` concatenates every migration, which is correct for a
 * fresh database but wrong for an existing one: re-running migrations whose
 * objects already exist produces a wall of errors and obscures the real failure.
 * This script is for the common case of "apply only what is still missing" to a
 * database that is already live.
 *
 *   npm run db:paste                       # the default pending list below
 *   npm run db:paste -- 02100 02200        # by numeric prefix
 *   npm run db:paste -- all                # every migration, same as db:bundle
 *
 * Migrations are joined in filename order and wrapped in one transaction, which
 * is what the Supabase SQL editor does anyway, so either the whole batch lands
 * or none of it does.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const outputPath = join(root, 'supabase', 'paste-pending.sql');

/**
 * Migrations added after the database went live, in order. Update this when new
 * migrations ship; it is the whole point of the script.
 */
const DEFAULT_PENDING = ['20260101002100', '20260101002200'];

const all = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql'))
  .sort();

const args = process.argv.slice(2);

let selected;
if (args[0] === 'all') {
  selected = all;
} else {
  const wanted = args.length > 0 ? args : DEFAULT_PENDING;
  selected = [];
  for (const prefix of wanted) {
    const matches = all.filter((name) => name.startsWith(prefix));
    if (matches.length === 0) {
      console.error(`No migration matches "${prefix}".`);
      console.error('Available:');
      console.error(all.map((name) => `  ${name}`).join('\n'));
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`"${prefix}" matches ${matches.length} migrations; use a longer prefix.`);
      process.exit(1);
    }
    selected.push(matches[0]);
  }
}

selected = [...new Set(selected)].sort();

if (selected.length === 0) {
  console.error('Nothing selected.');
  process.exit(1);
}

const parts = [];
for (const name of selected) {
  const raw = await readFile(join(migrationsDir, name), 'utf8');
  // A BOM would land mid-bundle and Postgres rejects it as a syntax error.
  const contents = raw.replace(/^\uFEFF/, '').replace(/\s+$/, '');
  parts.push(
    `-- ###########################################################################\n` +
      `-- FILE: supabase/migrations/${name}\n` +
      `-- ###########################################################################\n` +
      contents +
      '\n',
  );
}

const header = `-- ===========================================================================
-- Kaal Vastr - pending installer
--
-- GENERATED FILE - do not edit by hand. Run \`npm run db:paste\` instead.
--
-- ${selected.length} migration${selected.length === 1 ? '' : 's'}, in order:
${selected.map((name) => `--   ${basename(name)}`).join('\n')}
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   paste this whole file -> Run
--
-- The editor runs the script in one transaction, so either all of the above land
-- or none of them do. On error nothing is left half-applied, so read the error
-- rather than re-running pieces.
-- ===========================================================================

`;

const footer = `-- ###########################################################################
-- END: ${selected.length} migration(s) applied.
--
-- Expected after this script:
--   - 02100: the four RLS helpers live in the "private" schema, and
--     /rest/v1/rpc/is_admin no longer resolves.
--   - 02200: public.shareable_invoice(token) exists, and orders hold the
--     share token used by /invoice/$token.
--
-- Sanity check (signed out is fine):
--   select status, count(*) from public.orders group by status;
--   select proname from pg_proc where proname = 'shareable_invoice';
-- ###########################################################################
`;

const output = header + parts.join('\n') + '\n' + footer;
await writeFile(outputPath, output, 'utf8');

console.log(
  `Wrote supabase/paste-pending.sql - ${selected.length} migration(s), ` +
    `${output.split('\n').length} lines:\n` +
    selected.map((name) => `  ${basename(name)}`).join('\n'),
);
