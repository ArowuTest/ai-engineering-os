CREATE TABLE ai_dispatches (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  task_id text NOT NULL CHECK (task_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  requester_user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  runner_id uuid NOT NULL,
  route_id text NOT NULL CHECK (route_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  harness_id text NOT NULL CHECK (harness_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  state text NOT NULL CHECK (
    state IN ('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled', 'expired')
  ),
  attempt integer NOT NULL CHECK (attempt > 0),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  task_envelope_id text NOT NULL CHECK (task_envelope_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  workspace_scope text NOT NULL CHECK (length(trim(workspace_scope)) BETWEEN 1 AND 4096),
  allowed_operations text[] NOT NULL CHECK (cardinality(allowed_operations) > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  nonce text NOT NULL CHECK (nonce ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  objective text NOT NULL CHECK (length(trim(objective)) BETWEEN 1 AND 16384),
  context_references text[] NOT NULL,
  required_capabilities text[] NOT NULL CHECK (cardinality(required_capabilities) > 0),
  payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  signature_algorithm text NOT NULL CHECK (signature_algorithm = 'ed25519'),
  signature text NOT NULL CHECK (
    length(signature) = 86 AND signature ~ '^[A-Za-z0-9_-]{86}$'
  ),
  signed_envelope jsonb NOT NULL CHECK (
    jsonb_typeof(signed_envelope) = 'object'
    AND octet_length(signed_envelope::text) <= 65536
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  claimed_at timestamptz,
  started_at timestamptz,
  succeeded_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  CONSTRAINT ai_dispatches_expiry_ck CHECK (
    issued_at <= created_at AND expires_at > created_at
  ),
  CONSTRAINT ai_dispatches_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT ai_dispatches_claimed_ck CHECK (
    claimed_at IS NULL OR claimed_at >= created_at
  ),
  CONSTRAINT ai_dispatches_started_ck CHECK (
    started_at IS NULL OR (claimed_at IS NOT NULL AND started_at >= claimed_at)
  ),
  CONSTRAINT ai_dispatches_terminal_time_ck CHECK (
    (succeeded_at IS NULL OR succeeded_at >= COALESCE(started_at, claimed_at, created_at))
    AND (failed_at IS NULL OR failed_at >= COALESCE(started_at, claimed_at, created_at))
    AND (cancelled_at IS NULL OR cancelled_at >= created_at)
    AND (expired_at IS NULL OR expired_at >= created_at)
  ),
  CONSTRAINT ai_dispatches_state_timestamps_ck CHECK (
    (state = 'queued' AND claimed_at IS NULL AND started_at IS NULL
      AND succeeded_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (state = 'claimed' AND claimed_at IS NOT NULL AND started_at IS NULL
      AND succeeded_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (state = 'running' AND claimed_at IS NOT NULL AND started_at IS NOT NULL
      AND succeeded_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (state = 'succeeded' AND claimed_at IS NOT NULL AND started_at IS NOT NULL
      AND succeeded_at IS NOT NULL AND failed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (state = 'failed' AND claimed_at IS NOT NULL AND started_at IS NOT NULL
      AND failed_at IS NOT NULL AND succeeded_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (state = 'cancelled' AND cancelled_at IS NOT NULL
      AND succeeded_at IS NULL AND failed_at IS NULL AND expired_at IS NULL)
    OR (state = 'expired' AND expired_at IS NOT NULL
      AND succeeded_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL)
  ),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects (organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, requester_user_id)
    REFERENCES organisation_memberships (organisation_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, runner_id)
    REFERENCES ai_runners (organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, connection_id)
    REFERENCES ai_connections (organisation_id, id) ON DELETE RESTRICT,
  UNIQUE (organisation_id, id, attempt),
  UNIQUE (organisation_id, idempotency_key, attempt)
);

CREATE INDEX ai_dispatches_runner_queue_idx
  ON ai_dispatches (organisation_id, runner_id, created_at, id)
  WHERE state = 'queued';

CREATE UNIQUE INDEX ai_dispatches_runner_active_unique_idx
  ON ai_dispatches (organisation_id, runner_id)
  WHERE state IN ('claimed', 'running');

CREATE INDEX ai_dispatches_project_idx
  ON ai_dispatches (organisation_id, project_id, created_at DESC);

CREATE TABLE ai_dispatch_checkpoints (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  dispatch_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  kind text NOT NULL CHECK (length(trim(kind)) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384
  ),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, dispatch_id, attempt)
    REFERENCES ai_dispatches (organisation_id, id, attempt) ON DELETE RESTRICT,
  UNIQUE (organisation_id, dispatch_id, attempt, ordinal)
);

CREATE INDEX ai_dispatch_checkpoints_dispatch_idx
  ON ai_dispatch_checkpoints (organisation_id, dispatch_id, attempt, ordinal);

CREATE TABLE ai_dispatch_execution_evidence (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  dispatch_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384
  ),
  artifact_references text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (
    cardinality(artifact_references) <= 64
  ),
  session_reference text CHECK (
    session_reference IS NULL OR length(session_reference) BETWEEN 1 AND 1024
  ),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, dispatch_id, attempt)
    REFERENCES ai_dispatches (organisation_id, id, attempt) ON DELETE RESTRICT,
  UNIQUE (organisation_id, dispatch_id, attempt)
);

CREATE INDEX ai_dispatch_execution_evidence_dispatch_idx
  ON ai_dispatch_execution_evidence (organisation_id, dispatch_id, attempt);

CREATE FUNCTION prevent_ai_dispatch_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai dispatch evidence is append-only';
END;
$$;

CREATE TRIGGER ai_dispatch_checkpoints_append_only
BEFORE UPDATE OR DELETE ON ai_dispatch_checkpoints
FOR EACH ROW EXECUTE FUNCTION prevent_ai_dispatch_child_mutation();

CREATE TRIGGER ai_dispatch_evidence_append_only
BEFORE UPDATE OR DELETE ON ai_dispatch_execution_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_ai_dispatch_child_mutation();

CREATE FUNCTION prevent_ai_dispatch_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.id, OLD.organisation_id, OLD.project_id, OLD.task_id,
    OLD.requester_user_id, OLD.connection_id, OLD.runner_id,
    OLD.route_id, OLD.harness_id, OLD.attempt, OLD.idempotency_key,
    OLD.task_envelope_id, OLD.workspace_scope, OLD.allowed_operations,
    OLD.issued_at, OLD.expires_at, OLD.nonce, OLD.objective,
    OLD.context_references, OLD.required_capabilities, OLD.payload_digest,
    OLD.signature_algorithm, OLD.signature, OLD.signed_envelope, OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organisation_id, NEW.project_id, NEW.task_id,
    NEW.requester_user_id, NEW.connection_id, NEW.runner_id,
    NEW.route_id, NEW.harness_id, NEW.attempt, NEW.idempotency_key,
    NEW.task_envelope_id, NEW.workspace_scope, NEW.allowed_operations,
    NEW.issued_at, NEW.expires_at, NEW.nonce, NEW.objective,
    NEW.context_references, NEW.required_capabilities, NEW.payload_digest,
    NEW.signature_algorithm, NEW.signature, NEW.signed_envelope, NEW.created_at
  ) THEN
    RAISE EXCEPTION 'ai dispatch execution identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_dispatches_identity_immutable
BEFORE UPDATE ON ai_dispatches
FOR EACH ROW EXECUTE FUNCTION prevent_ai_dispatch_identity_mutation();
