import { randomUUID } from 'node:crypto';
import { requireNonBlank } from './validation.js';

export interface Project {
  id: string;
  organisationId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
}

export interface CreateProjectInput {
  organisationId: string;
  name: string;
  description?: string;
  createdBy: string;
}

export function createProject(input: CreateProjectInput): Project {
  const project: Project = {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    name: requireNonBlank(input.name, 'name'),
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: new Date(),
  };

  if (input.description?.trim()) project.description = input.description.trim();
  return project;
}