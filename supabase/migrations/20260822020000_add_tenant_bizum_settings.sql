ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bizum_phone TEXT,
  ADD COLUMN IF NOT EXISTS bizum_name TEXT;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_bizum_phone_length;
ALTER TABLE tenants ADD CONSTRAINT tenants_bizum_phone_length
  CHECK (bizum_phone IS NULL OR char_length(trim(bizum_phone)) BETWEEN 5 AND 32);

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_bizum_name_length;
ALTER TABLE tenants ADD CONSTRAINT tenants_bizum_name_length
  CHECK (bizum_name IS NULL OR char_length(trim(bizum_name)) BETWEEN 1 AND 120);

NOTIFY pgrst, 'reload schema';
