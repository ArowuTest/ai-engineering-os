import type { Pool } from 'pg';
import { AIConnectionRepository } from './ai-connection-repository.js';
import { AIRunnerRepository } from './ai-runner-repository.js';
import { AuditRepository } from './audit-repository.js';
import { ConversationRepository } from './conversation-repository.js';
import { CollaborativeMemoryRepository, EngineeringSessionRepository } from './collaborative-memory-repository.js';
import { InvitationRepository } from './invitation-repository.js';
import { KnowledgeCandidateRepository } from './knowledge-candidate-repository.js';
import { KnowledgeRepository } from './knowledge-repository.js';
import { MembershipRepository } from './membership-repository.js';
import { ProjectRepository } from './project-repository.js';
import { ReviewCouncilRepository } from './review-council-repository.js';
import { SessionRepository } from './session-repository.js';
import { UserRepository } from './user-repository.js';

export interface TransactionRepositories {
  projects: ProjectRepository;
  reviewCouncil: ReviewCouncilRepository;
  conversations: ConversationRepository;
  collaborativeMemory: CollaborativeMemoryRepository;
  engineeringSessions: EngineeringSessionRepository;
  knowledge: KnowledgeRepository;
  knowledgeCandidates: KnowledgeCandidateRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
  sessions: SessionRepository;
  audit: AuditRepository;
  aiConnections: AIConnectionRepository;
  aiRunners: AIRunnerRepository;
}

export class DatabaseUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (repositories: TransactionRepositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        projects: new ProjectRepository(client),
        reviewCouncil: new ReviewCouncilRepository(client),
        conversations: new ConversationRepository(client),
        collaborativeMemory: new CollaborativeMemoryRepository(client),
        engineeringSessions: new EngineeringSessionRepository(client),
        knowledge: new KnowledgeRepository(client),
        knowledgeCandidates: new KnowledgeCandidateRepository(client),
        users: new UserRepository(client),
        memberships: new MembershipRepository(client),
        invitations: new InvitationRepository(client),
        sessions: new SessionRepository(client),
        audit: new AuditRepository(client),
        aiConnections: new AIConnectionRepository(client),
        aiRunners: new AIRunnerRepository(client)
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
