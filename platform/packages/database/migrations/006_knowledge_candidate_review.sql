-- Composite unique so provenance can FK (organisation_id, project_id, knowledge_id, revision).
ALTER TABLE product_knowledge
  ADD CONSTRAINT product_knowledge_scope_revision_unique
  UNIQUE (organisation_id, project_id, id, revision);

CREATE TABLE product_knowledge_provenance (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  knowledge_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  candidate_id uuid NOT NULL,
  extraction_run_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organisation_id, project_id, knowledge_id, revision),
  FOREIGN KEY (organisation_id, project_id, knowledge_id, revision)
    REFERENCES product_knowledge (organisation_id, project_id, id, revision)
    ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, project_id, candidate_id)
    REFERENCES knowledge_candidates (organisation_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, project_id, extraction_run_id)
    REFERENCES knowledge_extraction_runs (organisation_id, project_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX product_knowledge_provenance_candidate_idx
  ON product_knowledge_provenance (organisation_id, project_id, candidate_id);

CREATE TABLE knowledge_extraction_retry_attempts (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  original_run_id uuid NOT NULL,
  retry_run_id uuid NOT NULL UNIQUE,
  requested_by text NOT NULL CHECK (length(trim(requested_by)) > 0),
  requested_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, project_id, original_run_id)
    REFERENCES knowledge_extraction_runs (organisation_id, project_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, project_id, retry_run_id)
    REFERENCES knowledge_extraction_runs (organisation_id, project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX knowledge_extraction_retry_attempts_original_idx
  ON knowledge_extraction_retry_attempts (organisation_id, project_id, original_run_id);
