ALTER TABLE projects
  ADD COLUMN stage text NOT NULL DEFAULT 'discovery'
    CHECK (stage IN (
      'discovery', 'product_definition', 'product_review', 'product_approval',
      'engineering_planning', 'implementation', 'testing', 'independent_review',
      'release_ready', 'deployed'
    )),
  ADD COLUMN preferred_product_partner text NOT NULL DEFAULT 'auto'
    CHECK (preferred_product_partner IN ('auto', 'openai', 'anthropic', 'google')),
  ADD COLUMN updated_at timestamptz;

UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE projects ALTER COLUMN updated_at SET NOT NULL;

CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'product_discovery'),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (organisation_id, project_id, id),
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX conversations_project_idx
  ON conversations (organisation_id, project_id, created_at ASC);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL CHECK (length(trim(content)) > 0),
  provider text CHECK (provider IS NULL OR provider IN ('openai', 'anthropic', 'google')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, project_id, conversation_id)
    REFERENCES conversations(organisation_id, project_id, id) ON DELETE CASCADE
);

CREATE INDEX conversation_messages_order_idx
  ON conversation_messages (organisation_id, project_id, conversation_id, sequence ASC);
