-- Tenant-scoped assistant configuration and safe reservation operations.
-- Apply with `supabase db push` after reviewing against the target project.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS assistant_name TEXT,
  ADD COLUMN IF NOT EXISTS assistant_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_assistant_name_length;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_assistant_name_length
  CHECK (assistant_name IS NULL OR char_length(trim(assistant_name)) BETWEEN 1 AND 24);

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM user_profiles
  WHERE id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated;

-- Replace the broad tenant update policy: waiters may read configuration, but only
-- owners/managers may change tenant-wide settings (including assistant identity).
DROP POLICY IF EXISTS tenant_update ON tenants;
DROP POLICY IF EXISTS tenant_update_restricted ON tenants;
CREATE POLICY tenant_update_restricted ON tenants
FOR UPDATE
USING (id = current_tenant_id() AND current_user_role() IN ('owner', 'manager'))
WITH CHECK (id = current_tenant_id() AND current_user_role() IN ('owner', 'manager'));

CREATE OR REPLACE FUNCTION assistant_table_candidates(
  p_date DATE,
  p_time TIME,
  p_party_size INT,
  p_duration_minutes INT DEFAULT NULL,
  p_room_id UUID DEFAULT NULL,
  p_exclude_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE(
  allocation_type TEXT,
  allocation_id UUID,
  room_id UUID,
  label TEXT,
  capacity INT,
  wasted_capacity INT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := current_tenant_id();
  v_duration INT;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_party_size < 1 THEN RAISE EXCEPTION 'invalid_party_size'; END IF;
  SELECT COALESCE(p_duration_minutes, default_reservation_duration, 90)
    INTO v_duration FROM tenants WHERE id = v_tenant;
  IF v_duration < 15 OR v_duration > 720 THEN RAISE EXCEPTION 'invalid_duration'; END IF;

  RETURN QUERY
  WITH active_reservations AS (
    SELECT r.table_id, r.group_id
    FROM reservations r
    WHERE r.tenant_id = v_tenant
      AND r.date = p_date
      AND r.status NOT IN ('cancelled', 'no_show', 'completed')
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND p_time < r.time + make_interval(mins => r.duration_minutes)
      AND r.time < p_time + make_interval(mins => v_duration)
  ), blocked_tables AS (
    SELECT ar.table_id AS table_id FROM active_reservations ar WHERE ar.table_id IS NOT NULL
    UNION
    SELECT gm.table_id FROM active_reservations ar
      JOIN table_group_members gm ON gm.group_id = ar.group_id
    UNION
    SELECT gm.table_id FROM active_reservations ar
      JOIN table_group_members gm ON gm.group_id IN (
        SELECT gm2.group_id FROM table_group_members gm2 WHERE gm2.table_id = ar.table_id
      )
  ), singles AS (
    SELECT 'table'::TEXT allocation_type, t.id allocation_id, t.room_id,
           t.label, tt.capacity::INT capacity
    FROM tables t
    JOIN rooms ro ON ro.id = t.room_id AND ro.tenant_id = v_tenant
    JOIN table_types tt ON tt.id = t.table_type_id
    WHERE t.is_active AND ro.is_active AND t.status <> 'blocked'
      AND (p_room_id IS NULL OR t.room_id = p_room_id)
      AND tt.capacity >= p_party_size
      AND NOT EXISTS (SELECT 1 FROM blocked_tables bt WHERE bt.table_id = t.id)
  ), groups AS (
    SELECT 'group'::TEXT allocation_type, g.id allocation_id, g.room_id,
           COALESCE(g.label, string_agg(t.label, ' + ' ORDER BY t.label)) label,
           sum(tt.capacity)::INT capacity
    FROM table_groups g
    JOIN rooms ro ON ro.id = g.room_id AND ro.tenant_id = v_tenant
    JOIN table_group_members gm ON gm.group_id = g.id
    JOIN tables t ON t.id = gm.table_id AND t.is_active AND t.status <> 'blocked'
    JOIN table_types tt ON tt.id = t.table_type_id
    WHERE g.is_active AND ro.is_active
      AND (p_room_id IS NULL OR g.room_id = p_room_id)
      AND NOT EXISTS (SELECT 1 FROM blocked_tables bt WHERE bt.table_id = t.id)
    GROUP BY g.id, g.room_id, g.label
    HAVING sum(tt.capacity) >= p_party_size
  )
  SELECT c.allocation_type, c.allocation_id, c.room_id, c.label, c.capacity,
         c.capacity - p_party_size
  FROM (SELECT * FROM singles UNION ALL SELECT * FROM groups) c
  ORDER BY c.capacity - p_party_size, CASE WHEN c.allocation_type = 'table' THEN 0 ELSE 1 END, c.label;
END;
$$;

REVOKE ALL ON FUNCTION assistant_table_candidates(DATE, TIME, INT, INT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant_table_candidates(DATE, TIME, INT, INT, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION assistant_execute_reservation(p_operation JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := current_tenant_id();
  v_user UUID := auth.uid();
  v_action TEXT := p_operation->>'action';
  v_reservation reservations%ROWTYPE;
  v_candidate RECORD;
  v_id UUID;
  v_date DATE;
  v_time TIME;
  v_party INT;
  v_duration INT;
BEGIN
  IF v_tenant IS NULL OR current_user_role() NOT IN ('owner', 'manager', 'waiter') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- Serialize assistant allocation decisions per tenant and date.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::TEXT || ':' || COALESCE(p_operation->>'date', ''), 0));

  IF v_action = 'create_reservation' THEN
    v_date := (p_operation->>'date')::DATE;
    v_time := (p_operation->>'time')::TIME;
    v_party := (p_operation->>'party_size')::INT;
    SELECT COALESCE((p_operation->>'duration_minutes')::INT, default_reservation_duration, 90)
      INTO v_duration FROM tenants WHERE id = v_tenant;
    SELECT * INTO v_candidate FROM assistant_table_candidates(
      v_date, v_time, v_party, v_duration, NULLIF(p_operation->>'room_id', '')::UUID, NULL
    ) LIMIT 1;
    IF v_candidate.allocation_id IS NULL THEN RAISE EXCEPTION 'no_availability'; END IF;
    INSERT INTO reservations(
      tenant_id, room_id, table_id, group_id, guest_name, guest_phone, guest_email,
      party_size, date, time, duration_minutes, status, notes
    ) VALUES (
      v_tenant, v_candidate.room_id,
      CASE WHEN v_candidate.allocation_type = 'table' THEN v_candidate.allocation_id END,
      CASE WHEN v_candidate.allocation_type = 'group' THEN v_candidate.allocation_id END,
      trim(p_operation->>'guest_name'), NULLIF(trim(p_operation->>'guest_phone'), ''),
      NULLIF(trim(p_operation->>'guest_email'), ''), v_party, v_date, v_time, v_duration,
      'confirmed', NULLIF(trim(p_operation->>'notes'), '')
    ) RETURNING * INTO v_reservation;
    v_id := v_reservation.id;
  ELSE
    v_id := (p_operation->>'reservation_id')::UUID;
    SELECT * INTO v_reservation FROM reservations
      WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;

    IF v_action = 'cancel_reservation' THEN
      IF v_reservation.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'invalid_reservation_status'; END IF;
      UPDATE reservations SET status = 'cancelled' WHERE id = v_id RETURNING * INTO v_reservation;
    ELSIF v_action = 'update_reservation' THEN
      v_date := COALESCE(NULLIF(p_operation->>'date', '')::DATE, v_reservation.date);
      v_time := COALESCE(NULLIF(p_operation->>'time', '')::TIME, v_reservation.time);
      v_party := COALESCE(NULLIF(p_operation->>'party_size', '')::INT, v_reservation.party_size);
      v_duration := COALESCE(NULLIF(p_operation->>'duration_minutes', '')::INT, v_reservation.duration_minutes);
      SELECT * INTO v_candidate FROM assistant_table_candidates(
        v_date, v_time, v_party, v_duration,
        COALESCE(NULLIF(p_operation->>'room_id', '')::UUID, v_reservation.room_id), v_id
      ) LIMIT 1;
      IF v_candidate.allocation_id IS NULL THEN RAISE EXCEPTION 'no_availability'; END IF;
      UPDATE reservations SET
        guest_name = COALESCE(NULLIF(trim(p_operation->>'guest_name'), ''), guest_name),
        party_size = v_party, date = v_date, time = v_time, duration_minutes = v_duration,
        room_id = v_candidate.room_id,
        table_id = CASE WHEN v_candidate.allocation_type = 'table' THEN v_candidate.allocation_id END,
        group_id = CASE WHEN v_candidate.allocation_type = 'group' THEN v_candidate.allocation_id END
      WHERE id = v_id RETURNING * INTO v_reservation;
    ELSIF v_action = 'require_prepayment' THEN
      IF COALESCE((p_operation->>'amount')::NUMERIC, 0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
      UPDATE reservations SET is_prepayment = true,
        prepayment_amount = (p_operation->>'amount')::NUMERIC,
        prepayment_reason = COALESCE(NULLIF(trim(p_operation->>'reason'), ''), 'Garantía de reserva'),
        payment_status = 'pending', status = 'pending'
      WHERE id = v_id RETURNING * INTO v_reservation;
    ELSE
      RAISE EXCEPTION 'unsupported_action';
    END IF;
  END IF;

  INSERT INTO reservation_logs(reservation_id, user_id, event, payload)
  VALUES (v_id, v_user, 'assistant_' || v_action, p_operation - 'guest_phone' - 'guest_email');
  RETURN jsonb_build_object(
    'id', v_reservation.id, 'reservation_number', v_reservation.reservation_number,
    'status', v_reservation.status, 'table_id', v_reservation.table_id,
    'group_id', v_reservation.group_id
  );
END;
$$;

REVOKE ALL ON FUNCTION assistant_execute_reservation(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant_execute_reservation(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
