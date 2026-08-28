import type { Pool } from 'pg';
import { AIConnectionRepository } from './ai-connection-repository.js';
import { AIConnectionSecretRepository } from './ai-connection-secret-repository.js';
import { AssuranceRepository } from './assurance-repository.js';
import { AIRunnerRepository } from './ai-runner-repository.js';
import { AuditRepository } from './audit-repository.js';
import { ConversationRepository } from './conversation-repository.js';
import { CollaborativeMemoryRepository, EngineeringSessionRepository } from './collaborative-memory-repository.js';
import { CapabilityEstateRepository } from './capability-estate-repository.js';
import { InvitationRepository } from './invitation-repository.js';
import { KnowledgeCandidateRepository } from './knowledge-candidate-repository.js';
import { KnowledgeRepository } from './knowledge-repository.js';
import { MembershipRepository } from './membership-repository.js';
import { PlatformMembershipRepository } from './platform-membership-repository.js';
import { ProjectRepository } from './project-repository.js';
import { ReviewCouncilRepository } from './review-council-repository.js';
import { SessionRepository } from './session-repository.js';
import { StudioInteractionArtifactRepository } from './studio-interaction-artifact-repository.js';
import { UserRepository } from './user-repository.js';

export interface TransactionRepositories {
  projects: ProjectRepository;
  assurance: AssuranceRepository;
  reviewCouncil: ReviewCouncilRepository;
  conversations: ConversationRepository;
  collaborativeMemory: CollaborativeMemoryRepository;
  capabilityEstate: CapabilityEstateRepository;
  engineeringSessions: EngineeringSessionRepository;
  knowledge: KnowledgeRepository;
  knowledgeCandidates: KnowledgeCandidateRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  platformMemberships: PlatformMembershipRepository;
  invitations: InvitationRepository;
  sessions: SessionRepository;
  studioInteractionArtifacts: StudioInteractionArtifactRepository;
  audit: AuditRepository;
  aiConnections: AIConnectionRepository;
  aiConnectionSecrets: AIConnectionSecretRepository;
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
        assurance: new AssuranceRepository(client),
        reviewCouncil: new ReviewCouncilRepository(client),
        conversations: new ConversationRepository(client),
        collaborativeMemory: new CollaborativeMemoryRepository(client),
        capabilityEstate: new CapabilityEstateRepository(client),
        engineeringSessions: new EngineeringSessionRepository(client),
        knowledge: new KnowledgeRepository(client),
        knowledgeCandidates: new KnowledgeCandidateRepository(client),
        users: new UserRepository(client),
        memberships: new MembershipRepository(client),
        platformMemberships: new PlatformMembershipRepository(client),
        invitations: new InvitationRepository(client),
        sessions: new SessionRepository(client),
        studioInteractionArtifacts: new StudioInteractionArtifactRepository(client),
        audit: new AuditRepository(client),
        aiConnections: new AIConnectionRepository(client),
        aiConnectionSecrets: new AIConnectionSecretRepository(client),
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
