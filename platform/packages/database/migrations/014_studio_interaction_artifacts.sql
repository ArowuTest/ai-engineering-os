-- Task 9: governed Studio interaction artefact metadata.
-- Payload bytes remain in approved object storage; PostgreSQL owns authority/provenance references.

CREATE TABLE studio_interaction_artifacts (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('document','image','audio','video')),
  source text NOT NULL CHECK (source IN ('upload','microphone','screenshot','screen_recording')),
  storage_reference text NOT NULL CHECK (length(trim(storage_reference)) BETWEEN 1 AND 2048),
  digest_sha256 text NOT NULL CHECK (digest_sha256 ~ '^[a-f0-9]{64}$'),
  media_type text NOT NULL CHECK (length(trim(media_type)) BETWEEN 1 AND 256),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  context_text text CHECK (context_text IS NULL OR length(context_text) BETWEEN 1 AND 16384),
  visibility text NOT NULL CHECK (visibility = 'project'),
  retention_policy text NOT NULL CHECK (retention_policy IN ('project_default','ephemeral')),
  created_by text NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organisation_id, project_id)
    REFERENCES projects(organisation_id, id) ON DELETE CASCADE,
  CHECK (
    source='upload'
    OR (source='microphone' AND kind='audio')
    OR (source='screenshot' AND kind='image')
    OR (source='screen_recording' AND kind='video')
  ),
  CHECK (
    (kind='image' AND media_type LIKE 'image/%')
    OR (kind='audio' AND media_type LIKE 'audio/%')
    OR (kind='video' AND media_type LIKE 'video/%')
    OR (kind='document' AND (
      media_type LIKE 'text/%'
      OR media_type IN (
        'application/pdf','application/json','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
    ))
  )
);

CREATE INDEX studio_interaction_artifacts_project_created_idx
  ON studio_interaction_artifacts (organisation_id, project_id, created_at, id);
