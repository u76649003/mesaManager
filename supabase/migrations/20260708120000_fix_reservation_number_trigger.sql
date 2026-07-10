-- ============================================================
-- Fix: reservation_number trigger uses MAX instead of COUNT
-- to avoid duplicate key errors on concurrent/retried inserts
-- ============================================================

CREATE OR REPLACE FUNCTION generate_reservation_number()
RETURNS TRIGGER AS $$
DECLARE
  max_num INT;
  year_str TEXT;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  -- Use MAX + 1 instead of COUNT + 1 to avoid duplicates
  -- when rows already exist (retried inserts, etc.)
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
