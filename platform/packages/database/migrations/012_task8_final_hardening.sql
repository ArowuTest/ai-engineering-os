-- Task 8 final hardening: crash-safe reviewer execution claims and bounded recall support.

CREATE INDEX collaborative_memory_links_target_relation_idx
  ON collaborative_memory_links (organisation_id, project_id, target_memory_id, relation);

ALTER TABLE review_reviewer_assignments
  ADD COLUMN execution_claim_token text CHECK (
    execution_claim_token IS NULL OR execution_claim_token ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  ADD COLUMN execution_started_at timestamptz;

ALTER TABLE review_reviewer_assignments
  DROP CONSTRAINT review_reviewer_assignments_status_check,
  DROP CONSTRAINT review_assignment_state_ck;

ALTER TABLE review_reviewer_assignments
  ADD CONSTRAINT review_reviewer_assignments_status_check CHECK (
    status IN ('assigned','executing','completed','availability_failure')
  );
ALTER TABLE review_reviewer_assignments
  ADD CONSTRAINT review_assignment_state_ck CHECK (
    (status = 'assigned'
      AND availability_reason IS NULL AND content_digest IS NULL AND resolved_at IS NULL
      AND execution_claim_token IS NULL)
    OR (status = 'executing'
      AND availability_reason IS NULL AND content_digest IS NULL AND resolved_at IS NULL
      AND execution_claim_token IS NOT NULL AND execution_started_at IS NOT NULL)
    OR (status = 'completed'
      AND availability_reason IS NULL AND content_digest IS NOT NULL AND resolved_at IS NOT NULL
      AND execution_claim_token IS NULL)
    OR (status = 'availability_failure'
      AND availability_reason IS NOT NULL AND content_digest IS NULL AND resolved_at IS NOT NULL
      AND execution_claim_token IS NULL)
  );

CREATE INDEX review_reviewer_assignments_execution_claim_idx
  ON review_reviewer_assignments (organisation_id, review_run_id, status, execution_claim_token)
  WHERE status = 'executing';