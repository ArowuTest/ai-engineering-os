-- Generic, domain-neutral assurance runs and findings.
-- Profiles define review semantics; platform persistence owns exact-target evidence.

CREATE TABLE assurance_runs (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  profile_id text NOT NULL CHECK (profile_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  target_type text NOT NULL CHECK (target_type ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  target_digest text NOT NULL CHECK (target_digest ~ '^[a-f0-9]{64}$'),
  reviewer_agent_capability_id text NOT NULL REFERENCES capability_catalogue(id) ON DELETE RESTRICT,
  reviewer_route_id text NOT NULL CHECK (reviewer_route_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  status text NOT NULL CHECK (status IN ('collecting','completed','availability_failure','invalidated')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  availability_failed_at timestamptz,
  availability_reason text CHECK (availability_reason IN ('timeout','provider_failure','empty_output','malformed_output')),
  invalidated_at timestamptz,
  invalidated_by_target_digest text CHECK (invalidated_by_target_digest ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY (organisation_id, project_id) REFERENCES projects(organisation_id, id) ON DELETE CASCADE,
  UNIQUE (organisation_id, project_id, id)
);

ALTER TABLE assurance_runs ADD CONSTRAINT assurance_run_status_shape_ck CHECK (
  (status='collecting' AND completed_at IS NULL AND availability_failed_at IS NULL
    AND availability_reason IS NULL AND invalidated_at IS NULL AND invalidated_by_target_digest IS NULL)
  OR (status='completed' AND completed_at IS NOT NULL AND availability_failed_at IS NULL
    AND availability_reason IS NULL AND invalidated_at IS NULL AND invalidated_by_target_digest IS NULL)
  OR (status='availability_failure' AND completed_at IS NULL AND availability_failed_at IS NOT NULL
    AND availability_reason IS NOT NULL AND invalidated_at IS NULL AND invalidated_by_target_digest IS NULL)
  OR (status='invalidated' AND invalidated_at IS NOT NULL AND invalidated_by_target_digest IS NOT NULL)
);

CREATE INDEX assurance_runs_project_profile_latest_idx
  ON assurance_runs (organisation_id, project_id, profile_id, created_at DESC, id DESC);

CREATE TABLE assurance_findings (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  assurance_run_id text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','important','minor','observation')),
  kind text NOT NULL CHECK (kind IN (
    'missing_requirement','ambiguity','contradiction','edge_case','failure_mode',
    'non_functional_gap','security_risk','operational_gap','unresolved_assumption',
    'research_required','recommendation'
  )),
  category text NOT NULL CHECK (category ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 16384),
  rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 16384),
  proposed_question text CHECK (proposed_question IS NULL OR length(trim(proposed_question)) BETWEEN 1 AND 16384),
  suggested_direction text CHECK (suggested_direction IS NULL OR length(trim(suggested_direction)) BETWEEN 1 AND 16384),
  basis text NOT NULL CHECK (basis IN ('project_evidence','trained_knowledge','external_research')),
  evidence_references text[] NOT NULL DEFAULT '{}' CHECK (cardinality(evidence_references) <= 64),
  status text NOT NULL CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text CHECK (resolution_note IS NULL OR length(trim(resolution_note)) BETWEEN 1 AND 16384),
  FOREIGN KEY (organisation_id, project_id, assurance_run_id)
    REFERENCES assurance_runs(organisation_id, project_id, id) ON DELETE CASCADE,
  CHECK (
    (status='open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL)
    OR (status IN ('resolved','dismissed') AND resolved_at IS NOT NULL
        AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
  )
);

CREATE INDEX assurance_findings_run_status_idx
  ON assurance_findings (organisation_id, project_id, assurance_run_id, status, severity, created_at, id);
