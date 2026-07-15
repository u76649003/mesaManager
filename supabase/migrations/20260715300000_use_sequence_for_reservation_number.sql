-- Migration: Use database sequence for reservation_number to prevent duplicates completely
CREATE SEQUENCE IF NOT EXISTS reservation_number_seq;

-- Synchronize the sequence with the highest existing number in the table
SELECT setval('reservation_number_seq', COALESCE((
  SELECT MAX(CAST(RIGHT(TRIM(reservation_number), 6) AS INT))
  FROM reservations
  WHERE reservation_number LIKE 'RES-%' AND length(TRIM(reservation_number)) >= 6
), 0) + 1, false);

-- Update trigger function to use the sequence
CREATE OR REPLACE FUNCTION generate_reservation_number()
RETURNS trigger AS $$
DECLARE
  seq_num INT;
  year_str TEXT;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  seq_num := nextval('reservation_number_seq');
  NEW.reservation_number := 'RES-' || year_str || '-' || LPAD(seq_num::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
