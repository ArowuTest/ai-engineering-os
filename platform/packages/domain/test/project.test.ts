import { describe, expect, it } from 'vitest';
import {
  changeProjectProductPartner,
  createProject,
  DomainValidationError,
  type ProductPartner,
} from '../src/index.js';

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

  it('accepts an extensible provider identifier as Product Partner', () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Future Model Project',
      preferredProductPartner: 'mistral' as ProductPartner,
      createdBy: 'user-001',
    });

    expect(project.preferredProductPartner).toBe('mistral');
  });

  it('allows changing Product Partner to another valid provider identifier', () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Future Model Project',
      createdBy: 'user-001',
    });

    const changed = changeProjectProductPartner(
      project,
      'future-provider.v2' as ProductPartner,
    );
    expect(changed.preferredProductPartner).toBe('future-provider.v2');
  });

  it.each(['', '   ', 'OpenAI', 'provider name', 'x'.repeat(65)])(
    'rejects unsafe Product Partner identifier %j',
    (preferredProductPartner) => {
      expect(() =>
        createProject({
          organisationId: 'org-001',
          name: 'Invalid Provider Project',
          preferredProductPartner: preferredProductPartner as ProductPartner,
          createdBy: 'user-001',
        }),
      ).toThrowError(DomainValidationError);
    },
  );

  it.each([
    [{ organisationId: '', name: 'Project', createdBy: 'user-001' }, 'organisationId'],
    [{ organisationId: 'org-001', name: '   ', createdBy: 'user-001' }, 'name'],
    [{ organisationId: 'org-001', name: 'Project', createdBy: '' }, 'createdBy'],
  ])('rejects invalid required project input %#', (input, field) => {
    expect(() => createProject(input)).toThrowError(DomainValidationError);
    expect(() => createProject(input)).toThrow(field);
  });
});
