-- Task 9: provider-neutral connection-scoped model discovery.
-- Discovery provenance is tenant/connection owned; capability governance remains separate.
CREATE UNIQUE INDEX ai_connections_org_id_unique_idx
  ON ai_connections (organisation_id, id);

CREATE TABLE ai_connection_model_routes (
  organisation_id text NOT NULL,
  connection_id uuid NOT NULL,
  route_id text PRIMARY KEY CHECK (route_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  capability_id text NOT NULL UNIQUE
    REFERENCES capability_catalogue(id) ON DELETE RESTRICT,
  provider_id text NOT NULL CHECK (provider_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  provider_model_id text NOT NULL
    CHECK (length(trim(provider_model_id)) BETWEEN 1 AND 512),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 512),
  availability text NOT NULL CHECK (availability IN ('available','unavailable')),
  capabilities jsonb NOT NULL CHECK (jsonb_typeof(capabilities) = 'object'),
  first_discovered_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, connection_id)
    REFERENCES ai_connections(organisation_id, id) ON DELETE CASCADE,
  UNIQUE (organisation_id, connection_id, provider_model_id),
  CHECK (last_seen_at >= first_discovered_at)
);