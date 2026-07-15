-- Migration: Fix reservation_number trigger to avoid duplicates on deletion and across multiple tenants
CREATE OR REPLACE FUNCTION generate_reservation_number()
RETURNS trigger AS $$
DECLARE
  max_num INT;
  year_str TEXT;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  
  -- Calculate the next number using MAX (globally) instead of COUNT.
  -- This handles deleted reservations and prevents collisions between different tenants.
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(reservation_number FROM '[0-9]+$') AS INT
      )
    ), 
    0
  ) + 1
  INTO max_num
  FROM reservations
  WHERE reservation_number LIKE 'RES-' || year_str || '-%';
  
  NEW.reservation_number := 'RES-' || year_str || '-' || LPAD(max_num::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
