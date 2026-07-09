-- Deshabilitar RLS temporalmente en tenants y user_profiles para reescribir las políticas de forma limpia
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

-- Volver a habilitar RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas antiguas conflictivas
DROP POLICY IF EXISTS "tenant_select" ON tenants;
DROP POLICY IF EXISTS "tenant_update" ON tenants;
DROP POLICY IF EXISTS "tenant_insert_public" ON tenants;

DROP POLICY IF EXISTS "users_select" ON user_profiles;
DROP POLICY IF EXISTS "users_insert" ON user_profiles;
DROP POLICY IF EXISTS "users_insert_public" ON user_profiles;
DROP POLICY IF EXISTS "users_update" ON user_profiles;

-- 1. POLÍTICAS PARA TENANTS
-- Permitir inserción libre (necesario para el registro de nuevos restaurantes)
CREATE POLICY "tenant_insert_unrestricted" ON tenants FOR INSERT 
  WITH CHECK (true);

-- Permitir lectura si el usuario pertenece al tenant (filtro current_tenant_id) o si el RLS se omite por rol de servicio
CREATE POLICY "tenant_select_restricted" ON tenants FOR SELECT 
  USING (id = current_tenant_id() OR auth.role() = 'service_role');

-- Permitir actualización solo a dueños/miembros del propio tenant
CREATE POLICY "tenant_update_restricted" ON tenants FOR UPDATE 
  USING (id = current_tenant_id() OR auth.role() = 'service_role');


-- 2. POLÍTICAS PARA USER_PROFILES
-- Permitir inserción libre durante el onboarding de un nuevo usuario
CREATE POLICY "users_insert_unrestricted" ON user_profiles FOR INSERT 
  WITH CHECK (true);

-- Permitir lectura de perfiles a usuarios autenticados del mismo tenant o rol administrativo
CREATE POLICY "users_select_restricted" ON user_profiles FOR SELECT 
  USING (tenant_id = current_tenant_id() OR auth.role() = 'service_role');

-- Permitir actualizar su propio perfil
CREATE POLICY "users_update_restricted" ON user_profiles FOR UPDATE 
  USING (tenant_id = current_tenant_id() OR auth.role() = 'service_role');
