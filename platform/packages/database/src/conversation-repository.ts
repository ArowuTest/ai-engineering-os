import type {
  ConversationMessage,
  MessageProvider,
  ProductConversation,
} from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface ConversationRow {
  id: string;
  organisation_id: string;
  project_id: string;
  purpose: ProductConversation['purpose'];
  created_by: string;
  created_at: Date;
}

interface MessageRow {
  id: string;
  organisation_id: string;
  project_id: string;
  conversation_id: string;
  role: ConversationMessage['role'];
  content: string;
  provider: MessageProvider | null;
  created_by: string;
  created_at: Date;
}

function mapConversation(row: ConversationRow): ProductConversation {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    purpose: row.purpose,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}
function mapMessage(row: MessageRow): ConversationMessage {
  const message: ConversationMessage = {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
  if (row.provider !== null) message.provider = row.provider;
  return message;
}

export class ConversationRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(conversation: ProductConversation): Promise<void> {
    await this.database.query(
      `INSERT INTO conversations
        (id, organisation_id, project_id, purpose, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conversation.id,
        conversation.organisationId,
        conversation.projectId,
        conversation.purpose,
        conversation.createdBy,
        conversation.createdAt,
      ],
    );
  }
  async getByProject(
    organisationId: string,
    projectId: string,
  ): Promise<ProductConversation | null> {
    const result = await this.database.query<ConversationRow>(
      `SELECT id, organisation_id, project_id, purpose, created_by, created_at
       FROM conversations
       WHERE organisation_id = $1 AND project_id = $2 AND purpose = 'product_discovery'
       ORDER BY created_at ASC
       LIMIT 1`,
      [organisationId, projectId],
    );
    const row = result.rows[0];
    return row ? mapConversation(row) : null;
  }

  async appendMessage(message: ConversationMessage): Promise<void> {
    await this.database.query(
      `INSERT INTO conversation_messages
        (id, organisation_id, project_id, conversation_id, role, content,
         provider, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        message.id,
        message.organisationId,
        message.projectId,
        message.conversationId,
        message.role,
        message.content,
        message.provider ?? null,
        message.createdBy,
        message.createdAt,
      ],
    );
  }
  async listMessages(
    organisationId: string,
    projectId: string,
    conversationId: string,
  ): Promise<ConversationMessage[]> {
    const result = await this.database.query<MessageRow>(
      `SELECT id, organisation_id, project_id, conversation_id, role, content,
              provider, created_by, created_at
       FROM conversation_messages
       WHERE organisation_id = $1 AND project_id = $2 AND conversation_id = $3
       ORDER BY sequence ASC`,
      [organisationId, projectId, conversationId],
    );
    return result.rows.map(mapMessage);
  }
}
