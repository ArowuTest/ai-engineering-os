CREATE TABLE engineering_sessions (
  id text NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  workstream_id text CHECK (workstream_id IS NULL OR workstream_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  task_id text NOT NULL CHECK (task_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  agent_id text NOT NULL CHECK (agent_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  status text NOT NULL CHECK (status IN ('active','paused','completed','failed','cancelled')),
  harness_id text CHECK (harness_id IS NULL OR harness_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  model_route_id text CHECK (model_route_id IS NULL OR model_route_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  runner_id text CHECK (runner_id IS NULL OR runner_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  environment_id text CHECK (environment_id IS NULL OR environment_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  workspace_reference text CHECK (workspace_reference IS NULL OR length(trim(workspace_reference)) BETWEEN 1 AND 4096),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (id),
  UNIQUE (organisation_id, project_id, id),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX engineering_sessions_project_idx
  ON engineering_sessions (organisation_id, project_id, status, updated_at DESC);
CREATE TABLE collaborative_memories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text,
  project_id uuid,
  workstream_id text CHECK (workstream_id IS NULL OR workstream_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  scope text NOT NULL CHECK (scope IN ('project','workstream','agent','session','review','user','organisation')),
  visibility text NOT NULL CHECK (visibility IN (
    'session_private','workstream_shared','project_shared','organisation_shared',
    'reviewer_private','adjudication_shared','user_private'
  )),
  kind text NOT NULL CHECK (kind IN (
    'context','decision','fact','handoff','lesson','note','preference','runbook',
    'evidence','checkpoint','blocker'
  )),
  trust text NOT NULL CHECK (trust IN ('unreviewed','verified','governed','superseded','rejected')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 512),
  content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 65536),
  content_digest char(64) NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  source_type text NOT NULL CHECK (source_type IN ('human','agent','ecc_import','review_council','system')),
  source_agent_id text,
  source_session_id text,
  source_harness_id text,
  reviewer_assignment_id text,
  target_agent_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  target_session_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  target_harness_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL,  UNIQUE (organisation_id, project_id, id),
  CONSTRAINT collaborative_memories_project_scope_ck CHECK (
    scope NOT IN ('project','workstream','agent','session','review')
    OR (organisation_id IS NOT NULL AND project_id IS NOT NULL)
  ),
  CONSTRAINT collaborative_memories_user_scope_ck CHECK (
    scope <> 'user' OR (
      visibility = 'user_private' AND owner_user_id IS NOT NULL
      AND organisation_id IS NULL AND project_id IS NULL
    )
  ),
  CONSTRAINT collaborative_memories_org_scope_ck CHECK (
    scope <> 'organisation' OR (organisation_id IS NOT NULL AND project_id IS NULL)
  ),
  CONSTRAINT collaborative_memories_session_visibility_ck CHECK (
    visibility <> 'session_private' OR source_session_id IS NOT NULL
  ),
  CONSTRAINT collaborative_memories_workstream_visibility_ck CHECK (
    visibility <> 'workstream_shared' OR workstream_id IS NOT NULL
  ),
  CONSTRAINT collaborative_memories_reviewer_visibility_ck CHECK (
    visibility <> 'reviewer_private' OR (scope = 'review' AND reviewer_assignment_id IS NOT NULL)
  ),
  CONSTRAINT collaborative_memories_adjudication_visibility_ck CHECK (
    visibility <> 'adjudication_shared' OR scope = 'review'
  ),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX collaborative_memories_project_idx
  ON collaborative_memories (organisation_id, project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX collaborative_memories_owner_idx
  ON collaborative_memories (owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;
CREATE TABLE collaborative_memory_links (
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  source_memory_id text NOT NULL,
  target_memory_id text NOT NULL,
  relation text NOT NULL CHECK (relation IN ('supersedes','supports','relates_to','handoff_from','references')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, project_id, source_memory_id, target_memory_id, relation),
  CHECK (source_memory_id <> target_memory_id),
  FOREIGN KEY (organisation_id, project_id, source_memory_id)
    REFERENCES collaborative_memories(organisation_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, project_id, target_memory_id)
    REFERENCES collaborative_memories(organisation_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE agent_handoffs (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  source_session_id text NOT NULL,
  source_agent_id text NOT NULL CHECK (source_agent_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  target_session_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  target_agent_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 16384),
  evidence_references text[] NOT NULL DEFAULT ARRAY[]::text[],
  blockers text[] NOT NULL DEFAULT ARRAY[]::text[],
  source_commit text,
  workspace_reference text,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,  CHECK (cardinality(target_session_ids) + cardinality(target_agent_ids) > 0),
  FOREIGN KEY (organisation_id, project_id, source_session_id)
    REFERENCES engineering_sessions(organisation_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX agent_handoffs_project_idx
  ON agent_handoffs (organisation_id, project_id, created_at DESC);

CREATE FUNCTION prevent_collaborative_memory_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'collaborative memory is immutable and append-oriented';
END;
$$;

CREATE TRIGGER collaborative_memories_immutable
BEFORE UPDATE OR DELETE ON collaborative_memories
FOR EACH ROW EXECUTE FUNCTION prevent_collaborative_memory_mutation();

CREATE FUNCTION prevent_engineering_session_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id, OLD.organisation_id, OLD.project_id, OLD.workstream_id, OLD.task_id, OLD.agent_id, OLD.created_by, OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.id, NEW.organisation_id, NEW.project_id, NEW.workstream_id, NEW.task_id, NEW.agent_id, NEW.created_by, NEW.created_at) THEN
    RAISE EXCEPTION 'engineering session identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engineering_sessions_identity_immutable
BEFORE UPDATE ON engineering_sessions
FOR EACH ROW EXECUTE FUNCTION prevent_engineering_session_identity_mutation();
