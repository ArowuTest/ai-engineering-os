import { randomUUID } from 'node:crypto';
import { DomainValidationError, requireNonBlank } from './validation.js';

export const PRODUCT_PARTNERS = ['auto', 'openai', 'anthropic', 'google'] as const;
export type ProductPartner = (typeof PRODUCT_PARTNERS)[number];

export const PROJECT_STAGES = [
  'discovery',
  'product_definition',
  'product_review',
  'product_approval',
  'engineering_planning',
  'implementation',
  'testing',
  'independent_review',
  'release_ready',
  'deployed',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export interface Project {
  id: string;
  organisationId: string;
  name: string;
  description?: string;
  stage: ProjectStage;
  preferredProductPartner: ProductPartner;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  organisationId: string;
  name: string;
  description?: string;
  preferredProductPartner?: ProductPartner;
  createdBy: string;
}

function requireProductPartner(value: unknown): ProductPartner {
  if (typeof value !== 'string' || !PRODUCT_PARTNERS.includes(value as ProductPartner)) {
    throw new DomainValidationError(
      'preferredProductPartner',
      'preferredProductPartner must be auto, openai, anthropic, or google',
    );
  }
  return value as ProductPartner;
}

export function createProject(input: CreateProjectInput): Project {
  const now = new Date();
  const project: Project = {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    name: requireNonBlank(input.name, 'name'),
    stage: 'discovery',
    preferredProductPartner: requireProductPartner(input.preferredProductPartner ?? 'auto'),
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: now,
    updatedAt: now,
  };

  if (input.description?.trim()) project.description = input.description.trim();
  return project;
}

export function changeProjectProductPartner(
  project: Project,
  preferredProductPartner: ProductPartner,
): Project {
  return {
    ...project,
    preferredProductPartner: requireProductPartner(preferredProductPartner),
    updatedAt: new Date(),
  };
}
