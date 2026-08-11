import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const SESSION_COOKIE = 'engineering_os_session';
export const ORGANISATION_COOKIE = 'engineering_os_organisation';
export const INVITATION_FLASH_COOKIE = 'engineering_os_invitation_flash';

export type ProductPartner = 'auto' | string;
export type KnowledgeStatus =
  | 'proposed'
  | 'inferred'
  | 'confirmed'
  | 'approved'
  | 'superseded'
  | 'rejected';
export type OrganisationRole = 'owner' | 'admin' | 'member';
export type ProjectRole = 'product_owner' | 'contributor' | 'engineer' | 'reviewer' | 'viewer';

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
  provider?: string;
  createdAt: string;
}

export interface StudioState {
  project: Omit<ProjectSummary, 'completeness'>;
  conversation: { id: string; purpose: 'product_discovery'; createdAt: string } | null;
  messages: ConversationMessage[];
  knowledge: ProductKnowledge[];
  completeness: ProductCompleteness;
  viewerProjectRole: ProjectRole | null;
  latestFailedExtractionRun: KnowledgeExtractionRunSummary | null;
}

export interface ModelRouteCapabilities {
  chat: boolean;
  tools: boolean;
  vision: boolean;
  files: boolean;
  mcp: boolean;
  localWorkspace: boolean;
  headless: boolean;
  structuredOutput: boolean;
}

export interface ModelRouteSummary {
  id: string;
  provider: string;
  model: string;
  executionMode: string;
  costType: string;
  available: boolean;
  capabilities: {
    chat: boolean;
    tools: boolean;
    vision: boolean;
    files: boolean;
    mcp: boolean;
    localWorkspace: boolean;
    headless: boolean;
    structuredOutput: boolean;
  };
}

export interface ProductPartnerTurnResult {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  execution: {
    provider: string;
    model: string;
    routeId: string;
    executionMode: string;
    costType: string;
    inputTokens?: number;
    outputTokens?: number;
  };
  extraction: {
    runId: string;
    status: 'succeeded' | 'failed';
    candidateCount: number;
  };
}

export interface CurrentIdentity {
  sessionId: string;
  accountId: string;
  userId: string;
  organisations: Array<{ organisationId: string; role: OrganisationRole }>;
}

export type KnowledgeCandidateStatus = 'pending' | 'accepted' | 'rejected';
export type KnowledgeCandidateBasis = 'user_stated' | 'assistant_inferred' | 'assistant_recommended';
export type KnowledgeExtractionRunStatus = 'received' | 'succeeded' | 'failed';

export interface KnowledgeCandidateSummary {
  id: string;
  organisationId: string;
  projectId: string;
  extractionRunId: string;
  category: string;
  title: string;
  content: string;
  basis: KnowledgeCandidateBasis;
  status: KnowledgeCandidateStatus;
  fingerprint: string;
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
  acceptedKnowledgeId?: string;
  rejectionReason?: string;
  sourceRun: KnowledgeExtractionRunSummary;
}

export interface KnowledgeExtractionRunSummary {
  id: string;
  organisationId: string;
  projectId: string;
  conversationId: string;
  sourceUserMessageId: string;
  sourceAssistantMessageId: string;
  provider: string;
  model: string;
  routeId: string;
  responseContractVersion: string;
  status: KnowledgeExtractionRunStatus;
  createdAt: string;
  completedAt?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface AcceptKnowledgeCandidateInput {
  category?: string;
  title?: string;
  content?: string;
}

export interface AcceptKnowledgeCandidateResult {
  candidate: KnowledgeCandidateSummary;
  knowledge: ProductKnowledge;
}

export interface RejectKnowledgeCandidateInput {
  reason?: string;
}

export interface RetryKnowledgeExtractionResult {
  originalRunId: string;
  retryRunId: string;
  status: 'succeeded' | 'failed';
  candidateCount: number;
}

export interface LoginResult {
  sessionId: string;
  token: string;
  expiresAt: string;
  userId: string;
}

export interface AdminPerson {
  id: string;
  userId: string;
  accountStatus: 'active' | 'suspended';
  organisationRole: OrganisationRole;
  membershipStatus: 'active' | 'revoked';
  projects: Array<{ projectId: string; role: ProjectRole }>;
}

export interface InvitationSummary {
  id: string;
  organisationRole: OrganisationRole;
  status: 'pending' | 'consumed' | 'expired' | 'revoked' | 'replaced';
  issuedBy: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
  consumedByUserId?: string;
  projectGrants: Array<{ projectId: string; role: ProjectRole }>;
}

const API_BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3100';

async function parseResponse<T>(response: Response, redirectOn401 = true): Promise<T> {
  if (!response.ok) {
    if (response.status === 401 && redirectOn401) redirect('/login');
    const body = await response.text();
    throw new Error(`Platform API ${response.status}: ${body}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function authenticatedHeaders(init: RequestInit = {}): Promise<Headers> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const organisationId =
    cookieStore.get(ORGANISATION_COOKIE)?.value || process.env.DEV_ORGANISATION_ID;
  if (!token) redirect('/login');
  if (!organisationId) throw new Error('No active organisation is selected');

  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('x-organisation-id', organisationId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await authenticatedHeaders(init);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  return parseResponse<T>(response);
}

async function publicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  return parseResponse<T>(response, false);
}

export function loginUser(userId: string, password: string): Promise<LoginResult> {
  return publicFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId, password }),
  });
}

export function redeemInvitation(input: { key: string; userId: string; password: string }) {
  return publicFetch<{ id: string; userId: string; organisationId: string }>('/auth/redeem', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCurrentIdentityWithToken(token: string): Promise<CurrentIdentity> {
  return publicFetch<CurrentIdentity>('/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function getCurrentIdentity(): Promise<CurrentIdentity | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await getCurrentIdentityWithToken(token);
  } catch {
    return null;
  }
}

export function logoutUser(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' });
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

export function listKnowledgeCandidates(
  projectId: string,
): Promise<KnowledgeCandidateSummary[]> {
  return apiFetch<KnowledgeCandidateSummary[]>(
    `/projects/${projectId}/knowledge-candidates?status=pending`,
  );
}

export function acceptKnowledgeCandidate(
  projectId: string,
  candidateId: string,
  input: AcceptKnowledgeCandidateInput = {},
): Promise<AcceptKnowledgeCandidateResult> {
  return apiFetch<AcceptKnowledgeCandidateResult>(
    `/projects/${projectId}/knowledge-candidates/${candidateId}/accept`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function rejectKnowledgeCandidate(
  projectId: string,
  candidateId: string,
  input: RejectKnowledgeCandidateInput = {},
): Promise<{ candidate: KnowledgeCandidateSummary }> {
  return apiFetch<{ candidate: KnowledgeCandidateSummary }>(
    `/projects/${projectId}/knowledge-candidates/${candidateId}/reject`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function retryKnowledgeExtraction(
  projectId: string,
  runId: string,
): Promise<RetryKnowledgeExtractionResult> {
  return apiFetch<RetryKnowledgeExtractionResult>(
    `/projects/${projectId}/extraction-runs/${runId}/retry`,
    { method: 'POST' },
  );
}

export function listPeople(): Promise<AdminPerson[]> {
  return apiFetch<AdminPerson[]>('/admin/users');
}

export function getInvitationPolicy(): Promise<{ ttlMinutes: number }> {
  return apiFetch<{ ttlMinutes: number }>('/admin/invitation-policy');
}

export function setInvitationPolicy(ttlMinutes: number): Promise<{ ttlMinutes: number }> {
  return apiFetch<{ ttlMinutes: number }>('/admin/invitation-policy', {
    method: 'PATCH',
    body: JSON.stringify({ ttlMinutes }),
  });
}

export function listInvitations(): Promise<InvitationSummary[]> {
  return apiFetch<InvitationSummary[]>('/admin/invitations');
}

export function createInvitation(input: {
  organisationRole: OrganisationRole;
  ttlMinutes?: number;
  projectGrants: Array<{ projectId: string; role: ProjectRole }>;
}): Promise<{ invitationId: string; key: string; expiresAt: string }> {
  return apiFetch('/auth/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelInvitation(invitationId: string): Promise<void> {
  return apiFetch<void>(`/auth/invitations/${invitationId}`, { method: 'DELETE' });
}

export function grantProjectAccess(projectId: string, userId: string, role: ProjectRole) {
  return apiFetch<{ projectId: string; userId: string; role: ProjectRole }>(
    `/projects/${projectId}/members/${userId}`,
    { method: 'PUT', body: JSON.stringify({ role }) },
  );
}

export function revokeProjectAccess(projectId: string, userId: string): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
}

export function setUserStatus(userId: string, status: 'active' | 'suspended') {
  return apiFetch<{ status: 'active' | 'suspended' }>(`/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function revokeOrganisationAccess(userId: string): Promise<void> {
  return apiFetch<void>(`/admin/users/${userId}/organisation-access`, { method: 'DELETE' });
}
