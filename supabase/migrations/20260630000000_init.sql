-- ============================================================
-- SCHEMA COMPLETO: Restaurant Reservation SaaS
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  phone TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'ES',
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  subscription_plan TEXT CHECK (subscription_plan IN ('basic', 'pro', 'trial')) DEFAULT 'trial',
  subscription_status TEXT CHECK (subscription_status IN ('active', 'inactive', 'past_due', 'cancelled')) DEFAULT 'active',
  subscription_ends_at TIMESTAMPTZ,
  default_reservation_duration INT DEFAULT 90,
  max_party_size INT DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'waiter')) DEFAULT 'waiter',
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  canvas_width INT NOT NULL DEFAULT 1200,
  canvas_height INT NOT NULL DEFAULT 800,
  background_color TEXT DEFAULT '#f8f9fa',
  background_image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS table_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shape TEXT NOT NULL CHECK (shape IN ('circle', 'square', 'rectangle', 'oval')),
  capacity INT NOT NULL,
  width INT NOT NULL DEFAULT 80,
  height INT NOT NULL DEFAULT 80,
  color TEXT DEFAULT '#3b82f6',
  icon_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  table_type_id UUID REFERENCES table_types(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  position_x FLOAT NOT NULL DEFAULT 100,
  position_y FLOAT NOT NULL DEFAULT 100,
  rotation INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning', 'blocked')) DEFAULT 'available',
  occupied_since TIMESTAMPTZ,
  current_reservation_id UUID,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS table_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS table_group_members (
  group_id UUID NOT NULL REFERENCES table_groups(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, table_id)
);

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  days_of_week INT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  table_id UUID REFERENCES tables(id) ON DELETE SET NULL,
  group_id UUID REFERENCES table_groups(id) ON DELETE SET NULL,
  reservation_number TEXT UNIQUE,
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 90,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'
  )) DEFAULT 'pending',
  notes TEXT,
  internal_notes TEXT,
  seated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tables 
  ADD CONSTRAINT fk_current_reservation 
  FOREIGN KEY (current_reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS reservation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tables_updated_at BEFORE UPDATE ON tables FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER reservations_updated_at BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto numeración de reserva
CREATE OR REPLACE FUNCTION generate_reservation_number()
RETURNS TRIGGER AS $$
DECLARE
  counter INT;
  year_str TEXT;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  SELECT COUNT(*) + 1 INTO counter 
  FROM reservations 
  WHERE tenant_id = NEW.tenant_id 
    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  NEW.reservation_number := 'RES-' || year_str || '-' || LPAD(counter::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_reservation_number 
  BEFORE INSERT ON reservations 
  FOR EACH ROW EXECUTE FUNCTION generate_reservation_number();

-- Habilitar RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_logs ENABLE ROW LEVEL SECURITY;

-- Helper RLS
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS Policies
CREATE POLICY "tenant_select" ON tenants FOR SELECT USING (id = current_tenant_id());
CREATE POLICY "tenant_update" ON tenants FOR UPDATE USING (id = current_tenant_id());
CREATE POLICY "users_select" ON user_profiles FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY "users_insert" ON user_profiles FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "users_update" ON user_profiles FOR UPDATE USING (tenant_id = current_tenant_id());
CREATE POLICY "rooms_select" ON rooms FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY "rooms_insert" ON rooms FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "rooms_update" ON rooms FOR UPDATE USING (tenant_id = current_tenant_id());
CREATE POLICY "rooms_delete" ON rooms FOR DELETE USING (tenant_id = current_tenant_id());
CREATE POLICY "table_types_all" ON table_types FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tables_select" ON tables FOR SELECT USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));
CREATE POLICY "tables_insert" ON tables FOR INSERT WITH CHECK (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));
CREATE POLICY "tables_update" ON tables FOR UPDATE USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));
CREATE POLICY "tables_delete" ON tables FOR DELETE USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));
CREATE POLICY "shifts_all" ON shifts FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "reservations_select" ON reservations FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY "reservations_insert" ON reservations FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "reservations_update" ON reservations FOR UPDATE USING (tenant_id = current_tenant_id());
CREATE POLICY "reservations_delete" ON reservations FOR DELETE USING (tenant_id = current_tenant_id());
CREATE POLICY "groups_all" ON table_groups FOR ALL USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));
CREATE POLICY "group_members_select" ON table_group_members FOR SELECT USING (group_id IN (SELECT id FROM table_groups WHERE room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id())));
CREATE POLICY "group_members_insert" ON table_group_members FOR INSERT WITH CHECK (group_id IN (SELECT id FROM table_groups WHERE room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id())));
CREATE POLICY "group_members_delete" ON table_group_members FOR DELETE USING (group_id IN (SELECT id FROM table_groups WHERE room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id())));
