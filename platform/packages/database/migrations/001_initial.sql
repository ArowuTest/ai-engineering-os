CREATE TABLE organisations (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (organisation_id, id)
);

CREATE INDEX projects_organisation_idx
  ON projects (organisation_id, created_at DESC);

CREATE TABLE product_knowledge (
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  category text NOT NULL CHECK (length(trim(category)) > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  content text NOT NULL CHECK (length(trim(content)) > 0),
  source text NOT NULL CHECK (length(trim(source)) > 0),
  status text NOT NULL CHECK (    status IN ('proposed', 'inferred', 'confirmed', 'approved', 'superseded', 'rejected')
  ),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (id, revision),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX product_knowledge_project_idx
  ON product_knowledge (organisation_id, project_id, id, revision DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  project_id uuid,
  event_type text NOT NULL CHECK (length(trim(event_type)) > 0),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id text NOT NULL CHECK (length(trim(actor_id)) > 0),
  subject_type text NOT NULL CHECK (length(trim(subject_type)) > 0),
  subject_id text NOT NULL CHECK (length(trim(subject_id)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE
);

CREATE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_event_mutation();
