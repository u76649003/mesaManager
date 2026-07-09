-- ============================================================
-- MIGRACIÓN: Gestión de Camareros (Equipo) y Asignación de Reservas
-- ============================================================

CREATE TABLE IF NOT EXISTS waiters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Habilitar RLS en la tabla de camareros
ALTER TABLE waiters ENABLE ROW LEVEL SECURITY;

-- Política de RLS para aislar camareros por inquilino (tenant)
CREATE POLICY "waiters_all" ON waiters FOR ALL 
  USING (tenant_id = current_tenant_id()) 
  WITH CHECK (tenant_id = current_tenant_id());

-- Disparador para actualizar el campo updated_at automáticamente
CREATE TRIGGER waiters_updated_at BEFORE UPDATE ON waiters 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Añadir relación de camarero en la tabla de reservas
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS waiter_id UUID REFERENCES waiters(id) ON DELETE SET NULL;
