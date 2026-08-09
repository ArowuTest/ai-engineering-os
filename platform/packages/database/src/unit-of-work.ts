import type { Pool } from 'pg';
import { AuditRepository } from './audit-repository.js';
import { ConversationRepository } from './conversation-repository.js';
import { KnowledgeRepository } from './knowledge-repository.js';
import { ProjectRepository } from './project-repository.js';

export interface TransactionRepositories {
  projects: ProjectRepository;
  conversations: ConversationRepository;
  knowledge: KnowledgeRepository;
  audit: AuditRepository;
}

export class DatabaseUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (repositories: TransactionRepositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        projects: new ProjectRepository(client),
        conversations: new ConversationRepository(client),
        knowledge: new KnowledgeRepository(client),
        audit: new AuditRepository(client),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
