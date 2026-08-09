import { describe, expect, it } from 'vitest';
import { createProject, DomainValidationError } from '../src/index.js';

describe('createProject', () => {
  it('creates an organisation-scoped project and normalises its name', () => {
    const project = createProject({
      organisationId: 'org-001',
      name: '  Enterprise Streaming  ',
      createdBy: 'user-001',
    });

    expect(project.organisationId).toBe('org-001');
    expect(project.name).toBe('Enterprise Streaming');
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(project.createdAt).toBeInstanceOf(Date);
  });

  it.each([
    [{ organisationId: '', name: 'Project', createdBy: 'user-001' }, 'organisationId'],
    [{ organisationId: 'org-001', name: '   ', createdBy: 'user-001' }, 'name'],
    [{ organisationId: 'org-001', name: 'Project', createdBy: '' }, 'createdBy'],
  ])('rejects invalid required project input %#', (input, field) => {
    expect(() => createProject(input)).toThrowError(DomainValidationError);
    expect(() => createProject(input)).toThrow(field);
  });
});