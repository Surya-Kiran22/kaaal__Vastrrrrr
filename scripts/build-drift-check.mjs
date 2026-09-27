// Generates supabase/tests/pre-migration-drift-check.sql
// The migration bundle re-runs a product/business seed guarded by
// `on conflict do update`, so applying it to a live catalogue silently resets
// the columns listed in the seed. This emits a read-only query that reports
// exactly which rows would change, so the damage can be seen before running.
import { readFileSync, writeFileSync } from 'node:fs';

const sql = readFileSync('supabase/apply-all.sql', 'utf8');
const lines = sql.split(/\r?\n/);

function findStatement(startRe) {
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) throw new Error(`not found: ${startRe}`);
  let end = start;
  while (end < lines.length && !/;\s*$/.test(lines[end])) end++;
  return lines.slice(start, end + 1).join('\n');
}

const products = findStatement(/^\s*insert into public\.products\s*$/m);
const settings = findStatement(/^\s*insert into public\.business_settings\s*$/m);

// Split the multi-row VALUES list into one tuple per seed product.
const valuesStart = products.indexOf('values');
const rawBody = products.slice(valuesStart);
// Stop at ON CONFLICT, otherwise the `(sku)` conflict target and any
// parenthesised expression in the DO UPDATE list get mistaken for products.
const conflictAt = rawBody.search(/on\s+conflict/i);
const body = conflictAt === -1 ? rawBody : rawBody.slice(0, conflictAt);
const tuples = [];
let depth = 0;
let start = -1;
for (let i = 0; i < body.length; i++) {
  const ch = body[i];
  if (ch === "'") {
    i++;
    // skip a doubled '' escape as well
    while (i < body.length && body[i] !== "'") i++;
    continue;
  }
  if (ch === '(') {
    if (depth === 0) start = i;
    depth++;
  } else if (ch === ')') {
    depth--;
    if (depth === 0 && start >= 0) tuples.push(body.slice(start, i + 1));
  }
}

const seed = tuples.map((t) => {
  const cleaned = t.replace(/\s*--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/^\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/);
  return { name: m[1], slug: m[2], tuple: cleaned };
});

const settingsTuple = (() => {
  let t = settings
    .replace(/insert into public\.business_settings[\s\S]*?values/i, '')
    .replace(/\s*--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop the ON CONFLICT clause, or its columns land in the value tuple and
  // every field shifts.
  const at = t.search(/on\s+conflict/i);
  if (at !== -1) t = t.slice(0, at);
  return t.replace(/,\s*$/, '').trim().replace(/;$/, '').trim();
})();

// Declared up here because the templates below call the extractors, which
// reach this. Function declarations hoist, but `const` does not.
const cache = new Map();

const productCte = `with seed(sku, name, slug, category, brand, description, selling_price, compare_at_price,
          sizes, colors, variant_stock, image_url, images, is_featured, is_available) as (
  values ${seed.map((s) => `(
    ${extractSku(s.tuple)},
    ${quoteText(fieldsOf(s.tuple)[0])},
    ${quoteText(fieldsOf(s.tuple)[1])},
    ${quoteText(fieldsOf(s.tuple)[2])},
    ${quoteText(fieldsOf(s.tuple)[3])},
    ${quoteText(fieldsOf(s.tuple)[5])},
    ${extractNum(s.tuple, 0)},
    ${extractNum(s.tuple, 1)},
    ${extractArray(s.tuple, 0)},
    ${extractArray(s.tuple, 1)},
    ${extractJsonb(s.tuple)},
    ${quoteText(fieldsOf(s.tuple)[11])},
    ${fieldsOf(s.tuple)[12]},
    ${extractBool(s.tuple, 0)},
    ${extractBool(s.tuple, 1)})`).join(',\n    ')}
)`;

// A CTE fragment, not a whole WITH statement: the verdict query chains it onto
// the product CTE, and a bare `values (...)` has no column names, so s.id
// would not resolve.
const settingsCte = `settings_seed(id, business_name, tagline, whatsapp_number, upi_id, city) as (
  values (${extractSettings(settingsTuple)})
)`;

// Every column the seed writes. Anything omitted here is a column the seed
// would overwrite while this check called it safe.
const productDiff = `p.name is distinct from s.name
   or p.slug is distinct from s.slug
   or p.category is distinct from s.category
   or p.brand is distinct from s.brand
   or p.description is distinct from s.description
   or p.selling_price is distinct from s.selling_price
   or p.compare_at_price is distinct from s.compare_at_price
   or p.sizes::text is distinct from s.sizes::text
   or p.colors::text is distinct from s.colors::text
   or p.variant_stock is distinct from s.variant_stock
   or p.image_url is distinct from s.image_url
   or p.images::text is distinct from s.images::text
   or p.is_featured is distinct from s.is_featured
   or p.is_available is distinct from s.is_available`;

const settingsDiff = `bs.business_name is distinct from s.business_name
   or bs.tagline is distinct from s.tagline
   or bs.whatsapp_number is distinct from s.whatsapp_number
   or bs.upi_id is distinct from s.upi_id
   or bs.city is distinct from s.city`;

// One query, exactly one row. The Supabase SQL Editor only reliably renders
// the last statement of a script, so a two-query file makes "no rows
// returned" ambiguous -- and that ambiguity sits in front of a production
// migration. A single verdict row removes it.
const verdict = `-- Read-only. Run this BEFORE pasting supabase/apply-all.sql.
--
-- Returns exactly ONE row. Read safe_to_apply:
--   true  -> applying the bundle will not overwrite anything of yours
--   false -> stop, and run pre-migration-drift-detail.sql to see what changes
--
-- Why this exists: the bundle re-runs a catalogue seed guarded by
-- "on conflict (sku) do update" and a settings seed guarded by
-- "on conflict (id) do update". Against a live store that resets the seeded
-- columns to the values hard-coded in the bundle.
--
-- Rows are matched on sku, so products you added yourself are never touched.
-- Columns the seed does not list (notably products.stock) are left alone.

${productCte},
${settingsCte},
product_drift as (
  select p.sku
  from public.products p
  join seed s on s.sku = p.sku
  where ${productDiff}
),
settings_drift as (
  select bs.id
  from public.business_settings bs
  join settings_seed s on s.id = bs.id
  where ${settingsDiff}
)
select
  (select count(*) from product_drift)::int  as products_that_would_change,
  (select count(*) from settings_drift)::int as settings_that_would_change,
  (select count(*) from product_drift) = 0
    and (select count(*) from settings_drift) = 0 as safe_to_apply;
`;

const detail = `-- Read-only. Run only if pre-migration-drift-check.sql said
-- safe_to_apply = false. One row per product that the bundle would reset.
--
-- Generated by scripts/build-drift-check.mjs -- do not hand-edit.
--
-- Every column the seed writes is listed, including description and the image
-- fields. Leaving one out would mean an owner edit the seed silently
-- overwrites, but which this check reports as safe.
--
-- products.stock is shown for reference only; the seed never writes it.

${productCte}
select
  p.sku,
  p.name as live_name,
  s.name as seed_name,
  p.selling_price as live_price,
  s.selling_price as seed_price,
  p.stock as live_stock,
  (p.name is distinct from s.name)             as name_changes,
  (p.slug is distinct from s.slug)             as slug_changes,
  (p.category is distinct from s.category)     as category_changes,
  (p.brand is distinct from s.brand)           as brand_changes,
  (p.description is distinct from s.description)         as description_changes,
  (p.selling_price is distinct from s.selling_price)         as price_changes,
  (p.compare_at_price is distinct from s.compare_at_price)   as compare_changes,
  (p.sizes::text is distinct from s.sizes::text)             as sizes_change,
  (p.colors::text is distinct from s.colors::text)           as colors_change,
  (p.variant_stock is distinct from s.variant_stock)         as variant_stock_changes,
  (p.image_url is distinct from s.image_url)                 as image_url_changes,
  (p.images::text is distinct from s.images::text)           as images_change,
  (p.is_featured is distinct from s.is_featured)             as featured_changes,
  (p.is_available is distinct from s.is_available)           as available_changes
from public.products p
join seed s on s.sku = p.sku
where ${productDiff}
order by p.sku;
`;

writeFileSync('supabase/tests/pre-migration-drift-check.sql', verdict, 'utf8');
writeFileSync('supabase/tests/pre-migration-drift-detail.sql', detail, 'utf8');
console.log(`products parsed: ${seed.length}`);
console.log('wrote pre-migration-drift-check.sql - single verdict row');
console.log('wrote pre-migration-drift-detail.sql - run only if safe_to_apply is false');

// --- tiny extractors over a cleaned seed tuple ---------------------------

function fields(tuple) {
  // Strip the tuple's own outer parentheses first. Otherwise every inner comma
  // sits at paren depth >= 1 and the whole tuple comes back as a single field.
  let t = tuple.trim();
  if (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1);
  // split top-level commas, respecting quotes and parens
  const out = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "'") {
      cur += ch;
      i++;
      while (i < t.length && t[i] !== "'") cur += t[i++];
      cur += "'";
      continue;
    }
    // Brackets count as well as parens: array['S','M','L']::text[] is one
    // field, not four.
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function fieldsOf(tuple) {
  if (!cache.has(tuple)) cache.set(tuple, fields(tuple));
  return cache.get(tuple);
}

function extractSku(tuple) {
  return fieldsOf(tuple)[4]; // name, slug, category, brand, sku
}
function quoteText(field) {
  // Seed fields already carry their own single quotes, so emit them verbatim.
  // Wrapping again would produce ''biz-001'' and not parse.
  return field;
}
function extractNum(tuple, i) {
  return fieldsOf(tuple)[6 + i]; // ..., selling_price, compare_at_price
}
function extractArray(tuple, i) {
  return fieldsOf(tuple)[8 + i]; // sizes, colors
}
function extractJsonb(tuple) {
  return fieldsOf(tuple)[10];
}
function extractBool(tuple, i) {
  // name, slug, category, brand, sku, description, selling_price,
  // compare_at_price, sizes, colors, variant_stock, image_url, images,
  // is_featured, is_available
  return fieldsOf(tuple)[13 + i];
}
function extractSettings(tuple) {
  const f = fieldsOf(tuple);
  // id, business_name, tagline, whatsapp_number, upi_id, city.
  // These fields already carry their own quotes, so join them as-is rather
  // than wrapping each in another pair of quotes.
  return [f[0], f[1], f[2], f[4], f[13], f[8]].join(', ');
}

