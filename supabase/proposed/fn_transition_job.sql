-- PROPOSED — not applied. Do not merge into schema.sql / 0001_init.sql until approved.
--
-- Why this is needed:
-- transitionJob currently issues independent PostgREST calls (job_status_event INSERT,
-- job UPDATE including close-out columns, job_assignment UPDATE, pm_visit UPDATE).
-- That cannot be claimed as a single transaction. This RPC wraps the same writes
-- so audit, job row, assignment completion, and PM visit completion commit or
-- roll back together.
--
-- pm_visit.completed_at is also missing from the current schema. The report asked
-- to set it consistently; that requires the ALTER below. Until approved, the app
-- only sets pm_visit.status = 'done'.

-- ALTER TABLE pm_visit
--   ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION fn_transition_job(
  p_job_id UUID,
  p_to_state_code TEXT,
  p_changed_by UUID DEFAULT NULL,
  p_geo_lat FLOAT DEFAULT NULL,
  p_geo_lng FLOAT DEFAULT NULL,
  p_synced_offline BOOLEAN DEFAULT FALSE,
  p_technician_notes TEXT DEFAULT NULL,
  p_signature_url TEXT DEFAULT NULL,
  p_customer_rating INT DEFAULT NULL,
  p_customer_feedback TEXT DEFAULT NULL,
  p_checklist_answers JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_job RECORD;
  v_from RECORD;
  v_to RECORD;
  v_event_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_updates JSONB;
BEGIN
  SELECT j.job_id, j.current_state_id, j.job_type_id, j.ticket_id, j.pm_visit_id,
         j.actual_start, j.actual_end
    INTO v_job
  FROM job j
  WHERE j.job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'PT404';
  END IF;

  SELECT state_id, code, allowed_next, is_terminal
    INTO v_from
  FROM workflow_state
  WHERE state_id = v_job.current_state_id;

  SELECT state_id, code, is_terminal
    INTO v_to
  FROM workflow_state
  WHERE job_type_id = v_job.job_type_id
    AND code = p_to_state_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target workflow state not found' USING ERRCODE = 'PT400';
  END IF;

  IF v_from.allowed_next IS NULL OR NOT (p_to_state_code = ANY (v_from.allowed_next)) THEN
    RAISE EXCEPTION 'Invalid transition from % to %', v_from.code, p_to_state_code
      USING ERRCODE = 'PT400';
  END IF;

  IF p_customer_rating IS NOT NULL AND (p_customer_rating < 1 OR p_customer_rating > 5) THEN
    RAISE EXCEPTION 'customerRating must be an integer between 1 and 5' USING ERRCODE = 'PT400';
  END IF;

  IF p_to_state_code <> 'closed'
     AND (p_technician_notes IS NOT NULL
          OR p_signature_url IS NOT NULL
          OR p_customer_rating IS NOT NULL
          OR p_customer_feedback IS NOT NULL
          OR p_checklist_answers IS NOT NULL) THEN
    RAISE EXCEPTION 'Close-out metadata is only allowed when transitioning to closed'
      USING ERRCODE = 'PT400';
  END IF;

  INSERT INTO job_status_event (
    job_id, from_state_id, to_state_id, changed_by, geo_lat, geo_lng, synced_offline
  ) VALUES (
    p_job_id, v_from.state_id, v_to.state_id, p_changed_by, p_geo_lat, p_geo_lng, p_synced_offline
  )
  RETURNING event_id INTO v_event_id;

  UPDATE job SET
    current_state_id = v_to.state_id,
    actual_start = CASE
      WHEN p_to_state_code = 'on_site' AND actual_start IS NULL THEN v_now
      ELSE actual_start
    END,
    actual_end = CASE
      WHEN v_to.is_terminal AND actual_end IS NULL THEN v_now
      ELSE actual_end
    END,
    technician_notes = COALESCE(p_technician_notes, technician_notes),
    signature_url = COALESCE(p_signature_url, signature_url),
    customer_rating = COALESCE(p_customer_rating, customer_rating),
    customer_feedback = COALESCE(p_customer_feedback, customer_feedback),
    checklist_answers = COALESCE(p_checklist_answers, checklist_answers)
  WHERE job_id = p_job_id;

  IF v_to.is_terminal AND p_to_state_code = 'closed' THEN
    UPDATE job_assignment
       SET status = 'completed'
     WHERE job_id = p_job_id
       AND status = 'accepted';

    IF v_job.pm_visit_id IS NOT NULL THEN
      UPDATE pm_visit
         SET status = 'done'
             -- , completed_at = v_now  -- enable after ALTER TABLE pm_visit ADD completed_at
       WHERE pm_visit_id = v_job.pm_visit_id
         AND status = 'scheduled';
    END IF;
  END IF;

  IF v_job.ticket_id IS NOT NULL THEN
    IF p_to_state_code = 'closed' THEN
      UPDATE ticket SET status = 'closed' WHERE ticket_id = v_job.ticket_id;
    ELSIF p_to_state_code = 'awaiting_parts' THEN
      UPDATE ticket SET status = 'awaiting_parts' WHERE ticket_id = v_job.ticket_id;
    ELSIF p_to_state_code IN ('assigned', 'en_route', 'on_site') THEN
      UPDATE ticket SET status = 'in_progress' WHERE ticket_id = v_job.ticket_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'jobId', p_job_id,
    'fromStateCode', v_from.code,
    'fromStateId', v_from.state_id,
    'toStateCode', v_to.code,
    'toStateId', v_to.state_id,
    'eventId', v_event_id
  );
END;
$$;

-- INC-04: no schema change required. Existing constraint already serializes concurrent accepts:
-- ALTER TABLE job_assignment ADD CONSTRAINT no_double_booking
--   EXCLUDE USING gist (
--     person_id WITH =,
--     tstzrange(slot_start, slot_end, '[)') WITH &&
--   ) WHERE (status = 'accepted' AND slot_start IS NOT NULL AND slot_end IS NOT NULL);
