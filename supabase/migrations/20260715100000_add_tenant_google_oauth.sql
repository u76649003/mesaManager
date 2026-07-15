-- Migration: Add Google OAuth credential columns to tenants table
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS google_access_token TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS google_email TEXT DEFAULT NULL;

-- Notify postgrest to reload schema cache
NOTIFY pgrst, 'reload schema';
