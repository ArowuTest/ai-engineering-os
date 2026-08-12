ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_preferred_product_partner_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_preferred_product_partner_check
  CHECK (
    preferred_product_partner = 'auto'
    OR preferred_product_partner ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  );

ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_provider_check;

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_provider_check
  CHECK (
    provider IS NULL
    OR (
      provider <> 'auto'
      AND provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    )
  );
