-- Migration: Add Bizum prepayment columns to reservations table and fix trigger precedence bug
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS send_email BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_prepayment BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS prepayment_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS prepayment_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'no_payment_required',
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'online',
ADD COLUMN IF NOT EXISTS bizum_phone VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS bizum_name VARCHAR(255) DEFAULT NULL;

-- Corregir la precedencia de operadores en el generador de número de reserva
CREATE OR REPLACE FUNCTION generate_reservation_number()
RETURNS TRIGGER AS $$
DECLARE
  max_num INT;
  year_str TEXT;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  
  -- Usamos paréntesis alrededor de ('^RES-' || year_str) para corregir el error 
  -- "argument of AND must be type boolean, not type text" provocado por precedencia de ~ sobre ||.
  SELECT COALESCE(
    MAX(
      CAST(
        REGEXP_REPLACE(reservation_number, '[^0-9]', '', 'g')
        AS INT
      )
    ), 0
  ) + 1
  INTO max_num
  FROM reservations
  WHERE tenant_id = NEW.tenant_id
    AND reservation_number ~ ('^RES-' || year_str);

  NEW.reservation_number := 'RES-' || year_str || '-' || LPAD(max_num::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Notify postgrest to reload the schema cache so columns are immediately visible
NOTIFY pgrst, 'reload schema';
