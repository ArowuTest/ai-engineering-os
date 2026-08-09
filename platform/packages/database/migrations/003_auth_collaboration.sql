ALTER TABLE organisations
  ADD COLUMN invitation_ttl_minutes integer NOT NULL DEFAULT 30
    CHECK (invitation_ttl_minutes > 0);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  user_id text NOT NULL UNIQUE
    CHECK (user_id = lower(user_id) AND user_id ~ '^[a-z0-9._-]{3,64}$'),
  password_hash text NOT NULL CHECK (length(password_hash) > 0),
  status text NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE organisation_memberships (
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organisation_id, user_id)
);

CREATE TABLE project_memberships (
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('product_owner', 'contributor', 'engineer', 'reviewer', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organisation_id, project_id, user_id),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, user_id)
    REFERENCES organisation_memberships(organisation_id, user_id) ON DELETE CASCADE
);

CREATE INDEX project_memberships_user_idx
  ON project_memberships (user_id, organisation_id, status);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  organisation_role text NOT NULL CHECK (organisation_role IN ('owner', 'admin', 'member')),
  status text NOT NULL CHECK (status IN ('pending', 'consumed', 'expired', 'revoked', 'replaced')),
  issued_by text NOT NULL CHECK (length(trim(issued_by)) > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  consumed_at timestamptz,
  consumed_by_user_id uuid,
  supersedes_invitation_id uuid REFERENCES invitations(id) ON DELETE SET NULL,
  UNIQUE (organisation_id, id)
);

CREATE INDEX invitations_lookup_idx
  ON invitations (token_hash, status, expires_at);

CREATE TABLE invitation_project_grants (
  invitation_id uuid NOT NULL,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('product_owner', 'contributor', 'engineer', 'reviewer', 'viewer')),
  PRIMARY KEY (invitation_id, project_id),
  FOREIGN KEY (organisation_id, invitation_id)
    REFERENCES invitations(organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz
);

CREATE INDEX auth_sessions_active_lookup_idx
  ON auth_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;
