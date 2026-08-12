CREATE TABLE ai_connections (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  ownership text NOT NULL CHECK (ownership IN ('personal', 'organisation')),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  provider_id text NOT NULL CHECK (length(trim(provider_id)) > 0),
  connection_family_id text NOT NULL CHECK (length(trim(connection_family_id)) > 0),
  credential_strategy text NOT NULL CHECK (
    credential_strategy IN ('runner_managed', 'environment', 'external_secret_ref', 'none')
  ),
  secret_ref_id text,
  status text NOT NULL CHECK (
    status IN ('configured', 'available', 'reauth_required', 'disabled', 'revoked')
  ),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT ai_connections_ownership_owner_ck CHECK (
    (ownership = 'personal' AND owner_user_id IS NOT NULL)
    OR (ownership = 'organisation' AND owner_user_id IS NULL)
  ),
  CONSTRAINT ai_connections_secret_ref_strategy_ck CHECK (
    (credential_strategy = 'external_secret_ref'
      AND secret_ref_id IS NOT NULL
      AND length(trim(secret_ref_id)) > 0)
    OR (credential_strategy <> 'external_secret_ref' AND secret_ref_id IS NULL)
  ),
  UNIQUE (organisation_id, id, ownership)
);

CREATE INDEX ai_connections_personal_owner_idx
  ON ai_connections (organisation_id, owner_user_id)
  WHERE ownership = 'personal' AND revoked_at IS NULL;

CREATE INDEX ai_connections_organisation_active_idx
  ON ai_connections (organisation_id)
  WHERE ownership = 'organisation' AND revoked_at IS NULL;

CREATE TABLE ai_connection_project_shares (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  connection_ownership text NOT NULL CHECK (connection_ownership = 'personal'),
  mode text NOT NULL CHECK (mode IN ('online_only', 'persistent')),
  available_from timestamptz,
  available_until timestamptz,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT ai_connection_project_shares_window_ck CHECK (
    available_until IS NULL
    OR available_from IS NULL
    OR available_until > available_from
  ),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, connection_id, connection_ownership)
    REFERENCES ai_connections (organisation_id, id, ownership) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ai_connection_project_shares_active_unique_idx
  ON ai_connection_project_shares (organisation_id, project_id, connection_id)
  WHERE revoked_at IS NULL;

CREATE INDEX ai_connection_project_shares_project_active_idx
  ON ai_connection_project_shares (organisation_id, project_id)
  WHERE revoked_at IS NULL;

CREATE INDEX ai_connection_project_shares_connection_idx
  ON ai_connection_project_shares (organisation_id, connection_id);
