-- Task 8 post-council hardening: bounded metadata, explicit executor failures,
-- and tenant-scoped public identities without rewriting migrations 009/010.

ALTER TABLE review_reviewer_assignments
  DROP CONSTRAINT review_reviewer_assignments_availability_reason_check;
ALTER TABLE review_reviewer_assignments
  ADD CONSTRAINT review_reviewer_assignments_availability_reason_check CHECK (
    availability_reason IS NULL OR availability_reason IN (
      'empty_output','timeout','executor_failure','malformed_output'
    )
  );

ALTER TABLE collaborative_memories
  ADD CONSTRAINT collaborative_memories_target_agent_ids_bound_ck CHECK (cardinality(target_agent_ids) <= 64),
  ADD CONSTRAINT collaborative_memories_target_session_ids_bound_ck CHECK (cardinality(target_session_ids) <= 64),
  ADD CONSTRAINT collaborative_memories_target_harness_ids_bound_ck CHECK (cardinality(target_harness_ids) <= 64);

ALTER TABLE agent_handoffs
  ADD CONSTRAINT agent_handoffs_target_session_ids_bound_ck CHECK (cardinality(target_session_ids) <= 64),
  ADD CONSTRAINT agent_handoffs_target_agent_ids_bound_ck CHECK (cardinality(target_agent_ids) <= 64),
  ADD CONSTRAINT agent_handoffs_evidence_references_bound_ck CHECK (cardinality(evidence_references) <= 64),
  ADD CONSTRAINT agent_handoffs_blockers_bound_ck CHECK (cardinality(blockers) <= 64);

ALTER TABLE engineering_sessions ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE engineering_sessions DROP CONSTRAINT engineering_sessions_pkey;
ALTER TABLE engineering_sessions ADD CONSTRAINT engineering_sessions_pkey PRIMARY KEY (row_key);

ALTER TABLE collaborative_memories ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE collaborative_memories DROP CONSTRAINT collaborative_memories_pkey;
ALTER TABLE collaborative_memories ADD CONSTRAINT collaborative_memories_pkey PRIMARY KEY (row_key);

ALTER TABLE agent_handoffs ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE agent_handoffs DROP CONSTRAINT agent_handoffs_pkey;
ALTER TABLE agent_handoffs ADD CONSTRAINT agent_handoffs_pkey PRIMARY KEY (row_key);

ALTER TABLE review_runs ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE review_runs DROP CONSTRAINT review_runs_pkey;
ALTER TABLE review_runs ADD CONSTRAINT review_runs_pkey PRIMARY KEY (row_key);

ALTER TABLE review_reviewer_assignments ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE review_reviewer_assignments DROP CONSTRAINT review_reviewer_assignments_pkey;
ALTER TABLE review_reviewer_assignments ADD CONSTRAINT review_reviewer_assignments_pkey PRIMARY KEY (row_key);

ALTER TABLE review_findings ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE review_findings DROP CONSTRAINT review_findings_pkey;
ALTER TABLE review_findings ADD CONSTRAINT review_findings_pkey PRIMARY KEY (row_key);

ALTER TABLE review_finding_adjudications ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE review_finding_adjudications DROP CONSTRAINT review_finding_adjudications_pkey;
ALTER TABLE review_finding_adjudications ADD CONSTRAINT review_finding_adjudications_pkey PRIMARY KEY (row_key);

ALTER TABLE review_rechallenges ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE review_rechallenges DROP CONSTRAINT review_rechallenges_pkey;
ALTER TABLE review_rechallenges ADD CONSTRAINT review_rechallenges_pkey PRIMARY KEY (row_key);

ALTER TABLE review_calibration_snapshots ADD COLUMN row_key bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE review_calibration_snapshots DROP CONSTRAINT review_calibration_snapshots_pkey;
ALTER TABLE review_calibration_snapshots ADD CONSTRAINT review_calibration_snapshots_pkey PRIMARY KEY (row_key);

ALTER TABLE agent_handoffs
  ADD CONSTRAINT agent_handoffs_scoped_public_id_key UNIQUE (organisation_id, project_id, id);
ALTER TABLE review_reviewer_assignments
  ADD CONSTRAINT review_reviewer_assignments_org_public_id_key UNIQUE (organisation_id, id);
ALTER TABLE review_finding_adjudications
  ADD CONSTRAINT review_finding_adjudications_scoped_public_id_key UNIQUE (organisation_id, review_run_id, id);
ALTER TABLE review_rechallenges
  ADD CONSTRAINT review_rechallenges_scoped_public_id_key UNIQUE (organisation_id, review_run_id, id);
ALTER TABLE review_calibration_snapshots
  ADD CONSTRAINT review_calibration_snapshots_org_public_id_key UNIQUE (organisation_id, id);

CREATE UNIQUE INDEX collaborative_memories_organisation_public_id_key
  ON collaborative_memories (organisation_id, id)
  WHERE organisation_id IS NOT NULL AND project_id IS NULL AND scope = 'organisation';

CREATE UNIQUE INDEX collaborative_memories_user_public_id_key
  ON collaborative_memories (owner_user_id, id)
  WHERE owner_user_id IS NOT NULL AND scope = 'user';
