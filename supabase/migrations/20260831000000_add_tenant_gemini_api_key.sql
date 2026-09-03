ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;

NOTIFY pgrst, 'reload schema';
