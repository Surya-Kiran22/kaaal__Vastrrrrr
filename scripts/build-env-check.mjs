/**
 * Build-time environment guard.
 *
 * Vite inlines `VITE_` variables into the bundle while it builds, so a host
 * that builds without them produces a deployment that *succeeds* and then
 * renders "Supabase is not configured" to every visitor. That is the worst
 * possible failure mode: green CI, broken shop.
 *
 * Failing the build instead turns a silent outage into an obvious error. The
 * guard runs before `tsc`/`vite` so nothing is compiled or deployed.
 *
 * A local `.env` counts as configured, so `npm run build` still works offline.
 * On a host there is no `.env` in the upload (see `.vercelignore`), so the
 * variables have to come from the host's own environment.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

/** Minimal .env reader: KEY=value, optional quotes, `#` comments. */
function readLocalEnv() {
  const file = join(process.cwd(), '.env');
  if (!existsSync(file)) return {};

  const found = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    found[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return found;
}

const local = readLocalEnv();
const missing = REQUIRED.filter((name) => !(process.env[name] || local[name]));

if (missing.length > 0) {
  console.error(
    [
      '',
      '  Build aborted: missing required environment variable(s):',
      ...missing.map((name) => `    - ${name}`),
      '',
      '  These are inlined into the browser bundle at build time, so a build',
      '  without them produces a site that cannot reach the database.',
      '',
      '  On Vercel:  Project -> Settings -> Environment Variables, add them for',
      '               BOTH Production and Preview, then redeploy. Setting them',
      '               after a build does not affect that build.',
      '',
      '  Locally:     copy .env.example to .env and fill in the values from',
      '               Supabase -> Project Settings -> API.',
      '',
      '  Use the *publishable* (sb_publishable_) key only. A service_role or',
      '  sb_secret_ key in a VITE_ variable would be shipped to every visitor.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('build-env-check: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are present.');
