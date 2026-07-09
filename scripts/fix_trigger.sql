-- Corregir el generador de números de reserva para extraer sólo el secuencial final
CREATE OR REPLACE FUNCTION generate_reservation_number()
RETURNS TRIGGER AS $$
DECLARE
  max_num INT;
  year_str TEXT;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  
  -- Extrae el número secuencial ignorando el prefijo "RES-YYYY-"
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(reservation_number FROM 'RES-[0-9]{4}-([0-9]+)')
        AS INT
      )
    ), 0
  ) + 1
  INTO max_num
  FROM reservations
  WHERE tenant_id = NEW.tenant_id 
    AND reservation_number LIKE 'RES-' || year_str || '-%';

  NEW.reservation_number := 'RES-' || year_str || '-' || LPAD(max_num::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
