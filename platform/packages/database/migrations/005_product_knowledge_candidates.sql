ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_scope_id_unique
  UNIQUE (organisation_id, project_id, conversation_id, id);

CREATE TABLE knowledge_extraction_runs (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  source_user_message_id uuid NOT NULL,
  source_assistant_message_id uuid NOT NULL,
  provider text NOT NULL
    CHECK (
      provider <> 'auto'
      AND provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
  model text NOT NULL CHECK (length(trim(model)) > 0),
  route_id text NOT NULL
    CHECK (route_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  response_contract_version text NOT NULL
    CHECK (response_contract_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  status text NOT NULL CHECK (status IN ('received', 'succeeded', 'failed')),
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (organisation_id, project_id, id),
  FOREIGN KEY (organisation_id, project_id, conversation_id)
    REFERENCES conversations(organisation_id, project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (
    organisation_id, project_id, conversation_id, source_user_message_id
  ) REFERENCES conversation_messages(
    organisation_id, project_id, conversation_id, id
  ) ON DELETE CASCADE,
  FOREIGN KEY (
    organisation_id, project_id, conversation_id, source_assistant_message_id
  ) REFERENCES conversation_messages(
    organisation_id, project_id, conversation_id, id
  ) ON DELETE CASCADE,
  CHECK (
    (status = 'received' AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (
      status = 'failed'
      AND completed_at IS NOT NULL
      AND failure_code IS NOT NULL
      AND length(trim(failure_code)) > 0
    )
  )
);

CREATE INDEX knowledge_extraction_runs_project_status_idx
  ON knowledge_extraction_runs (organisation_id, project_id, status, created_at DESC);

CREATE FUNCTION enforce_knowledge_extraction_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.source_user_message_id IS DISTINCT FROM OLD.source_user_message_id
    OR NEW.source_assistant_message_id IS DISTINCT FROM OLD.source_assistant_message_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.model IS DISTINCT FROM OLD.model
    OR NEW.route_id IS DISTINCT FROM OLD.route_id
    OR NEW.response_contract_version IS DISTINCT FROM OLD.response_contract_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'extraction run source evidence is immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'received' OR NEW.status NOT IN ('succeeded', 'failed') THEN
      RAISE EXCEPTION 'extraction run is not received';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_extraction_runs_transition_guard
BEFORE UPDATE ON knowledge_extraction_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_knowledge_extraction_run_transition();

CREATE TABLE knowledge_candidates (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  extraction_run_id uuid NOT NULL,
  category text NOT NULL CHECK (length(trim(category)) > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  original_content text NOT NULL CHECK (length(trim(original_content)) > 0),
  basis text NOT NULL
    CHECK (basis IN ('user_stated', 'assistant_inferred', 'assistant_recommended')),
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  reviewer_id text,
  reviewed_at timestamptz,
  accepted_knowledge_id uuid,
  rejection_reason text,
  created_at timestamptz NOT NULL,
  UNIQUE (organisation_id, project_id, id),
  FOREIGN KEY (organisation_id, project_id, extraction_run_id)
    REFERENCES knowledge_extraction_runs(organisation_id, project_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'pending'
      AND reviewer_id IS NULL
      AND reviewed_at IS NULL
      AND accepted_knowledge_id IS NULL
      AND rejection_reason IS NULL)
    OR (status = 'accepted'
      AND reviewer_id IS NOT NULL
      AND length(trim(reviewer_id)) > 0
      AND reviewed_at IS NOT NULL
      AND accepted_knowledge_id IS NOT NULL
      AND rejection_reason IS NULL)
    OR (status = 'rejected'
      AND reviewer_id IS NOT NULL
      AND length(trim(reviewer_id)) > 0
      AND reviewed_at IS NOT NULL
      AND accepted_knowledge_id IS NULL)
  )
);

CREATE INDEX knowledge_candidates_project_status_idx
  ON knowledge_candidates (organisation_id, project_id, status, created_at DESC);

CREATE UNIQUE INDEX knowledge_candidates_pending_fingerprint_unique
  ON knowledge_candidates (organisation_id, project_id, category, fingerprint)
  WHERE status = 'pending';

CREATE FUNCTION enforce_knowledge_candidate_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.extraction_run_id IS DISTINCT FROM OLD.extraction_run_id
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.original_content IS DISTINCT FROM OLD.original_content
    OR NEW.basis IS DISTINCT FROM OLD.basis
    OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'candidate source evidence is immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected') THEN
      RAISE EXCEPTION 'candidate is not pending';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_candidates_transition_guard
BEFORE UPDATE ON knowledge_candidates
FOR EACH ROW
EXECUTE FUNCTION enforce_knowledge_candidate_transition();
