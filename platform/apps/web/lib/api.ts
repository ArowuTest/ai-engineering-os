export type ProductPartner = 'auto' | 'openai' | 'anthropic' | 'google';
export type KnowledgeStatus =
  | 'proposed'
  | 'inferred'
  | 'confirmed'
  | 'approved'
  | 'superseded'
  | 'rejected';

export interface ProductCompleteness {
  percentage: number;
  coveredCategories: string[];
  missingCategories: string[];
}

export interface ProjectSummary {
  id: string;
  organisationId: string;
  name: string;
  description?: string;
  stage: string;
  preferredProductPartner: ProductPartner;
  createdAt: string;
  updatedAt: string;
  completeness: ProductCompleteness;
}

export interface ProductKnowledge {
  id: string;
  revision: number;
  category: string;
  title: string;
  content: string;
  source: string;
  status: KnowledgeStatus;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: 'openai' | 'anthropic' | 'google';
  createdAt: string;
}

export interface StudioState {
  project: Omit<ProjectSummary, 'completeness'>;
  conversation: { id: string; purpose: 'product_discovery'; createdAt: string } | null;
  messages: ConversationMessage[];
  knowledge: ProductKnowledge[];
  completeness: ProductCompleteness;
}

const API_BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3100';
const organisationId = process.env.DEV_ORGANISATION_ID || 'org-001';
const userId = process.env.DEV_USER_ID || 'user-001';

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-organisation-id', organisationId);
  headers.set('x-user-id', userId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Platform API ${response.status}: ${body}`);
  }
  return response.json() as Promise<T>;
}

export function listProjects(): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>('/projects');
}

export function createProject(input: {
  name: string;
  description?: string;
  preferredProductPartner: ProductPartner;
}): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getStudio(projectId: string): Promise<StudioState> {
  return apiFetch<StudioState>(`/projects/${projectId}/studio`);
}

export function appendMessage(projectId: string, content: string): Promise<ConversationMessage> {
  return apiFetch<ConversationMessage>(`/projects/${projectId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function changeProductPartner(
  projectId: string,
  preferredProductPartner: ProductPartner,
): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/projects/${projectId}/product-partner`, {
    method: 'PATCH',
    body: JSON.stringify({ preferredProductPartner }),
  });
}

export function addKnowledge(
  projectId: string,
  input: { category: string; title: string; content: string; source: string; status?: KnowledgeStatus },
): Promise<ProductKnowledge> {
  return apiFetch<ProductKnowledge>(`/projects/${projectId}/knowledge`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reviseKnowledge(
  projectId: string,
  knowledgeId: string,
  input: { title?: string; content?: string; status?: KnowledgeStatus },
): Promise<ProductKnowledge> {
  return apiFetch<ProductKnowledge>(`/projects/${projectId}/knowledge/${knowledgeId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export interface ModelRouteSummary {
  id: string;
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  executionMode: string;
  costType: string;
  available: boolean;
}

export interface ProductPartnerTurnResult {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  execution: {
    provider: 'openai' | 'anthropic' | 'google';
    model: string;
    routeId: string;
    executionMode: string;
    costType: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export function listModelRoutes(): Promise<ModelRouteSummary[]> {
  return apiFetch<ModelRouteSummary[]>('/model-routes');
}

export function sendProductPartnerTurn(
  projectId: string,
  content: string,
): Promise<ProductPartnerTurnResult> {
  return apiFetch<ProductPartnerTurnResult>(`/projects/${projectId}/product-partner-turn`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}
