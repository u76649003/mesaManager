// ============================================================
// TIPOS GLOBALES — Restaurant Reservation SaaS
// ============================================================

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning' | 'blocked';
export type TableShape = 'circle' | 'square' | 'rectangle' | 'oval';
export type ReservationStatus = 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
export type UserRole = 'owner' | 'manager' | 'waiter';
export type SubscriptionPlan = 'basic' | 'pro' | 'trial';

// -------
// Tenant
// -------
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  timezone: string;
  phone?: string;
  address?: string;
  city?: string;
  country: string;
  stripe_customer_id?: string;
  subscription_plan: SubscriptionPlan;
  subscription_status: 'active' | 'inactive' | 'past_due' | 'cancelled';
  subscription_ends_at?: string;
  default_reservation_duration: number;
  grace_period_minutes: number;
  max_party_size: number;
  assistant_name?: string;
  assistant_enabled?: boolean;
  created_at: string;
}

// -------
// User
// -------
export interface UserProfile {
  id: string;
  tenant_id: string;
  role: UserRole;
  full_name: string;
  avatar_url?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
}

// -------
// Room
// -------
export interface Room {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  canvas_width: number;
  canvas_height: number;
  background_color: string;
  background_image_url?: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

// -------
// TableType
// -------
export interface TableType {
  id: string;
  tenant_id: string;
  name: string;
  shape: TableShape;
  capacity: number;
  width: number;
  height: number;
  color: string;
  icon_key?: string;
}

// -------
// Table
// -------
export interface Table {
  id: string;
  room_id: string;
  table_type_id?: string;
  table_type?: TableType;
  label: string;
  position_x: number;
  position_y: number;
  rotation: number;
  capacity?: number;
  status: TableStatus;
  occupied_since?: string;
  current_reservation_id?: string;
  current_reservation?: Reservation;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// -------
// TableGroup (mesas unidas)
// -------
export interface TableGroup {
  id: string;
  room_id: string;
  label?: string;
  member_table_ids: string[];
  is_active: boolean;
}

// -------
// Shift (Turno)
// -------
export interface Shift {
  id: string;
  tenant_id: string;
  name: string;
  start_time: string; // "13:00"
  end_time: string;   // "16:30"
  days_of_week: number[];
  color: string;
  is_active: boolean;
  sort_order: number;
}

// -------
// Reservation
// -------
export interface Reservation {
  id: string;
  tenant_id: string;
  room_id?: string;
  shift_id?: string;
  table_id?: string;
  group_id?: string;
  waiter_id?: string | null;
  reservation_number: string;
  guest_name: string;
  guest_phone?: string;
  guest_email?: string;
  party_size: number;
  date: string; // "2024-12-25"
  time: string; // "13:30"
  duration_minutes: number;
  status: ReservationStatus;
  notes?: string;
  internal_notes?: string;
  send_email?: boolean;
  is_prepayment?: boolean;
  prepayment_amount?: number;
  prepayment_reason?: string;
  payment_status?: 'pending' | 'paid' | 'no_payment_required';
  payment_method?: 'online' | 'bizum';
  bizum_phone?: string;
  bizum_name?: string;
  // Timestamps
  seated_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  // Relations
  room?: Room;
  shift?: Shift;
  table?: Table;
  waiter?: Waiter;
}

// -------
// Waiter (Camarero)
// -------
export interface Waiter {
  id: string;
  tenant_id: string;
  name: string;
  phone?: string;
  email?: string;
  color: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// -------
// Timer
// -------
export interface TableTimer {
  tableId: string;
  occupiedSince: string; // ISO string
  elapsedMs: number;
}

// -------
// Floor Editor
// -------
export type FloorMode = 'service' | 'edit';

export interface FloorCanvasConfig {
  width: number;
  height: number;
  backgroundColor: string;
  gridSize: number;
  snapToGrid: boolean;
}
