# Kaal Vastr — Storefront + Admin

Production-ready storefront for **Kaal Vastr** with a secure Supabase-backed admin
for products, per-variant stock, product imagery and store-wide business settings.

Customers browse and build a cart, then send the order over WhatsApp. There is no
online payment and no order table — the store confirms delivery and payment in
chat, which keeps the deployment small and the data model honest.

---

## Stack

| Concern    | Choice                                             |
| ---------- | -------------------------------------------------- |
| Build      | Vite 6 + React 18 + TypeScript (strict)             |
| Routing    | TanStack Router (code-based, fully typed)           |
| Server state| TanStack Query                                     |
| Data       | Supabase (Postgres + Auth + Storage)                |
| Styling    | Tailwind CSS 3 with a charcoal/white-silver palette |
| Forms      | React Hook Form + Zod                               |
| Motion     | Framer Motion                                       |
| UI         | Radix primitives in a shadcn-style folder           |
| Toasts     | Sonner                                              |

---

## Getting started

```bash
npm install
cp .env.example .env      # then fill in your project keys
npm run dev
```

| Script            | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Dev server on http://localhost:5173      |
| `npm run build`   | Typecheck + production build to `dist/`  |
| `npm run preview` | Serve the production build locally       |
| `npm run lint`    | ESLint (must be clean)                   |
| `npm run typecheck`| `tsc -b` with no emit                    |

---

## Supabase setup

### 1. Create the project and apply the schema

Migrations live in `supabase/migrations` and are ordered. Either push them with
the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

or paste them into the Supabase SQL editor in filename order:

| Migration | Contents |
| --- | --- |
| `20260101000100_core_schema.sql` | `profiles`, `products`, `business_settings`, stock triggers |
| `20260101000200_rls_policies.sql` | RLS helpers and every row level security policy |
| `20260101000300_storage.sql` | the public `product-images` bucket |
| `20260101000350_fix_variant_stock_validation.sql` | correct `Colour\|Size` key validation |
| `20260101000400_seed_demo_data.sql` | 12 demo products + demo business settings |
| `20260101000600_customer_accounts.sql` | `addresses`, `orders`, `order_items`, account RLS |
| `20260101000700_order_owner_defaults.sql` | owner and reference assignment from the JWT |
| `20260101000800_fix_order_reference_generator.sql` | reference generator without `pgcrypto` |
| `20260101000900_lock_function_privileges.sql` | default-deny function grants |
| `20260101001000_staff_account_lifecycle.sql` | staff status, `staff_account_events`, `promote_to_admin`, `set_account_role` |
| `20260101001100_dispatch_status.sql` | `set_order_status`, `request_order_cancellation` |
| `20260101001200_realtime_publication.sql` | realtime for the order tables |
| `20260101001300_profile_column_limits.sql` | self-service column allowlist, monotonic dispatch |
| `20260101001400_revoke_truncate_and_regrant.sql` | revoke `TRUNCATE`/`TRIGGER`/`REFERENCES` |
| `20260101001500_restore_dispatch_lockout.sql` | final dispatch and privilege lockdown |
| `20260101001600_atomic_order_placement.sql` | atomic `place_order`, pickup support |
| `20260101001700_single_order_writer.sql` | `place_order` becomes the only order writer |

**Shortcut:** `supabase/apply-all.sql` is all seventeen files concatenated into one
idempotent script. Regenerate it after adding a migration — it is generated, and
an installer that has fallen behind the migrations is worse than none:

```bash
npm run db:bundle
```

Paste the result into a single SQL Editor query and run it. Use it when the CLI
is unavailable — for example when your account cannot access the Management API
(`supabase link` fails with *"Your account does not have the necessary privileges
to access this endpoint"*, typically a non-owner membership). The script is safe
to re-run: statements are `if not exists` / `drop … if exists` and the demo
catalogue upserts on SKU.

> `pgcrypto` is not installed on the target project, so nothing may use
> `gen_random_bytes()`. Use `gen_random_uuid()`.

If you have the database password but not CLI access, push straight to Postgres
without linking — the **session pooler** URI from Project Settings → Database is
required, because the direct `db.<ref>.supabase.co` host is IPv6-only:

```bash
supabase db push --db-url "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres"
```

For local work with the CLI: `supabase start`, then `supabase db reset`.

### 2. Environment variables

Browser — these two are all the app needs:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...   # or the legacy anon JWT
```

`VITE_SUPABASE_KEY` is accepted as an alias for the key. Only the publishable key
belongs in the browser — never a `service_role` / `sb_secret_` key, which the
app actively refuses to start with.

If the variables are missing, the app still renders and explains what is wrong
instead of throwing a blank screen.

Server-side — needed by the `verify:*` scripts, `admin:bootstrap` and
`staff:manage`, because they read and write rows that RLS hides from ordinary
sessions. See `.env.example`:

```env
KV_DB_URL=postgresql://postgres.<ref>:<db-password>@<ref>.<region>.pooler.supabase.com:6543/postgres
KV_ADMIN_EMAIL=owner@example.com     # an EXISTING active admin
KV_ADMIN_PASS=...                    # only verify:admin needs this
```

`KV_SERVICE_ROLE_KEY` is optional and only for `staff:manage invite|confirm|reset`
when the Edge Function is not deployed. Prefer the function and leave it unset.

### 3. Create the first admin

There is no pure-SQL path, by design: every promotion function refuses to run
unless the caller is already an active admin, and an empty project has nobody.
Use the script, which goes through the real signup trigger so the profile is
created exactly as a customer's would be:

```bash
npm run admin:bootstrap -- owner@example.com
```

It prints a generated password — save it, then change it through the app. The
script refuses to run if an active admin already exists unless you pass
`--force`. Confirm it with a real sign-in rather than trusting the database:

```bash
npm run verify:admin
```

Then sign in at `/admin/login`.

Afterwards, add staff from **Settings → Staff & admin accounts** in the admin UI,
or from the CLI:

```bash
npm run staff:manage -- invite teammate@example.com --role staff
npm run staff:manage -- confirm teammate@example.com   # if no email is configured
npm run staff:manage -- reset teammate@example.com
npm run staff:manage -- suspend teammate@example.com   # offboarding
```

**Do not** set `is_active = false` by hand to revoke access. It writes no audit
row, leaves `status` as `active` (so the UI reports the account as active while
the console guard refuses it), and on a customer row the `profiles_role_guard`
trigger silently forces `is_active` back to true. `supabase/bootstrap.sql`
explains this in full.

### 4. Replace the demo content

`20260101000400_seed_demo_data.sql` is a **demo** seed: placeholder contact
details and Unsplash imagery. Before going live, review it in the admin UI
(*Settings* and *Products*) and swap in the real values, especially:

- `business_settings.whatsapp_number` — international digits only (`919876543210`)
- address, city, timings, email, GST number, social links
- product photos (upload into the `product-images` bucket)

---

## Access model

| Table                   | Public read         | Writes                                                   |
| ----------------------- | ------------------- | -------------------------------------------------------- |
| `products`              | active, non-archived | admin only                                               |
| `business_settings`     | the single row      | admin only                                               |
| `profiles`              | nobody              | own row (`full_name`, `phone` only) + admin               |
| `addresses`             | nobody              | own rows only; delete restricted to the default           |
| `orders` / `order_items`| nobody              | own rows only, via the server-priced insert path          |
| `staff_account_events`  | nobody              | `SECURITY DEFINER` functions and the service role only     |
| `product-images`        | public bucket       | admin only                                               |

Enforcement lives in Postgres, not the UI:

- `is_admin()` / `is_staff_or_admin()` are `SECURITY DEFINER` helpers reading
  `auth.uid()`, so a client can never assert its own role. Both stay executable
  by `anon` **on purpose**: RLS policies call them, and Postgres needs execute
  privilege on a function used inside a policy.
- Customers have no insert/update/delete policy on `products` or
  `business_settings` at all — not "hidden in the UI", absent at the database.
- `anon` and `authenticated` hold no `TRUNCATE`, `TRIGGER` or `REFERENCES` grant.
- The self-service `profiles` update policy compares against
  `my_profile_role()` / `my_profile_is_active()` helpers, because a sub-select
  on `profiles` inside a `profiles` policy re-enters RLS and Postgres aborts
  with *infinite recursion detected in policy*.
- `handle_new_user()` always creates a `customer`; role is only ever changed by
  an admin, through `set_account_role` / `promote_to_admin` or the staff Edge
  Function — never by the account holder.
- Dispatch status moves only through `set_order_status`, which rejects
  `customer` and `admin` callers, refuses to move backwards, and treats
  `cancelled` and `delivered` as terminal. A direct `UPDATE` cannot reproduce
  that, and the column is not writable by any client.
- Order totals are recalculated from `order_items` by trigger, so the money
  columns are not client-writable even though the row itself is.

---

## Catalogue and stock model

- `variant_stock` is a JSON map keyed `"Colour|Size"` → whole units, e.g.
  `{"Obsidian Black|S":4, "Obsidian Black|M":2}`.
- A `before insert/update` trigger sums the map into `stock`, so list badges and
  the admin table can never drift from the grid.
- A combination missing from the map reads as **0 units** (sold out) — adding a
  new size or colour to a product deliberately does not invent inventory.
- Setting stock to `0` forces `is_available = false` (an empty product is not
  sellable). Re-stocking does **not** silently re-enable it: flip the
  *Available* switch in the admin form, which is explicit and auditable.
- `compare_at_price` is rejected by trigger unless it is greater than
  `selling_price`, and `slug` / `sku` are unique.

---

## How ordering works

Ordering requires a **verified, active customer account**. There is no anonymous
cart: `CartProvider` refuses to add items unless `canShop` is true, drops a stale
`localStorage` cart when the shopper is no longer eligible, and hides the cart
entirely from staff and admins. Every *Order on WhatsApp* button runs through
`useOrderGate`, which sends anonymous visitors to `/account/login` (carrying a
return path), unverified customers to `/account/verify`, and refuses staff and
admins outright. General "chat with us" links are deliberately left ungated.

1. A verified customer adds size + colour specific lines to a cart persisted in
   `localStorage` (hydrated before the first write, so a returning customer never
   loses their cart).
2. Checkout picks a saved address or types a new one, and shows a preview of the
   message that will be sent.
3. On submit the whole order goes in **one call**: `place_order` (migration
   `20260101001600`) writes the header and every line in a single transaction, so
   a partial order is not representable. The request carries only product id,
   colour, size and quantity — every price, name and image is re-read from
   `products` inside the function, so a modified client cannot name its own
   price. `20260101001700` then revokes `insert`/`update`/`delete` on `orders`
   and `order_items` from `authenticated`, making `place_order` the only writer.
4. The delivery address is copied into an immutable `delivery` JSONB snapshot on
   the order, so editing or deleting the address later never rewrites history.
5. Only then does `src/lib/whatsapp.ts` build the message and open
   `https://wa.me/<number>?text=...` using the number from `business_settings`.
   The message is built from the lines the database stored and the totals the
   database computed, never from the cart, so a price that moved while the
   customer was typing cannot make the message disagree with the order.
6. If the number is unconfigured or malformed, the dialog falls back to a copy
   button rather than opening a broken link.

**Before migration 016 is applied**, `place_order` does not exist and the two-call
path it replaced is *not* restored. That path was unsafe: the client posted
`unit_price` and `order_items_recalc_order` totalled it, so a customer could post
`unit_price: 1` and the trigger would believe them. Instead checkout falls back to
WhatsApp only:

- `loadAuthoritativeLines` (`src/hooks/useAccount.ts`) re-reads every line from
  `products` — readable by `anon` and `authenticated` — applies the same
  archived/unavailable and `variant_stock` rules as `place_order`, and returns
  lines plus totals derived by `computeMessageTotals`.
- **Nothing is written.** No order row, no line rows, so there is no partial
  order and no client-named price anywhere.
- There is no reference and nothing under My Orders, so the confirmation says so
  and tells the customer that sending the WhatsApp message is what places the
  order.

The trade is deliberate: a pre-migration store takes orders on the channel it
already uses instead of either failing the sale or accepting a price the browser
chose.

The reference and the item list are shown in the dialog, so a customer who loses
the WhatsApp tab can still tell the store which order they mean.

No payment data is ever collected or transmitted by this site.

## Accounts and roles

| Route | Who | What it is |
| --- | --- | --- |
| `/account/register` | anyone | email + password, then a 6-digit OTP |
| `/account/verify` | pending customer | code entry and resend |
| `/account` | verified customer | profile, addresses, order history |
| `/staff` | staff **and** admin | dispatch log |
| `/admin` | admin | catalogue, staff accounts, settings |

`canShop` is `role === 'customer' && status === 'active' && email_verified_at`
is set. `canUseConsole` additionally requires `staff` or `admin` and an active
status, which is why a suspended staff member is bounced to `/staff/login`
rather than shown a half-working console.

Admins can *see* the dispatch log but the controls are hidden for them, because
`set_order_status` rejects the role regardless of what the UI offers.

## Staff account management

Creating an auth user needs the service-role key, so it cannot happen in the
browser. Two paths, both writing `staff_account_events`:

- **Edge Function** (`supabase/functions/manage-staff`) — the intended route.
  Re-verifies the caller's JWT, confirms they are an active admin, then invites,
  resends, resets or confirms. Redirect URLs are allow-listed so a reset link
  cannot be pointed at an attacker's host.

  ```bash
  supabase secrets set SERVICE_ROLE_KEY=... ALLOWED_REDIRECT_ORIGINS=https://your-domain
  supabase functions deploy manage-staff
  ```

  `ALLOWED_REDIRECT_ORIGINS` is required, not optional. The storefront is served
  from your own domain, so every call to this function is cross-origin, and the
  function answers the CORS preflight and echoes the matching `Origin`. The same
  allowlist is what an emailed setup link may point at, so the function refuses
  to send anything at all when it is unset rather than mailing a link to a page
  that does not exist. It never sends `*`.

- **CLI** (`npm run staff:manage -- <command>`) — for when the Management API is
  unreachable. It refuses to run unless `KV_ADMIN_EMAIL` is an active admin, and
  it will not suspend or demote the last active admin.

Both paths are idempotent, clean up a half-created auth user if the profile
trigger did not fire, and record what happened without ever writing a password,
token or code to the audit trail.

## Live updates

Screens that show changing data (`src/hooks/useRealtime.ts`) run a Postgres
change subscription *and* a 30-second poll at the same time. The poll is
deliberate: realtime degrades to a dead socket on flaky mobile data and some
proxies block websockets outright, so trusting the subscription alone means
showing stale dispatch statuses with no way to recover. Polling stops while the
socket is healthy.

## Verification

These run against a real project, using real sign-ins and real HTTP calls to
PostgREST and the RPCs — not mocks. They clean up after themselves and leave
zero rows behind.

```bash
npm run verify:auth    # customer signup, OTP, RLS, order pricing, address isolation
npm run verify:staff   # staff lifecycle, dispatch transitions, admin refusal
npm run verify:admin   # first-admin bootstrap, admin boundaries
npm run verify:invite  # staff invite boundary: who may promote an account
```

They need `KV_DB_URL`, and `verify:admin` also needs `KV_ADMIN_EMAIL` and
`KV_ADMIN_PASS`.

### Order placement

`place_order` has its own SQL acceptance test, because it is the one function
that writes money figures and has to refuse bad input:

```bash
psql "$KV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/place_order.sql
```

It covers a delivery order, a pickup order with no address, database-side
pricing, the stored lines coming back for the WhatsApp text, and seven refusals
(empty cart, incomplete address, unknown product, unstocked variant, somebody
else's `address_id`, a staff account, and a malformed id). It then runs as
`authenticated` and proves the direct-write hole of migration `017` is shut: a
customer cannot insert, update or delete `orders` or `order_items`, and every
refusal is checked against the message it was supposed to produce, so a case
that failed early for an unrelated reason aborts the file instead of reporting a
false pass. The last check compares row counts against a baseline, because a
refusal that left a row behind would mean the transaction did not roll back.

To run it against a plain PostgreSQL server rather than a project, apply the stub
first — `auth` and `storage` belong to the Supabase platform and are not in any
migration here, so without it the bundle cannot apply:

```bash
psql "$KV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stub-schemas.sql
psql "$KV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/apply-all.sql
psql "$KV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/place_order.sql
```

It writes three real orders and does not clean up, so point it at a scratch or
staging database, never production. It needs `psql` on the path; the `verify:*`
scripts above use Node instead.

---

## Project layout

```
src/
  components/        UI primitives, layout, product, cart, admin
  features/cart/     cart reducer + provider, drawer, checkout
  hooks/             catalogue queries, account/order data, auth, realtime
  lib/               env, supabase, products, whatsapp, format, auth controller
  routes/            one file per route (code-based TanStack Router)
    account/         register, verify, profile, addresses, order history
    staff/           console login, dispatch log
    admin/           overview, products, staff accounts, settings
  types/             shared domain types
scripts/             admin bootstrap, staff management, verification, bundler
supabase/
  migrations/        17 ordered migrations: schema, RLS, storage, seed, accounts,
                     dispatch, atomic order placement
  functions/         manage-staff (admin-only Edge Function)
  tests/             place_order.sql — acceptance checks for the checkout RPC
                     stub-schemas.sql — auth/storage stand-in to run off-platform
  apply-all.sql      GENERATED — `npm run db:bundle`
  bootstrap.sql      owner-run notes: first admin, offboarding, sanity checks
  config.toml        local CLI configuration
```

## Deployment

`vercel.json` is included: static `dist` output, SPA rewrite to
`/index.html` (required for client-side routing) and security headers. On any
other host, reproduce the rewrite rule so deep links like
`/product/obsidian-hoodie` resolve.

Supabase Auth → *URL Configuration* must list the production URL in both
**Site URL** and **Redirect URLs**, otherwise password sign-in and every
password-reset link are rejected.

Before going live:

- [ ] Replace the demo business details and imagery (see step 4 above)
- [ ] Configure custom SMTP — the default provider rate-limits to a handful of
      OTP emails an hour, which makes signup look broken
- [ ] Deploy the `manage-staff` function, or accept that staff must be added
      with `npm run staff:manage`. Until it is deployed the admin staff page
      answers `404 NOT_FOUND` from `/functions/v1/manage-staff`; the UI says so
      and points at the CLI rather than failing silently.
- [ ] Rotate the database password and any personal access token that has been
      in a transcript or shell history, and run `supabase logout`
- [ ] Run the `verify:*` scripts against the production project
- [ ] **Apply migration `20260101001700` as soon as possible.** Until it is
      applied, `authenticated` still holds the blanket `insert` grant on `orders`
      and `order_items` that migration `015` left in place, and a signed-in
      customer can post their own `unit_price` — a zero-priced order was
      demonstrated against this schema. Confirm it landed with:
      `select proname from pg_proc where proname = 'place_order';`
      Applying `016` and `017` together is the fix; there is no client-side
      workaround, because the client deliberately refuses to fall back.
- [ ] Apply migration `20260101001600` if the checkout RPC is not yet live, and
      note that `016` alone is not sufficient — it is `017` that closes the
      direct-write hole.

## Known limitations

- Stock is not decremented on checkout, and nothing is reserved. Two customers
  can order the last hoodie; confirm inventory in WhatsApp and update the admin
  grid. Automatic decrement would need a reservation table and an expiry.
  `place_order` does check the requested quantity against `variant_stock` and
  refuses a line it cannot fill, so an order can never be placed for a
  combination that is already at zero.
- Order placement is a single `place_order` call (migrations
  `20260101001600` and `20260101001700`), so the header and its lines either
  both land or neither does. It re-checks the caller's role, status and email
  verification, and re-reads every price from the catalogue.
  `016` creates it `security invoker`, so the existing RLS policies are what
  authorise the write; `017` revokes `insert`/`update`/`delete` on `orders` and
  `order_items` from `authenticated` *and* promotes the function to
  `security definer`, which re-checks those same conditions in the body. Both
  are needed: the revocation alone leaves the function unable to write, and
  `security invoker` alone would let any future blanket re-grant silently
  reopen the hole. A tampered request can therefore neither post its own total
  nor write a row at all. Acceptance and direct-write regression checks live in
  `supabase/tests/place_order.sql`; both layers (the missing grant and the
  missing policy) are verified independently.
- **The pre-migration fallback is WhatsApp, not a second write.** On a database
  that has not had 016 applied, `place_order` is missing and checkout re-prices
  the cart from `products` and opens WhatsApp without writing anything. Two
  consequences: the order is not in `orders`, so it will not appear under My
  Orders, have a `KV-` reference, or reach the staff dispatch console; and the
  store has to create the order by hand. That is the intended trade — the
  alternative is the old two-call path, where the browser supplied `unit_price`
  and `order_items_recalc_order` totalled it faithfully, which is how a customer
  could once post `unit_price: 1`. Applying 016 removes the fallback entirely.
- A delivery address is optional. A customer with nothing saved can still check
  out, and the staff console labels that order "Pickup at store". The name and
  phone are sent separately from the address for exactly that case. If an
  address *is* supplied it must be complete.
- Order status changes are driven by staff, not by the customer receiving the
  parcel. There is no payment or shipping integration.
- Currency is fixed to INR formatting in `src/lib/format.ts`.
- Only the storefront's own WhatsApp number is used; there is no per-product
  supplier routing.
- Order status changes arrive over Realtime into an `aria-live="polite"` list, so
  they are announced. They are not summarised: a customer who has scrolled past
  the changed row gets no separate notification.
