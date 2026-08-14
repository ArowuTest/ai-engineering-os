CREATE TABLE ai_runners (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  ownership text NOT NULL CHECK (ownership IN ('personal', 'organisation')),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  harness_id text NOT NULL CHECK (length(trim(harness_id)) > 0),
  status text NOT NULL CHECK (
    status IN ('registered', 'online', 'offline', 'disabled', 'revoked')
  ),
  trust_state text NOT NULL CHECK (
    trust_state IN ('pending', 'trusted', 'restricted', 'revoked')
  ),
  persistent_supported boolean NOT NULL,
  capabilities text[] NOT NULL CHECK (cardinality(capabilities) > 0),
  last_seen_at timestamptz,
  heartbeat_expires_at timestamptz,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT ai_runners_ownership_owner_ck CHECK (
    (ownership = 'personal' AND owner_user_id IS NOT NULL)
    OR (ownership = 'organisation' AND owner_user_id IS NULL)
  ),
  CONSTRAINT ai_runners_heartbeat_ck CHECK (
    heartbeat_expires_at IS NULL
    OR (last_seen_at IS NOT NULL AND heartbeat_expires_at > last_seen_at)
  ),
  CONSTRAINT ai_runners_last_seen_chronology_ck CHECK (
    last_seen_at IS NULL OR last_seen_at >= created_at
  ),
  CONSTRAINT ai_runners_status_revocation_ck CHECK (
    (status = 'revoked') = (revoked_at IS NOT NULL)
  ),
  CONSTRAINT ai_runners_revoked_chronology_ck CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  CONSTRAINT ai_runners_updated_chronology_ck CHECK (updated_at >= created_at),
  UNIQUE (organisation_id, id)
);

CREATE INDEX ai_runners_personal_owner_idx
  ON ai_runners (organisation_id, owner_user_id)
  WHERE ownership = 'personal' AND revoked_at IS NULL;

CREATE INDEX ai_runners_organisation_active_idx
  ON ai_runners (organisation_id)
  WHERE ownership = 'organisation' AND revoked_at IS NULL;

CREATE INDEX ai_runners_heartbeat_idx
  ON ai_runners (organisation_id, heartbeat_expires_at)
  WHERE revoked_at IS NULL AND status = 'online';

CREATE UNIQUE INDEX ai_connections_organisation_id_id_unique_idx
  ON ai_connections (organisation_id, id);

CREATE TABLE ai_runner_connection_bindings (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  runner_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT ai_runner_bindings_revoked_chronology_ck CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  FOREIGN KEY (organisation_id, runner_id)
    REFERENCES ai_runners (organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, connection_id)
    REFERENCES ai_connections (organisation_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ai_runner_connection_bindings_active_unique_idx
  ON ai_runner_connection_bindings (organisation_id, runner_id, connection_id)
  WHERE revoked_at IS NULL;

CREATE INDEX ai_runner_connection_bindings_connection_active_idx
  ON ai_runner_connection_bindings (organisation_id, connection_id)
  WHERE revoked_at IS NULL;

CREATE INDEX ai_runner_connection_bindings_runner_idx
  ON ai_runner_connection_bindings (organisation_id, runner_id);

CREATE TABLE ai_runner_credentials (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  runner_id uuid NOT NULL,
  credential_hash text NOT NULL UNIQUE CHECK (
    credential_hash ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT ai_runner_credentials_expiry_ck CHECK (
    expires_at IS NULL OR expires_at > created_at
  ),
  CONSTRAINT ai_runner_credentials_revoked_chronology_ck CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  FOREIGN KEY (organisation_id, runner_id)
    REFERENCES ai_runners (organisation_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ai_runner_credentials_active_runner_unique_idx
  ON ai_runner_credentials (organisation_id, runner_id)
  WHERE revoked_at IS NULL;

CREATE INDEX ai_runner_credentials_runner_idx
  ON ai_runner_credentials (organisation_id, runner_id);
