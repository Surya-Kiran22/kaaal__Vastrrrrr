-- ===========================================================================
-- Kaal Vastr — 004 demo catalogue + business settings
--
-- Idempotent: re-running refreshes the store profile and upserts products by
-- SKU. Replace the business contact block with client-approved final values.
-- The `stock` column is intentionally omitted because the trigger derives it
-- from `variant_stock`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Store configuration. Customers never see these values hard-coded in the UI;
-- every component reads them from this row.
-- ---------------------------------------------------------------------------
insert into public.business_settings
  (id, business_name, tagline, description, whatsapp_number, mobile_number, email,
   address, city, state, pincode, store_timings, gst_number, upi_id,
   instagram_url, facebook_url, logo_url, hero_image_url)
values
  ('biz-001',
   'Kaal Vastr',
   'Dark by design.',
   'Kaal Vastr is a minimalist dark-grey and silver clothing label. We design heavyweight staples, sharp silhouettes and monochrome essentials for people who prefer less, but better.',
   '919876543210',
   '+91 98765 43210',
   'contact@kaalvastr.in',
   '104, Obsidian Avenue, Khar West',
   'Mumbai',
   'Maharashtra',
   '400052',
   'Mon - Sat: 11:00 AM - 9:00 PM | Sun: 12:00 PM - 7:00 PM',
   '27ABCDE1234F1Z5',
   'kaalvastr@upi',
   'https://instagram.com/kaalvastr',
   'https://facebook.com/kaalvastr',
   '',
   'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1920&q=80')
on conflict (id) do update set
  business_name   = excluded.business_name,
  tagline         = excluded.tagline,
  description     = excluded.description,
  whatsapp_number = excluded.whatsapp_number,
  mobile_number   = excluded.mobile_number,
  email           = excluded.email,
  address         = excluded.address,
  city            = excluded.city,
  state           = excluded.state,
  pincode         = excluded.pincode,
  store_timings   = excluded.store_timings,
  gst_number      = excluded.gst_number,
  upi_id          = excluded.upi_id,
  instagram_url   = excluded.instagram_url,
  facebook_url    = excluded.facebook_url,
  hero_image_url  = excluded.hero_image_url,
  updated_at      = now();

-- ---------------------------------------------------------------------------
-- Demo catalogue.
-- ---------------------------------------------------------------------------
insert into public.products
  (name, slug, category, brand, sku, description, selling_price, compare_at_price,
   sizes, colors, variant_stock, image_url, images, is_featured, is_available)
values
  -- 1 ---------------------------------------------------------------------
  ('Shadow Oversized Hoodie', 'shadow-oversized-hoodie', 'Hoodies', 'Kaal Vastr', 'KV-HD-001',
   'Heavyweight 450 GSM French-terry cotton hoodie in deep obsidian black. Dropped shoulders, double-stitched seams and tonal silver branding keep the silhouette clean and boxy.',
   4499, 5999,
   array['S','M','L','XL','XXL']::text[],
   array['Obsidian Black','Charcoal Grey']::text[],
   '{"Obsidian Black|S":4,"Obsidian Black|M":6,"Obsidian Black|L":5,"Obsidian Black|XL":3,"Obsidian Black|XXL":2,"Charcoal Grey|S":3,"Charcoal Grey|M":0,"Charcoal Grey|L":2,"Charcoal Grey|XL":2,"Charcoal Grey|XXL":0}'::jsonb,
   'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 2 ---------------------------------------------------------------------
  ('Monolith Heavyweight Tee', 'monolith-heavyweight-tee', 'T-Shirts', 'Kaal Vastr', 'KV-TS-002',
   '240 GSM combed cotton tee with a structured, non-transparent drape. Reinforced collar, boxy body and a small woven KV tab at the hem.',
   1299, 1799,
   array['S','M','L','XL','XXL']::text[],
   array['Obsidian Black','Off White','Slate Grey']::text[],
   '{"Obsidian Black|S":12,"Obsidian Black|M":18,"Obsidian Black|L":15,"Obsidian Black|XL":9,"Obsidian Black|XXL":4,"Off White|S":8,"Off White|M":10,"Off White|L":6,"Off White|XL":3,"Off White|XXL":0,"Slate Grey|S":0,"Slate Grey|M":0,"Slate Grey|L":4,"Slate Grey|XL":2,"Slate Grey|XXL":0}'::jsonb,
   'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1583743814966-8936f37f4678?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 3 ---------------------------------------------------------------------
  ('Noir Bomber Jacket', 'noir-bomber-jacket', 'Jackets', 'Kaal Vastr', 'KV-JK-003',
   'Matte-black bomber in water-resistant twill with a satin lining, ribbed cuffs and a silver-tone zip pull. Cut relaxed through the body.',
   7499, 8999,
   array['S','M','L','XL']::text[],
   array['Obsidian Black','Gunmetal']::text[],
   '{"Obsidian Black|S":3,"Obsidian Black|M":5,"Obsidian Black|L":4,"Obsidian Black|XL":2,"Gunmetal|S":2,"Gunmetal|M":0,"Gunmetal|L":1,"Gunmetal|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 4 ---------------------------------------------------------------------
  ('Onyx Cargo Trousers', 'onyx-cargo-trousers', 'Trousers', 'Kaal Vastr', 'KV-TR-004',
   'Utility cargo trousers in washed cotton-nylon ripstop. Six pockets, an adjustable hem drawcord and a straight tapered leg.',
   3299, null,
   array['28','30','32','34','36']::text[],
   array['Obsidian Black','Stone Grey']::text[],
   '{"Obsidian Black|28":5,"Obsidian Black|30":7,"Obsidian Black|32":9,"Obsidian Black|34":6,"Obsidian Black|36":2,"Stone Grey|28":2,"Stone Grey|30":3,"Stone Grey|32":4,"Stone Grey|34":0,"Stone Grey|36":0}'::jsonb,
   'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1517445312882-bc9910d016b7?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 5 ---------------------------------------------------------------------
  ('Carbon Overshirt', 'carbon-overshirt', 'Shirts', 'Kaal Vastr', 'KV-SH-005',
   'Structured overshirt in brushed cotton flannel, cut to layer over a tee. Tonal buttons, chest pocket and a straight hem.',
   3899, 4599,
   array['S','M','L','XL']::text[],
   array['Carbon Black','Graphite']::text[],
   '{"Carbon Black|S":4,"Carbon Black|M":6,"Carbon Black|L":5,"Carbon Black|XL":3,"Graphite|S":3,"Graphite|M":3,"Graphite|L":0,"Graphite|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 6 ---------------------------------------------------------------------
  ('Graphite Zip Hoodie', 'graphite-zip-hoodie', 'Hoodies', 'Kaal Vastr', 'KV-HD-006',
   'Mid-weight 320 GSM loopback zip hoodie with a matte metal zip and a double-lined hood. Slim-merino-blend cuffs for shape retention.',
   3699, null,
   array['S','M','L','XL','XXL']::text[],
   array['Graphite Grey','Obsidian Black']::text[],
   '{"Graphite Grey|S":6,"Graphite Grey|M":8,"Graphite Grey|L":7,"Graphite Grey|XL":4,"Graphite Grey|XXL":2,"Obsidian Black|S":5,"Obsidian Black|M":5,"Obsidian Black|L":0,"Obsidian Black|XL":0,"Obsidian Black|XXL":0}'::jsonb,
   'https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1614495039153-42ea96c8f6a9?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 7 ---------------------------------------------------------------------
  ('Meridian Denim Jacket', 'meridian-denim-jacket', 'Jackets', 'Kaal Vastr', 'KV-JK-007',
   'Rigid 12 oz indigo-black denim trucker with contrast silver stitching, a chest flap pocket and a slightly cropped hem.',
   8299, 9999,
   array['S','M','L','XL']::text[],
   array['Midnight Indigo','Washed Black']::text[],
   '{"Midnight Indigo|S":2,"Midnight Indigo|M":4,"Midnight Indigo|L":3,"Midnight Indigo|XL":2,"Washed Black|S":1,"Washed Black|M":2,"Washed Black|L":0,"Washed Black|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 8 ---------------------------------------------------------------------
  ('Ember Knit Sweater', 'ember-knit-sweater', 'Sweaters', 'Kaal Vastr', 'KV-SW-008',
   'Merino-blend crewneck with a subtle charcoal marl. Warm, breathable and cut close to the body for easy layering.',
   4299, null,
   array['S','M','L','XL']::text[],
   array['Ember Charcoal','Ash Grey']::text[],
   '{"Ember Charcoal|S":4,"Ember Charcoal|M":6,"Ember Charcoal|L":5,"Ember Charcoal|XL":3,"Ash Grey|S":3,"Ash Grey|M":3,"Ash Grey|L":2,"Ash Grey|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1611312449412-6cefac5dc3e4?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1611312449412-6cefac5dc3e4?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 9 ---------------------------------------------------------------------
  ('Void Slim Jeans', 'void-slim-jeans', 'Trousers', 'Kaal Vastr', 'KV-TR-009',
   'Jet-black slim jeans in comfort-stretch denim with a clean hem finish and a mid rise. Built to hold shape all day.',
   2999, 3499,
   array['28','30','32','34','36','38']::text[],
   array['Void Black','Dark Indigo']::text[],
   '{"Void Black|28":6,"Void Black|30":9,"Void Black|32":11,"Void Black|34":7,"Void Black|36":4,"Void Black|38":0,"Dark Indigo|28":0,"Dark Indigo|30":4,"Dark Indigo|32":5,"Dark Indigo|34":3,"Dark Indigo|36":0,"Dark Indigo|38":0}'::jsonb,
   'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1475178626620-a4d074967452?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 10 --------------------------------------------------------------------
  ('Obsidian Tee — Boxy', 'obsidian-tee-boxy', 'T-Shirts', 'Kaal Vastr', 'KV-TS-010',
   'The everyday tee, cut wide and cropped just below the belt. 200 GSM ringspun cotton with a ribbed neckline.',
   1099, 1499,
   array['S','M','L','XL']::text[],
   array['Obsidian Black','Bone White']::text[],
   '{"Obsidian Black|S":14,"Obsidian Black|M":20,"Obsidian Black|L":18,"Obsidian Black|XL":10,"Bone White|S":10,"Bone White|M":12,"Bone White|L":8,"Bone White|XL":5}'::jsonb,
   'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 11 --------------------------------------------------------------------
  ('Sable Puffer Vest', 'sable-puffer-vest', 'Jackets', 'Kaal Vastr', 'KV-JK-011',
   'Insulated puffer vest with a matte shell, silicone-branded zip pull and an internal media pocket. Sits cleanly over knitwear.',
   5999, 6999,
   array['S','M','L','XL']::text[],
   array['Sable Black','Ash']::text[],
   '{"Sable Black|S":3,"Sable Black|M":5,"Sable Black|L":4,"Sable Black|XL":1,"Ash|S":0,"Ash|M":2,"Ash|L":2,"Ash|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 12 --------------------------------------------------------------------
  ('KV Signature Cap', 'kv-signature-cap', 'Accessories', 'Kaal Vastr', 'KV-AC-012',
   'Six-panel structured cap in brushed cotton twill with a tonal embroidered KV monogram and a metal adjuster.',
   899, null,
   array['One Size']::text[],
   array['Obsidian Black','Stone Grey']::text[],
   '{"Obsidian Black|One Size":22,"Stone Grey|One Size":9}'::jsonb,
   'https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true)

on conflict (sku) do update set
  name             = excluded.name,
  slug             = excluded.slug,
  category         = excluded.category,
  description      = excluded.description,
  selling_price    = excluded.selling_price,
  compare_at_price = excluded.compare_at_price,
  sizes            = excluded.sizes,
  colors           = excluded.colors,
  variant_stock    = excluded.variant_stock,
  image_url        = excluded.image_url,
  images           = excluded.images,
  is_featured      = excluded.is_featured,
  is_available     = excluded.is_available,
  is_archived      = false,
  updated_at       = now();
