-- ============================================================
-- ROW LEVEL SECURITY (Multi-tenancy)
-- ============================================================
-- NOTA: En Supabase, auth.uid() devuelve el ID del usuario autenticado.
-- Cada tabla usa RLS para que un usuario solo acceda a datos de su tenant.

-- Habilitar RLS en todas las tablas
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

-- Función helper: obtener tenant_id del usuario actual
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- POLICIES: tenants
-- ============================================================
CREATE POLICY "tenant_select" ON tenants FOR SELECT 
  USING (id = current_tenant_id());

CREATE POLICY "tenant_update" ON tenants FOR UPDATE 
  USING (id = current_tenant_id());

-- ============================================================
-- POLICIES: user_profiles
-- ============================================================
CREATE POLICY "users_select" ON user_profiles FOR SELECT 
  USING (tenant_id = current_tenant_id());

CREATE POLICY "users_insert" ON user_profiles FOR INSERT 
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "users_update" ON user_profiles FOR UPDATE 
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- POLICIES: rooms
-- ============================================================
CREATE POLICY "rooms_select" ON rooms FOR SELECT 
  USING (tenant_id = current_tenant_id());

CREATE POLICY "rooms_insert" ON rooms FOR INSERT 
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "rooms_update" ON rooms FOR UPDATE 
  USING (tenant_id = current_tenant_id());

CREATE POLICY "rooms_delete" ON rooms FOR DELETE 
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- POLICIES: table_types
-- ============================================================
CREATE POLICY "table_types_all" ON table_types FOR ALL 
  USING (tenant_id = current_tenant_id()) 
  WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- POLICIES: tables (via room -> tenant)
-- ============================================================
CREATE POLICY "tables_select" ON tables FOR SELECT 
  USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));

CREATE POLICY "tables_insert" ON tables FOR INSERT 
  WITH CHECK (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));

CREATE POLICY "tables_update" ON tables FOR UPDATE 
  USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));

CREATE POLICY "tables_delete" ON tables FOR DELETE 
  USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));

-- ============================================================
-- POLICIES: table_groups y members
-- ============================================================
CREATE POLICY "groups_all" ON table_groups FOR ALL 
  USING (room_id IN (SELECT id FROM rooms WHERE tenant_id = current_tenant_id()));

CREATE POLICY "group_members_select" ON table_group_members FOR SELECT 
  USING (group_id IN (SELECT id FROM table_groups WHERE room_id IN (
    SELECT id FROM rooms WHERE tenant_id = current_tenant_id()
  )));

CREATE POLICY "group_members_insert" ON table_group_members FOR INSERT 
  WITH CHECK (group_id IN (SELECT id FROM table_groups WHERE room_id IN (
    SELECT id FROM rooms WHERE tenant_id = current_tenant_id()
  )));

CREATE POLICY "group_members_delete" ON table_group_members FOR DELETE 
  USING (group_id IN (SELECT id FROM table_groups WHERE room_id IN (
    SELECT id FROM rooms WHERE tenant_id = current_tenant_id()
  )));

-- ============================================================
-- POLICIES: shifts
-- ============================================================
CREATE POLICY "shifts_all" ON shifts FOR ALL 
  USING (tenant_id = current_tenant_id()) 
  WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- POLICIES: reservations
-- ============================================================
CREATE POLICY "reservations_select" ON reservations FOR SELECT 
  USING (tenant_id = current_tenant_id());

CREATE POLICY "reservations_insert" ON reservations FOR INSERT 
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "reservations_update" ON reservations FOR UPDATE 
  USING (tenant_id = current_tenant_id());

CREATE POLICY "reservations_delete" ON reservations FOR DELETE 
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- POLICIES: reservation_logs
-- ============================================================
CREATE POLICY "logs_select" ON reservation_logs FOR SELECT 
  USING (reservation_id IN (
    SELECT id FROM reservations WHERE tenant_id = current_tenant_id()
  ));

CREATE POLICY "logs_insert" ON reservation_logs FOR INSERT 
  WITH CHECK (reservation_id IN (
    SELECT id FROM reservations WHERE tenant_id = current_tenant_id()
  ));
