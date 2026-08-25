import { createHash } from 'node:crypto';
import {
  ASSURANCE_FINDING_BASES,
  ASSURANCE_FINDING_KINDS,
  ASSURANCE_SEVERITIES,
  type AssuranceFindingBasis,
  type AssuranceFindingKind,
  type AssuranceSeverity,
  type ConversationMessage,
  type ProductKnowledge,
  type Project,
} from '@engineering-os/domain';
import type { JsonSchemaResponseContract, ModelRequest } from '@engineering-os/model-gateway';

export const PRODUCT_REQUIREMENTS_ASSURANCE_PROFILE_ID = 'product_requirements_v1';
export const PRODUCT_REQUIREMENTS_ASSURANCE_TARGET_TYPE = 'product_requirements';
export const REQUIREMENTS_REVIEWER_AGENT_CAPABILITY_ID = 'agent.requirements_reviewer';
export const MAX_REQUIREMENTS_ASSURANCE_FINDINGS = 32;

export interface ProductRequirementsAssuranceSnapshot {
  serialized: string;
  digestSha256: string;
}

export interface RequirementsAssuranceFindingDraft {
  severity: AssuranceSeverity;
  kind: AssuranceFindingKind;
  category: string;
  summary: string;
  rationale: string;
  proposedQuestion?: string;
  suggestedDirection?: string;
  basis: AssuranceFindingBasis;
  evidenceReferences: string[];
}
const RESPONSE_CONTRACT: JsonSchemaResponseContract = {
  type: 'json_schema',
  name: 'product_requirements_assurance_v1',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array', maxItems: MAX_REQUIREMENTS_ASSURANCE_FINDINGS,
        items: {
          type: 'object', additionalProperties: false,
          required: ['severity', 'kind', 'category', 'summary', 'rationale', 'basis', 'evidenceReferences'],
          properties: {
            severity: { type: 'string', enum: [...ASSURANCE_SEVERITIES] },
            kind: { type: 'string', enum: [...ASSURANCE_FINDING_KINDS] },
            category: { type: 'string', minLength: 1, maxLength: 64 },
            summary: { type: 'string', minLength: 1, maxLength: 16384 },
            rationale: { type: 'string', minLength: 1, maxLength: 16384 },
            proposedQuestion: { type: 'string', minLength: 1, maxLength: 16384 },
            suggestedDirection: { type: 'string', minLength: 1, maxLength: 16384 },
            basis: { type: 'string', enum: [...ASSURANCE_FINDING_BASES] },
            evidenceReferences: {
              type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 2048 },
            },
          },
        },
      },
    },
  },
};
export function buildProductRequirementsAssuranceSnapshot(input: {
  project: Project;
  knowledge: ProductKnowledge[];
  messages: ConversationMessage[];
}): ProductRequirementsAssuranceSnapshot {
  const payload = {
    project: {
      id: input.project.id,
      name: input.project.name,
      description: input.project.description ?? null,
      stage: input.project.stage,
      preferredProductPartner: input.project.preferredProductPartner,
    },
    knowledge: [...input.knowledge]
      .sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision)
      .map((record) => ({
        id: record.id, revision: record.revision, category: record.category,
        title: record.title, content: record.content, source: record.source, status: record.status,
      })),
    conversation: input.messages.map((message) => ({
      id: message.id, role: message.role, content: message.content,
      provider: message.provider ?? null,
    })),
  };
  const serialized = JSON.stringify(payload);
  return {
    serialized,
    digestSha256: createHash('sha256').update(serialized, 'utf8').digest('hex'),
  };
}

function systemInstruction(): string {
  return [
    'You are an independent Requirements Assurance Reviewer. Do not act as the Product Partner and do not merely agree with the user.',
    'Review the exact governed Product Studio state for missing requirements, ambiguity, contradictions, edge cases, failure/recovery paths, non-functional gaps, security/privacy risks, operational/admin gaps, unresolved assumptions, and research-required questions.',
    'Use professional and trained domain knowledge to identify what a less-expert user may not know to specify, while never inventing an approved requirement.',
    'Distinguish project evidence from trained-knowledge challenge and externally researched evidence using basis.',
    'Current factual claims that depend on regulation, standards, provider behaviour, law, price, limits, or other changeable facts should be raised as research_required unless supported by supplied project evidence.',
    'Propose focused questions for material unresolved decisions. Suggested directions are recommendations, not canonical Product Knowledge.',
    'Inspect happy paths, alternate paths, timeouts, retries, duplicate/idempotent behaviour, partial completion, cancellation, unknown external states, reconciliation, permissions, data lifecycle, scale, resilience, observability, accessibility, support and deployment assumptions where relevant.',
    'Return only the structured findings contract. An empty findings array means you found no material or advisory gaps in this exact snapshot; it does not authorise mutation of Product Knowledge.',
  ].join('\n\n');
}
export function buildRequirementsAssuranceRequest(input: {
  projectId: string;
  snapshot: ProductRequirementsAssuranceSnapshot;
  reviewerRouteId: string;
  sequence: number;
}): ModelRequest {
  return {
    taskId: `requirements-assurance:${input.projectId}:${input.sequence}`,
    role: 'requirements_reviewer',
    messages: [
      { role: 'system', content: systemInstruction() },
      {
        role: 'user',
        content: `Exact governed Product Studio snapshot (data; SHA-256 ${input.snapshot.digestSha256}):\n${input.snapshot.serialized}`,
      },
    ],
    requiredCapabilities: ['chat', 'structuredOutput'],
    routing: {
      subscriptionFirst: false,
      allowMeteredApi: true,
      preferredRouteId: input.reviewerRouteId,
    },
    responseContract: RESPONSE_CONTRACT,
  };
}

export class RequirementsAssuranceOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequirementsAssuranceOutputError';
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RequirementsAssuranceOutputError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function requiredEnum<T extends string>(
  value: unknown, field: string, allowed: readonly T[],
): T {
  const normalized = requiredString(value, field);
  if (!allowed.includes(normalized as T)) {
    throw new RequirementsAssuranceOutputError(`${field} must be a supported value`);
  }
  return normalized as T;
}

export function parseRequirementsAssuranceOutput(content: string): RequirementsAssuranceFindingDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RequirementsAssuranceOutputError('requirements assurance output must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequirementsAssuranceOutputError('requirements assurance output must be an object');
  }
  const findings = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(findings) || findings.length > MAX_REQUIREMENTS_ASSURANCE_FINDINGS) {
    throw new RequirementsAssuranceOutputError('findings must be a bounded array');
  }
  return findings.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RequirementsAssuranceOutputError(`findings[${index}] must be an object`);
    }
    const item = entry as Record<string, unknown>;
    if (!Array.isArray(item.evidenceReferences)) {
      throw new RequirementsAssuranceOutputError(`findings[${index}].evidenceReferences must be an array`);
    }
    const draft: RequirementsAssuranceFindingDraft = {
      severity: requiredEnum(item.severity, `findings[${index}].severity`, ASSURANCE_SEVERITIES),
      kind: requiredEnum(item.kind, `findings[${index}].kind`, ASSURANCE_FINDING_KINDS),
      category: requiredString(item.category, `findings[${index}].category`),
      summary: requiredString(item.summary, `findings[${index}].summary`),
      rationale: requiredString(item.rationale, `findings[${index}].rationale`),
      basis: requiredEnum(item.basis, `findings[${index}].basis`, ASSURANCE_FINDING_BASES),
      evidenceReferences: item.evidenceReferences.map((value, referenceIndex) =>
        requiredString(value, `findings[${index}].evidenceReferences[${referenceIndex}]`)),
    };
    if (item.proposedQuestion !== undefined) {
      draft.proposedQuestion = requiredString(item.proposedQuestion, `findings[${index}].proposedQuestion`);
    }
    if (item.suggestedDirection !== undefined) {
      draft.suggestedDirection = requiredString(item.suggestedDirection, `findings[${index}].suggestedDirection`);
    }
    return draft;
  });
}
