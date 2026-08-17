CREATE TABLE review_runs (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  source_digest char(64) NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest char(64) NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  packet_digest char(64) NOT NULL CHECK (packet_digest ~ '^[a-f0-9]{64}$'),
  source_material text NOT NULL CHECK (octet_length(source_material) BETWEEN 1 AND 33554432),
  evidence_material text NOT NULL CHECK (octet_length(evidence_material) BETWEEN 1 AND 33554432),
  invariant_ids text[] NOT NULL CHECK (cardinality(invariant_ids) BETWEEN 1 AND 64),
  status text NOT NULL CHECK (status IN ('collecting','adjudicating','blocked','accepted','invalidated')),
  collection_claim_token text CHECK (
    collection_claim_token IS NULL OR collection_claim_token ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  collection_claim_expires_at timestamptz,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  invalidated_by_source_digest char(64) CHECK (
    invalidated_by_source_digest IS NULL OR invalidated_by_source_digest ~ '^[a-f0-9]{64}$'
  ),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, id, packet_digest),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE RESTRICT,
  CONSTRAINT review_runs_collection_claim_ck CHECK (
    (status = 'collecting' AND ((collection_claim_token IS NULL AND collection_claim_expires_at IS NULL)
      OR (collection_claim_token IS NOT NULL AND collection_claim_expires_at IS NOT NULL)))
    OR (status <> 'collecting' AND collection_claim_token IS NULL AND collection_claim_expires_at IS NULL)
  ),
  CONSTRAINT review_runs_invalidation_ck CHECK (
    (status = 'invalidated' AND invalidated_at IS NOT NULL
      AND invalidated_by_source_digest IS NOT NULL
      AND invalidated_by_source_digest <> source_digest)
    OR (status <> 'invalidated' AND invalidated_at IS NULL AND invalidated_by_source_digest IS NULL)
  )
);

CREATE INDEX review_runs_project_idx
  ON review_runs (organisation_id, project_id, created_at DESC);
CREATE TABLE review_reviewer_assignments (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  review_run_id text NOT NULL,
  role text NOT NULL CHECK (role ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  route_id text NOT NULL CHECK (route_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  model_id text NOT NULL CHECK (model_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  model_version text NOT NULL CHECK (length(trim(model_version)) BETWEEN 1 AND 256),
  packet_digest char(64) NOT NULL CHECK (packet_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'assigned' CHECK (
    status IN ('assigned','completed','availability_failure')
  ),
  availability_reason text CHECK (
    availability_reason IS NULL OR availability_reason IN ('empty_output','timeout','malformed_output')
  ),
  content_digest char(64) CHECK (content_digest IS NULL OR content_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  UNIQUE (organisation_id, review_run_id, id),
  FOREIGN KEY (organisation_id, review_run_id, packet_digest)
    REFERENCES review_runs(organisation_id, id, packet_digest) ON DELETE RESTRICT,
  CONSTRAINT review_assignment_state_ck CHECK (
    (status = 'assigned' AND availability_reason IS NULL AND content_digest IS NULL AND resolved_at IS NULL)
    OR (status = 'completed' AND availability_reason IS NULL AND content_digest IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status = 'availability_failure' AND availability_reason IS NOT NULL AND content_digest IS NULL AND resolved_at IS NOT NULL)
  )
);
CREATE TABLE review_findings (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  review_run_id text NOT NULL,
  reviewer_assignment_id text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','important','minor','observation')),
  category text NOT NULL CHECK (category ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 16384),
  evidence_references text[] NOT NULL CHECK (cardinality(evidence_references) <= 64),
  created_at timestamptz NOT NULL,
  UNIQUE (organisation_id, review_run_id, id),
  UNIQUE (organisation_id, review_run_id, id, reviewer_assignment_id),
  FOREIGN KEY (organisation_id, review_run_id, reviewer_assignment_id)
    REFERENCES review_reviewer_assignments(organisation_id, review_run_id, id) ON DELETE RESTRICT
);

CREATE TABLE review_finding_adjudications (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  review_run_id text NOT NULL,
  finding_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('CONFIRMED','PARTIALLY_VALID','REJECTED','INSUFFICIENT_EVIDENCE')
  ),
  rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 16384),
  evidence_references text[] NOT NULL CHECK (cardinality(evidence_references) BETWEEN 1 AND 64),
  adjudicated_by text NOT NULL CHECK (length(trim(adjudicated_by)) > 0),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, review_run_id, finding_id)
    REFERENCES review_findings(organisation_id, review_run_id, id) ON DELETE RESTRICT
);
CREATE TABLE review_rechallenges (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  review_run_id text NOT NULL,
  finding_id text NOT NULL,
  reviewer_assignment_id text NOT NULL,
  adjudication_status text NOT NULL CHECK (adjudication_status IN ('REJECTED','PARTIALLY_VALID')),
  prompt_digest char(64) NOT NULL CHECK (prompt_digest ~ '^[a-f0-9]{64}$'),
  visibility text NOT NULL DEFAULT 'private_original_reviewer'
    CHECK (visibility = 'private_original_reviewer'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, review_run_id, finding_id, reviewer_assignment_id)
    REFERENCES review_findings(organisation_id, review_run_id, id, reviewer_assignment_id)
    ON DELETE RESTRICT
);

CREATE TABLE review_calibration_snapshots (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  route_id text NOT NULL CHECK (route_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  model_id text NOT NULL CHECK (model_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  model_version text NOT NULL CHECK (length(trim(model_version)) BETWEEN 1 AND 256),
  sample_size integer NOT NULL CHECK (sample_size > 0),
  useful_finding_rate double precision NOT NULL CHECK (useful_finding_rate BETWEEN 0 AND 1),
  false_positive_rate double precision NOT NULL CHECK (false_positive_rate BETWEEN 0 AND 1),
  availability_rate double precision NOT NULL CHECK (availability_rate BETWEEN 0 AND 1),
  median_latency_ms double precision NOT NULL CHECK (median_latency_ms >= 0),
  average_cost_usd double precision NOT NULL CHECK (average_cost_usd >= 0),
  created_at timestamptz NOT NULL
);
CREATE INDEX review_calibration_route_idx
  ON review_calibration_snapshots (organisation_id, route_id, created_at DESC);

CREATE TABLE review_architecture_invariants (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 16384),
  severity text NOT NULL CHECK (severity IN ('critical','important')),
  created_at timestamptz NOT NULL
);

CREATE FUNCTION enforce_collaborative_memory_reviewer_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_project_id uuid;
BEGIN
  IF NEW.reviewer_assignment_id IS NULL THEN RETURN NEW; END IF;
  SELECT rr.project_id INTO assignment_project_id
  FROM review_reviewer_assignments ra
  JOIN review_runs rr ON rr.organisation_id = ra.organisation_id AND rr.id = ra.review_run_id
  WHERE ra.organisation_id = NEW.organisation_id AND ra.id = NEW.reviewer_assignment_id;
  IF assignment_project_id IS NULL OR assignment_project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'reviewer-private memory requires a same-project durable reviewer assignment';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER collaborative_memory_reviewer_assignment_scope
BEFORE INSERT OR UPDATE ON collaborative_memories
FOR EACH ROW EXECUTE FUNCTION enforce_collaborative_memory_reviewer_assignment();

CREATE FUNCTION prevent_review_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review evidence is append-only';
END;
$$;

CREATE TRIGGER review_findings_append_only
BEFORE UPDATE OR DELETE ON review_findings
FOR EACH ROW EXECUTE FUNCTION prevent_review_append_only_mutation();
CREATE TRIGGER review_adjudications_append_only
BEFORE UPDATE OR DELETE ON review_finding_adjudications
FOR EACH ROW EXECUTE FUNCTION prevent_review_append_only_mutation();
CREATE TRIGGER review_rechallenges_append_only
BEFORE UPDATE OR DELETE ON review_rechallenges
FOR EACH ROW EXECUTE FUNCTION prevent_review_append_only_mutation();
CREATE TRIGGER review_calibration_append_only
BEFORE UPDATE OR DELETE ON review_calibration_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_review_append_only_mutation();
CREATE TRIGGER review_invariants_append_only
BEFORE UPDATE OR DELETE ON review_architecture_invariants
FOR EACH ROW EXECUTE FUNCTION prevent_review_append_only_mutation();
CREATE FUNCTION enforce_review_assignment_collecting_run()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_status text;
BEGIN
  SELECT status INTO run_status
  FROM review_runs
  WHERE organisation_id = NEW.organisation_id AND id = NEW.review_run_id
  FOR SHARE;
  IF run_status IS DISTINCT FROM 'collecting' THEN
    RAISE EXCEPTION 'reviewer assignment requires a collecting review run';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER review_assignment_collecting_run
BEFORE INSERT ON review_reviewer_assignments
FOR EACH ROW EXECUTE FUNCTION enforce_review_assignment_collecting_run();

CREATE FUNCTION prevent_review_run_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id, OLD.organisation_id, OLD.project_id, OLD.source_digest,
         OLD.evidence_digest, OLD.packet_digest, OLD.source_material, OLD.evidence_material,
         OLD.invariant_ids, OLD.created_by, OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.id, NEW.organisation_id, NEW.project_id, NEW.source_digest,
         NEW.evidence_digest, NEW.packet_digest, NEW.source_material, NEW.evidence_material,
         NEW.invariant_ids, NEW.created_by, NEW.created_at) THEN
    RAISE EXCEPTION 'review run identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER review_run_identity_immutable
BEFORE UPDATE ON review_runs
FOR EACH ROW EXECUTE FUNCTION prevent_review_run_identity_mutation();
CREATE FUNCTION prevent_review_assignment_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id, OLD.organisation_id, OLD.review_run_id, OLD.role,
         OLD.route_id, OLD.model_id, OLD.model_version, OLD.packet_digest, OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.id, NEW.organisation_id, NEW.review_run_id, NEW.role,
         NEW.route_id, NEW.model_id, NEW.model_version, NEW.packet_digest, NEW.created_at) THEN
    RAISE EXCEPTION 'reviewer assignment identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER review_assignment_identity_immutable
BEFORE UPDATE ON review_reviewer_assignments
FOR EACH ROW EXECUTE FUNCTION prevent_review_assignment_identity_mutation();
