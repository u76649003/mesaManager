-- Migration: Add SMTP and Stripe credentials columns to tenants table
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS smtp_host TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS smtp_port INT DEFAULT 587,
ADD COLUMN IF NOT EXISTS smtp_user TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS smtp_pass TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS smtp_from TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS stripe_secret_key TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS stripe_publishable_key TEXT DEFAULT NULL;

-- Notify postgrest to reload schema cache
NOTIFY pgrst, 'reload schema';
