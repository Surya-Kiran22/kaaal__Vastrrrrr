-- Read-only. Run this BEFORE pasting supabase/apply-all.sql.
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

with seed(sku, name, slug, category, brand, description, selling_price, compare_at_price,
          sizes, colors, variant_stock, image_url, images, is_featured, is_available) as (
  values (
    'KV-HD-001',
    'Shadow Oversized Hoodie',
    'shadow-oversized-hoodie',
    'Hoodies',
    'Kaal Vastr',
    'Heavyweight 450 GSM French-terry cotton hoodie in deep obsidian black. Dropped shoulders, double-stitched seams and tonal silver branding keep the silhouette clean and boxy.',
    4499,
    5999,
    array['S','M','L','XL','XXL']::text[],
    array['Obsidian Black','Charcoal Grey']::text[],
    '{"Obsidian Black|S":4,"Obsidian Black|M":6,"Obsidian Black|L":5,"Obsidian Black|XL":3,"Obsidian Black|XXL":2,"Charcoal Grey|S":3,"Charcoal Grey|M":0,"Charcoal Grey|L":2,"Charcoal Grey|XL":2,"Charcoal Grey|XXL":0}'::jsonb,
    'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=80' ]::text[],
    true,
    true),
    (
    'KV-TS-002',
    'Monolith Heavyweight Tee',
    'monolith-heavyweight-tee',
    'T-Shirts',
    'Kaal Vastr',
    '240 GSM combed cotton tee with a structured, non-transparent drape. Reinforced collar, boxy body and a small woven KV tab at the hem.',
    1299,
    1799,
    array['S','M','L','XL','XXL']::text[],
    array['Obsidian Black','Off White','Slate Grey']::text[],
    '{"Obsidian Black|S":12,"Obsidian Black|M":18,"Obsidian Black|L":15,"Obsidian Black|XL":9,"Obsidian Black|XXL":4,"Off White|S":8,"Off White|M":10,"Off White|L":6,"Off White|XL":3,"Off White|XXL":0,"Slate Grey|S":0,"Slate Grey|M":0,"Slate Grey|L":4,"Slate Grey|XL":2,"Slate Grey|XXL":0}'::jsonb,
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1583743814966-8936f37f4678?auto=format&fit=crop&w=1200&q=80' ]::text[],
    true,
    true),
    (
    'KV-JK-003',
    'Noir Bomber Jacket',
    'noir-bomber-jacket',
    'Jackets',
    'Kaal Vastr',
    'Matte-black bomber in water-resistant twill with a satin lining, ribbed cuffs and a silver-tone zip pull. Cut relaxed through the body.',
    7499,
    8999,
    array['S','M','L','XL']::text[],
    array['Obsidian Black','Gunmetal']::text[],
    '{"Obsidian Black|S":3,"Obsidian Black|M":5,"Obsidian Black|L":4,"Obsidian Black|XL":2,"Gunmetal|S":2,"Gunmetal|M":0,"Gunmetal|L":1,"Gunmetal|XL":0}'::jsonb,
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80' ]::text[],
    true,
    true),
    (
    'KV-TR-004',
    'Onyx Cargo Trousers',
    'onyx-cargo-trousers',
    'Trousers',
    'Kaal Vastr',
    'Utility cargo trousers in washed cotton-nylon ripstop. Six pockets, an adjustable hem drawcord and a straight tapered leg.',
    3299,
    null,
    array['28','30','32','34','36']::text[],
    array['Obsidian Black','Stone Grey']::text[],
    '{"Obsidian Black|28":5,"Obsidian Black|30":7,"Obsidian Black|32":9,"Obsidian Black|34":6,"Obsidian Black|36":2,"Stone Grey|28":2,"Stone Grey|30":3,"Stone Grey|32":4,"Stone Grey|34":0,"Stone Grey|36":0}'::jsonb,
    'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1517445312882-bc9910d016b7?auto=format&fit=crop&w=1200&q=80' ]::text[],
    false,
    true),
    (
    'KV-SH-005',
    'Carbon Overshirt',
    'carbon-overshirt',
    'Shirts',
    'Kaal Vastr',
    'Structured overshirt in brushed cotton flannel, cut to layer over a tee. Tonal buttons, chest pocket and a straight hem.',
    3899,
    4599,
    array['S','M','L','XL']::text[],
    array['Carbon Black','Graphite']::text[],
    '{"Carbon Black|S":4,"Carbon Black|M":6,"Carbon Black|L":5,"Carbon Black|XL":3,"Graphite|S":3,"Graphite|M":3,"Graphite|L":0,"Graphite|XL":0}'::jsonb,
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=1200&q=80' ]::text[],
    true,
    true),
    (
    'KV-HD-006',
    'Graphite Zip Hoodie',
    'graphite-zip-hoodie',
    'Hoodies',
    'Kaal Vastr',
    'Mid-weight 320 GSM loopback zip hoodie with a matte metal zip and a double-lined hood. Slim-merino-blend cuffs for shape retention.',
    3699,
    null,
    array['S','M','L','XL','XXL']::text[],
    array['Graphite Grey','Obsidian Black']::text[],
    '{"Graphite Grey|S":6,"Graphite Grey|M":8,"Graphite Grey|L":7,"Graphite Grey|XL":4,"Graphite Grey|XXL":2,"Obsidian Black|S":5,"Obsidian Black|M":5,"Obsidian Black|L":0,"Obsidian Black|XL":0,"Obsidian Black|XXL":0}'::jsonb,
    'https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1614495039153-42ea96c8f6a9?auto=format&fit=crop&w=1200&q=80' ]::text[],
    false,
    true),
    (
    'KV-JK-007',
    'Meridian Denim Jacket',
    'meridian-denim-jacket',
    'Jackets',
    'Kaal Vastr',
    'Rigid 12 oz indigo-black denim trucker with contrast silver stitching, a chest flap pocket and a slightly cropped hem.',
    8299,
    9999,
    array['S','M','L','XL']::text[],
    array['Midnight Indigo','Washed Black']::text[],
    '{"Midnight Indigo|S":2,"Midnight Indigo|M":4,"Midnight Indigo|L":3,"Midnight Indigo|XL":2,"Washed Black|S":1,"Washed Black|M":2,"Washed Black|L":0,"Washed Black|XL":0}'::jsonb,
    'https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=1200&q=80' ]::text[],
    true,
    true),
    (
    'KV-SW-008',
    'Ember Knit Sweater',
    'ember-knit-sweater',
    'Sweaters',
    'Kaal Vastr',
    'Merino-blend crewneck with a subtle charcoal marl. Warm, breathable and cut close to the body for easy layering.',
    4299,
    null,
    array['S','M','L','XL']::text[],
    array['Ember Charcoal','Ash Grey']::text[],
    '{"Ember Charcoal|S":4,"Ember Charcoal|M":6,"Ember Charcoal|L":5,"Ember Charcoal|XL":3,"Ash Grey|S":3,"Ash Grey|M":3,"Ash Grey|L":2,"Ash Grey|XL":0}'::jsonb,
    'https://images.unsplash.com/photo-1611312449412-6cefac5dc3e4?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1611312449412-6cefac5dc3e4?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1200&q=80' ]::text[],
    false,
    true),
    (
    'KV-TR-009',
    'Void Slim Jeans',
    'void-slim-jeans',
    'Trousers',
    'Kaal Vastr',
    'Jet-black slim jeans in comfort-stretch denim with a clean hem finish and a mid rise. Built to hold shape all day.',
    2999,
    3499,
    array['28','30','32','34','36','38']::text[],
    array['Void Black','Dark Indigo']::text[],
    '{"Void Black|28":6,"Void Black|30":9,"Void Black|32":11,"Void Black|34":7,"Void Black|36":4,"Void Black|38":0,"Dark Indigo|28":0,"Dark Indigo|30":4,"Dark Indigo|32":5,"Dark Indigo|34":3,"Dark Indigo|36":0,"Dark Indigo|38":0}'::jsonb,
    'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1475178626620-a4d074967452?auto=format&fit=crop&w=1200&q=80' ]::text[],
    false,
    true),
    (
    'KV-TS-010',
    'Obsidian Tee — Boxy',
    'obsidian-tee-boxy',
    'T-Shirts',
    'Kaal Vastr',
    'The everyday tee, cut wide and cropped just below the belt. 200 GSM ringspun cotton with a ribbed neckline.',
    1099,
    1499,
    array['S','M','L','XL']::text[],
    array['Obsidian Black','Bone White']::text[],
    '{"Obsidian Black|S":14,"Obsidian Black|M":20,"Obsidian Black|L":18,"Obsidian Black|XL":10,"Bone White|S":10,"Bone White|M":12,"Bone White|L":8,"Bone White|XL":5}'::jsonb,
    'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=1200&q=80' ]::text[],
    false,
    true),
    (
    'KV-JK-011',
    'Sable Puffer Vest',
    'sable-puffer-vest',
    'Jackets',
    'Kaal Vastr',
    'Insulated puffer vest with a matte shell, silicone-branded zip pull and an internal media pocket. Sits cleanly over knitwear.',
    5999,
    6999,
    array['S','M','L','XL']::text[],
    array['Sable Black','Ash']::text[],
    '{"Sable Black|S":3,"Sable Black|M":5,"Sable Black|L":4,"Sable Black|XL":1,"Ash|S":0,"Ash|M":2,"Ash|L":2,"Ash|XL":0}'::jsonb,
    'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=1200&q=80' ]::text[],
    false,
    true),
    (
    'KV-AC-012',
    'KV Signature Cap',
    'kv-signature-cap',
    'Accessories',
    'Kaal Vastr',
    'Six-panel structured cap in brushed cotton twill with a tonal embroidered KV monogram and a metal adjuster.',
    899,
    null,
    array['One Size']::text[],
    array['Obsidian Black','Stone Grey']::text[],
    '{"Obsidian Black|One Size":22,"Stone Grey|One Size":9}'::jsonb,
    'https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=1200&q=80',
    array[ 'https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=1200&q=80' ]::text[],
    false,
    true)
),
settings_seed(id, business_name, tagline, whatsapp_number, upi_id, city) as (
  values ('biz-001', 'Kaal Vastr', 'Dark by design.', '919876543210', 'kaalvastr@upi', 'Mumbai')
),
product_drift as (
  select p.sku
  from public.products p
  join seed s on s.sku = p.sku
  where p.name is distinct from s.name
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
   or p.is_available is distinct from s.is_available
),
settings_drift as (
  select bs.id
  from public.business_settings bs
  join settings_seed s on s.id = bs.id
  where bs.business_name is distinct from s.business_name
   or bs.tagline is distinct from s.tagline
   or bs.whatsapp_number is distinct from s.whatsapp_number
   or bs.upi_id is distinct from s.upi_id
   or bs.city is distinct from s.city
)
select
  (select count(*) from product_drift)::int  as products_that_would_change,
  (select count(*) from settings_drift)::int as settings_that_would_change,
  (select count(*) from product_drift) = 0
    and (select count(*) from settings_drift) = 0 as safe_to_apply;
