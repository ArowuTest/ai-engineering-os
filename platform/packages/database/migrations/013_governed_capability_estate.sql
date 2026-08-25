-- Task 9: governed capability catalogue, Admin release policy and agent metadata.
-- Catalogue presence, release and execution authority remain separate states.

CREATE TABLE capability_catalogue (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  kind text NOT NULL CHECK (kind IN ('model_route','harness','agent','skill','mcp_tool','workflow')),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  source_ref text NOT NULL CHECK (length(trim(source_ref)) BETWEEN 1 AND 2048),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 256),
  maturity text NOT NULL CHECK (maturity IN ('discovered','experimental','supported','deprecated')),
  governance_state text NOT NULL CHECK (governance_state IN ('discovered','trial_calibration','approved','disabled')),
  execution_verification text NOT NULL CHECK (execution_verification IN ('unverified','trial','verified')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX capability_catalogue_kind_governance_idx
  ON capability_catalogue (kind, governance_state, execution_verification, id);

CREATE TABLE capability_release_policies (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  capability_id text NOT NULL REFERENCES capability_catalogue(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('platform','organisation','project','project_role','team','cohort','user')),
  organisation_id text REFERENCES organisations(id) ON DELETE CASCADE,
  project_id uuid,
  project_role text,
  team_id text,
  cohort_id text,
  user_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, user_id)
    REFERENCES organisation_memberships(organisation_id, user_id) ON DELETE CASCADE
);
ALTER TABLE capability_release_policies
  ADD CONSTRAINT capability_release_scope_shape_ck CHECK (
    (scope='platform' AND organisation_id IS NULL AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='organisation' AND organisation_id IS NOT NULL AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='project' AND organisation_id IS NOT NULL AND project_id IS NOT NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='project_role' AND organisation_id IS NOT NULL AND project_role IS NOT NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='team' AND organisation_id IS NOT NULL AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NOT NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='cohort' AND organisation_id IS NOT NULL AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NOT NULL AND user_id IS NULL)
    OR (scope='user' AND organisation_id IS NOT NULL AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NOT NULL)
  ),
  ADD CONSTRAINT capability_release_revocation_ck CHECK (
    (status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)
  );

CREATE INDEX capability_release_active_lookup_idx
  ON capability_release_policies (capability_id, scope, organisation_id, project_id, status)
  WHERE status='active';

CREATE TABLE capability_agents (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  capability_id text NOT NULL UNIQUE REFERENCES capability_catalogue(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 256),
  specialist_role text NOT NULL CHECK (specialist_role ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2048),
  status text NOT NULL CHECK (status IN ('active','disabled')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX capability_agents_role_status_idx
  ON capability_agents (specialist_role, status, id);
CREATE TABLE capability_eligibility_policies (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  capability_id text NOT NULL REFERENCES capability_catalogue(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('organisation','project','project_role','team','cohort','user')),
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id uuid,
  project_role text,
  team_id text,
  cohort_id text,
  user_id uuid,
  decision text NOT NULL CHECK (decision IN ('allow','deny')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, user_id)
    REFERENCES organisation_memberships(organisation_id, user_id) ON DELETE CASCADE
);
ALTER TABLE capability_eligibility_policies
  ADD CONSTRAINT capability_eligibility_scope_shape_ck CHECK (
    (scope='organisation' AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='project' AND project_id IS NOT NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='project_role' AND project_role IS NOT NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='team' AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NOT NULL AND cohort_id IS NULL AND user_id IS NULL)
    OR (scope='cohort' AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NOT NULL AND user_id IS NULL)
    OR (scope='user' AND project_id IS NULL AND project_role IS NULL
      AND team_id IS NULL AND cohort_id IS NULL AND user_id IS NOT NULL)
  ),
  ADD CONSTRAINT capability_eligibility_revocation_ck CHECK (
    (status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)
  );

CREATE INDEX capability_eligibility_active_lookup_idx
  ON capability_eligibility_policies
    (capability_id, organisation_id, scope, project_id, decision, status)
  WHERE status='active';
-- Platform administration is orthogonal to tenant membership. A platform
-- administrator may curate the global capability catalogue without being
-- granted authority inside any organisation.
CREATE TABLE platform_memberships (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role = 'admin'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (
    (status='active' AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL)
  )
);

-- Existing organisation/project audit rows remain unchanged. NULL organisation
-- identifies platform-scoped audit without inventing a tenant or a second log.
ALTER TABLE audit_events ALTER COLUMN organisation_id DROP NOT NULL;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_event_scope_shape_ck
  CHECK (project_id IS NULL OR organisation_id IS NOT NULL);
CREATE INDEX audit_events_platform_sequence_idx
  ON audit_events (sequence)
  WHERE organisation_id IS NULL AND project_id IS NULL;
-- Team/cohort release scopes are capability-policy audiences, not a second
-- collaboration system. Membership is organisation-scoped and revocable.
CREATE TABLE capability_population_memberships (
  organisation_id text NOT NULL,
  population_kind text NOT NULL CHECK (population_kind IN ('team','cohort')),
  population_id text NOT NULL CHECK (population_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (organisation_id, population_kind, population_id, user_id),
  FOREIGN KEY (organisation_id, user_id)
    REFERENCES organisation_memberships(organisation_id, user_id) ON DELETE CASCADE,
  CHECK (
    (status='active' AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX capability_population_memberships_user_active_idx
  ON capability_population_memberships
    (organisation_id, user_id, population_kind, population_id)
  WHERE status='active';
