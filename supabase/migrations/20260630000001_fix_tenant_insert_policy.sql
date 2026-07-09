-- Permitir que cualquier usuario (incluso no autenticado) inserte un nuevo tenant durante el registro
CREATE POLICY "tenant_insert_public" ON tenants FOR INSERT 
  WITH CHECK (true);

-- También permitir que usuarios autenticados que se registran puedan crear su perfil
CREATE POLICY "users_insert_public" ON user_profiles FOR INSERT
  WITH CHECK (true);
