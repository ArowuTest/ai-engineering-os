-- Task 9: encrypted-at-rest provider credentials for managed BYOC onboarding.
-- Plaintext keys remain outside PostgreSQL; rows are connection/tenant bound.
CREATE TABLE ai_connection_secrets (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  connection_id uuid NOT NULL,
  key_version text NOT NULL CHECK (length(trim(key_version)) BETWEEN 1 AND 64),
  algorithm text NOT NULL CHECK (algorithm = 'aes-256-gcm'),
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (organisation_id, connection_id)
    REFERENCES ai_connections(organisation_id, id) ON DELETE CASCADE,
  UNIQUE (organisation_id, connection_id, id),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX ai_connection_secrets_active_idx
  ON ai_connection_secrets (organisation_id, connection_id, id)
  WHERE revoked_at IS NULL;