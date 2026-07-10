-- Migration: Add Bizum prepayment columns to reservations table
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS send_email BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_prepayment BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS prepayment_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS prepayment_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'no_payment_required',
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'online',
ADD COLUMN IF NOT EXISTS bizum_phone VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS bizum_name VARCHAR(255) DEFAULT NULL;

-- Notify postgrest to reload the schema cache so columns are immediately visible
NOTIFY pgrst, 'reload schema';
