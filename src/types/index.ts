/** Per colour+size units, keyed `"Colour|Size"`. */
export type VariantStock = Record<string, number>;

export type ProductCategory =
  | 'Hoodies'
  | 'T-Shirts'
  | 'Shirts'
  | 'Jackets'
  | 'Trousers'
  | 'Sweaters'
  | 'Accessories'
  | (string & {});

export interface Product {
  id: string;
  name: string;
  slug: string;
  category: ProductCategory;
  brand: string;
  sku: string;
  description: string | null;
  /** numeric columns arrive as strings over PostgREST — always coerce. */
  selling_price: number | string;
  compare_at_price: number | string | null;
  sizes: string[];
  colors: string[];
  variant_stock: VariantStock | null;
  stock: number;
  image_url: string | null;
  images: string[];
  is_featured: boolean;
  is_available: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessSettings {
  id: string;
  business_name: string;
  tagline: string | null;
  description: string | null;
  whatsapp_number: string;
  mobile_number: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  store_timings: string | null;
  gst_number: string | null;
  upi_id: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  updated_at: string;
}

export type ProfileRole = 'customer' | 'staff' | 'admin';

/**
 * `invited` accounts exist but have never confirmed their email, so they may
 * not sign in yet. `suspended` accounts are refused at the staff-console gate
 * even though `is_active` might still read true on a stale client.
 */
export type AccountStatus = 'invited' | 'active' | 'suspended';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  /**
   * Generated once from the full name at signup, unique across the table, and
   * not self-writable. Safe to render in a URL and safe to compare directly.
   */
  username: string;
  /** Public URL in the `profile-avatars` bucket; null until the customer uploads. */
  avatar_url: string | null;
  phone: string | null;
  role: ProfileRole;
  status: AccountStatus;
  is_active: boolean;
  email_verified_at: string | null;
  invited_by: string | null;
  invited_at: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Address {
  id: string;
  user_id: string;
  label: string;
  full_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type AddressDraft = Omit<Address, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export type OrderStatus = 'placed' | 'contacted' | 'dispatched' | 'delivered' | 'cancelled';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'placed',
  'contacted',
  'dispatched',
  'delivered',
  'cancelled',
];

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  slug: string | null;
  sku: string | null;
  image: string | null;
  color: string | null;
  size: string | null;
  /** numeric columns arrive as strings over PostgREST — always coerce. */
  unit_price: number | string;
  compare_at_price: number | string | null;
  quantity: number;
  line_total: number | string;
}

/**
 * Frozen copy of the delivery address as it stood when the order was placed.
 * Kept on the order precisely so that editing or deleting a saved address
 * cannot rewrite history for something already dispatched.
 */
export interface DeliverySnapshot {
  full_name?: string;
  phone?: string;
  line1?: string;
  line2?: string | null;
  landmark?: string | null;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface Order {
  id: string;
  reference: string;
  user_id: string;
  status: OrderStatus;
  item_count: number;
  subtotal: number | string;
  savings: number | string;
  total: number | string;
  customer_name: string;
  customer_phone: string;
  notes: string | null;
  address_id: string | null;
  delivery: DeliverySnapshot | null;
  cancel_requested: boolean;
  status_note: string | null;
  status_updated_at: string | null;
  status_updated_by: string | null;
  contacted_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
}

/** A customer account as rendered on the admin "Staff & Admin Accounts" screen. */
export interface StaffAccount extends Profile {
  order_count?: number;
  last_seen_at?: string | null;
}

export type StaffEventKind =
  | 'invite_sent'
  | 'invite_resent'
  | 'password_reset_sent'
  | 'role_changed'
  | 'suspended'
  | 'reactivated'
  | 'account_created';

export interface StaffAccountEvent {
  id: string;
  profile_id: string;
  actor_id: string | null;
  kind: StaffEventKind | string;
  detail: string | null;
  created_at: string;
}

/** A product normalised for the storefront, with derived display helpers. */
export interface StoreProduct extends Product {
  price: number;
  compareAt: number | null;
  primaryImage: string | null;
  gallery: string[];
  inStock: boolean;
  totalStock: number;
  maxSelectableQuantity: number;
}

export interface CartLine {
  /** Stable composite id: `productId::color::size`. */
  id: string;
  productId: string;
  name: string;
  slug: string;
  sku: string;
  image: string | null;
  color: string | null;
  size: string | null;
  unitPrice: number;
  compareAt: number | null;
  quantity: number;
  /** Stock ceiling captured at add-time so the cart can clamp quantities. */
  maxQuantity: number;
  category: string;
}

export interface CartTotals {
  itemCount: number;
  lineCount: number;
  subtotal: number;
  savings: number;
  total: number;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  notes: string;
}
