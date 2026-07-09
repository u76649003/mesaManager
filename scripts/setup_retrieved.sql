-- Fix reservation_number trigger (MAX instead of COUNT to avoid duplicates)
CREATE OR REPLACE FUNCTION generate_reservation_number()
RETURNS TRIGGER AS $$
DECLARE
  max_num INT;
  year_str TEXT;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(reservation_number, '[^0-9]', '', 'g') AS INT)), 0) + 1
  INTO max_num
  FROM reservations
  WHERE tenant_id = NEW.tenant_id AND reservation_number LIKE 'RES-' || year_str || '%';
  NEW.reservation_number := 'RES-' || year_str || '-' || LPAD(max_num::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Set justojgd@gmail.com to premium (pro plan)
UPDATE tenants t
SET subscription_plan = 'pro',
    subscription_status = 'active',
    subscription_ends_at = NOW() + INTERVAL '1 year'
FROM user_profiles up
JOIN auth.users au ON au.id = up.id
WHERE up.tenant_id = t.id
  AND au.email = 'justojgd@gmail.com';

SELECT t.name, t.subscription_plan, t.subscription_status
FROM tenants t
JOIN user_profiles up ON up.tenant_id = t.id
JOIN auth.users au ON au.id = up.id
WHERE au.email = 'justojgd@gmail.com';
