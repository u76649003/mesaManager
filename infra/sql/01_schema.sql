-- ============================================================
-- SCHEMA COMPLETO: Restaurant Reservation SaaS
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TENANTS (Restaurantes / Bares)
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
  -- Stripe
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  subscription_plan TEXT CHECK (subscription_plan IN ('basic', 'pro', 'trial')) DEFAULT 'trial',
  subscription_status TEXT CHECK (subscription_status IN ('active', 'inactive', 'past_due', 'cancelled')) DEFAULT 'active',
  subscription_ends_at TIMESTAMPTZ,
  -- Settings
  default_reservation_duration INT DEFAULT 90, -- minutos
  max_party_size INT DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USERS (Empleados del restaurante)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY, -- referencias auth.users en Supabase
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'waiter')) DEFAULT 'waiter',
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ROOMS (Salones del restaurante)
-- ============================================================
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

-- ============================================================
-- TABLE TYPES (Tipos de mesa)
-- ============================================================
CREATE TABLE IF NOT EXISTS table_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- "Redonda 2", "Cuadrada 4", etc.
  shape TEXT NOT NULL CHECK (shape IN ('circle', 'square', 'rectangle', 'oval')),
  capacity INT NOT NULL,
  width INT NOT NULL DEFAULT 80,    -- px en canvas
  height INT NOT NULL DEFAULT 80,
  color TEXT DEFAULT '#3b82f6',
  icon_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLES (Mesas individuales en el plano)
-- ============================================================
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  table_type_id UUID REFERENCES table_types(id),
  label TEXT NOT NULL,              -- "M1", "T5", "B12"
  position_x FLOAT NOT NULL DEFAULT 100,
  position_y FLOAT NOT NULL DEFAULT 100,
  rotation INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning', 'blocked')) DEFAULT 'available',
  occupied_since TIMESTAMPTZ,
  current_reservation_id UUID,      -- FK circular, se resuelve después
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE GROUPS (Mesas unidas)
-- ============================================================
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

-- ============================================================
-- SHIFTS (Turnos: Mañana / Noche)
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- "Mediodía", "Noche"
  start_time TIME NOT NULL,         -- "13:00"
  end_time TIME NOT NULL,           -- "16:30"
  days_of_week INT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}', -- 1=Lunes...7=Domingo
  color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RESERVATIONS (Reservas)
-- ============================================================
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id),
  shift_id UUID REFERENCES shifts(id),
  table_id UUID REFERENCES tables(id),
  group_id UUID REFERENCES table_groups(id),
  -- Número de reserva legible
  reservation_number TEXT NOT NULL,
  -- Datos del cliente
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INT NOT NULL,
  -- Fecha y hora
  date DATE NOT NULL,
  time TIME NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 90,
  -- Estado
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'
  )) DEFAULT 'pending',
  notes TEXT,
  internal_notes TEXT,
  -- Timestamps
  seated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ahora podemos añadir la FK circular de tables
ALTER TABLE tables 
  ADD CONSTRAINT fk_current_reservation 
  FOREIGN KEY (current_reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

-- ============================================================
-- RESERVATION LOGS (Historial / Auditoría)
-- ============================================================
CREATE TABLE IF NOT EXISTS reservation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id),
  event TEXT NOT NULL CHECK (event IN (
    'created', 'confirmed', 'seated', 'table_assigned', 'table_changed',
    'merged', 'split', 'completed', 'cancelled', 'no_show', 'note_added'
  )),
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- FUNCIONES Y TRIGGERS
-- ============================================================

-- Auto-actualizar updated_at
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

-- Generar número de reserva legible: RES-{AÑO}-{NNNNNN}
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

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX idx_tables_room_id ON tables(room_id);
CREATE INDEX idx_tables_status ON tables(status);
CREATE INDEX idx_reservations_tenant_date ON reservations(tenant_id, date);
CREATE INDEX idx_reservations_status ON reservations(status);
CREATE INDEX idx_reservations_table ON reservations(table_id);
CREATE INDEX idx_reservation_logs_reservation ON reservation_logs(reservation_id);
CREATE INDEX idx_user_profiles_tenant ON user_profiles(tenant_id);
