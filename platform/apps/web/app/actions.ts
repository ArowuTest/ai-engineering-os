'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  acceptKnowledgeCandidate,
  addKnowledge,
  appendMessage,
  cancelInvitation,
  changeProductPartner,
  createInvitation,
  createProject,
  getCurrentIdentityWithToken,
  INVITATION_FLASH_COOKIE,
  grantProjectAccess,
  loginUser,
  logoutUser,
  ORGANISATION_COOKIE,
  redeemInvitation,
  registerOrganisationAIConnection,
  registerPersonalAIConnection,
  rejectKnowledgeCandidate,
  retryKnowledgeExtraction,
  reviseKnowledge,
  revokeAIConnection,
  revokeAIConnectionProjectShare,
  revokeOrganisationAccess,
  revokeProjectAccess,
  sendProductPartnerTurn,
  SESSION_COOKIE,
  setAIConnectionShareMode,
  setInvitationPolicy,
  setUserStatus,
  shareAIConnectionWithProject,
  updateAIConnectionShareWindow,
  type AIConnectionShareMode,
  type KnowledgeStatus,
  type OrganisationRole,
  type ProductPartner,
  type ProjectRole,
} from '../lib/api';


function required(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function requiredNumber(formData: FormData, key: string): number {
  const value = Number(required(formData, key));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
}

async function setAuthenticatedSession(
  token: string,
  expiresAt: string,
  organisationId: string,
): Promise<void> {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(expiresAt),
  });
  cookieStore.set(ORGANISATION_COOKIE, organisationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function loginAction(formData: FormData) {
  const userId = required(formData, 'userId');
  const password = required(formData, 'password');
  const login = await loginUser(userId, password);
  const identity = await getCurrentIdentityWithToken(login.token);
  const organisation = identity.organisations[0];
  if (!organisation) throw new Error('This account has no active organisation access');
  await setAuthenticatedSession(login.token, login.expiresAt, organisation.organisationId);
  redirect('/');
}

export async function redeemInvitationAction(formData: FormData) {
  const key = required(formData, 'key');
  const userId = required(formData, 'userId');
  const password = required(formData, 'password');
  const redeemed = await redeemInvitation({ key, userId, password });
  const login = await loginUser(userId, password);
  await setAuthenticatedSession(login.token, login.expiresAt, redeemed.organisationId);
  redirect('/');
}

export async function logoutAction() {
  try {
    await logoutUser();
  } finally {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
    cookieStore.delete(ORGANISATION_COOKIE);
  }
  redirect('/login');
}

export async function createProductAction(formData: FormData) {
  const description = String(formData.get('description') ?? '').trim();
  const project = await createProject({
    name: required(formData, 'name'),
    preferredProductPartner: required(formData, 'preferredProductPartner') as ProductPartner,
    ...(description ? { description } : {}),
  });
  redirect(`/projects/${project.id}`);
}

export async function sendProductPartnerTurnAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  await sendProductPartnerTurn(projectId, required(formData, 'content'));
  revalidatePath('/');
  revalidatePath(`/projects/${projectId}`);
  // Failed extraction state is reconstructible from durable studio.latestFailedExtractionRun
  // on the next render — no redirect-only query params.
}

export async function acceptKnowledgeCandidateAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const candidateId = required(formData, 'candidateId');
  const category = required(formData, 'category');
  const title = required(formData, 'title');
  const content = required(formData, 'content');
  await acceptKnowledgeCandidate(projectId, candidateId, { category, title, content });
  revalidatePath('/');
  revalidatePath(`/projects/${projectId}`);
}

export async function rejectKnowledgeCandidateAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const candidateId = required(formData, 'candidateId');
  const reason = String(formData.get('reason') ?? '').trim();
  await rejectKnowledgeCandidate(projectId, candidateId, reason ? { reason } : {});
  revalidatePath(`/projects/${projectId}`);
}

export async function retryKnowledgeExtractionAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const runId = required(formData, 'runId');
  await retryKnowledgeExtraction(projectId, runId);
  revalidatePath(`/projects/${projectId}`);
}

export async function appendMessageAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  await appendMessage(projectId, required(formData, 'content'));
  revalidatePath(`/projects/${projectId}`);
}

export async function changePartnerAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  await changeProductPartner(
    projectId,
    required(formData, 'preferredProductPartner') as ProductPartner,
  );
  revalidatePath('/');
  revalidatePath(`/projects/${projectId}`);
}

export async function addKnowledgeAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  await addKnowledge(projectId, {
    category: required(formData, 'category'),
    title: required(formData, 'title'),
    content: required(formData, 'content'),
    source: 'product_studio_user',
    status: 'proposed',
  });
  revalidatePath('/');
  revalidatePath(`/projects/${projectId}`);
}

export async function reviseKnowledgeStatusAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const knowledgeId = required(formData, 'knowledgeId');
  const status = required(formData, 'status') as KnowledgeStatus;
  await reviseKnowledge(projectId, knowledgeId, { status });
  revalidatePath('/');
  revalidatePath(`/projects/${projectId}`);
}

export async function createInvitationAction(formData: FormData) {
  const projectIds = formData.getAll('projectId').filter((value): value is string => typeof value === 'string');
  const projectRole = required(formData, 'projectRole') as ProjectRole;
  const invitation = await createInvitation({
    organisationRole: required(formData, 'organisationRole') as OrganisationRole,
    ttlMinutes: requiredNumber(formData, 'ttlMinutes'),
    projectGrants: projectIds.map((projectId) => ({ projectId, role: projectRole })),
  });
  const cookieStore = await cookies();
  cookieStore.set(INVITATION_FLASH_COOKIE, JSON.stringify({
    key: invitation.key,
    expiresAt: invitation.expiresAt,
  }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin/access',
    maxAge: 120,
  });
  redirect('/admin/access?created=1');
}

export async function updateInvitationPolicyAction(formData: FormData) {
  await setInvitationPolicy(requiredNumber(formData, 'ttlMinutes'));
  revalidatePath('/admin/access');
}

export async function cancelInvitationAction(formData: FormData) {
  await cancelInvitation(required(formData, 'invitationId'));
  revalidatePath('/admin/access');
}

export async function grantProjectAccessAction(formData: FormData) {
  await grantProjectAccess(
    required(formData, 'projectId'),
    required(formData, 'userId'),
    required(formData, 'role') as ProjectRole,
  );
  revalidatePath('/admin/access');
}

export async function revokeProjectAccessAction(formData: FormData) {
  await revokeProjectAccess(
    required(formData, 'projectId'),
    required(formData, 'userId'),
  );
  revalidatePath('/admin/access');
}

export async function setUserStatusAction(formData: FormData) {
  const status = required(formData, 'status');
  if (status !== 'active' && status !== 'suspended') throw new Error('Invalid user status');
  await setUserStatus(required(formData, 'userId'), status);
  revalidatePath('/admin/access');
}

export async function revokeOrganisationAccessAction(formData: FormData) {
  await revokeOrganisationAccess(required(formData, 'userId'));
  revalidatePath('/admin/access');
}

// AI connection availability administration is an explicit UTC contract.
// Browser <input type="datetime-local"> submits timezone-less strings like
// "2026-08-13T09:30" which `new Date(raw)` would parse in the server's local TZ.
// We normalise to UTC BEFORE parsing so behaviour is deterministic across hosts.
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;

function optionalIsoDate(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const trimmed = raw.trim();
  const normalised = DATETIME_LOCAL_RE.test(trimmed) ? trimmed + 'Z' : trimmed;
  const parsed = new Date(normalised);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${key} must be a valid ISO date`);
  return parsed.toISOString();
}

export async function registerPersonalAIConnectionAction(formData: FormData) {
  await registerPersonalAIConnection({
    connectionFamilyId: required(formData, 'connectionFamilyId'),
  });
  revalidatePath('/ai-connections');
}

export async function registerOrganisationAIConnectionAction(formData: FormData) {
  const secretRefRaw = formData.get('secretRefId');
  const input: { connectionFamilyId: string; secretRefId?: string } = {
    connectionFamilyId: required(formData, 'connectionFamilyId'),
  };
  if (typeof secretRefRaw === 'string' && secretRefRaw.trim() !== '') {
    input.secretRefId = secretRefRaw.trim();
  }
  await registerOrganisationAIConnection(input);
  revalidatePath('/ai-connections');
}

export async function revokeAIConnectionAction(formData: FormData) {
  await revokeAIConnection(required(formData, 'connectionId'));
  revalidatePath('/ai-connections');
}

export async function shareAIConnectionAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const connectionId = required(formData, 'connectionId');
  const availableFrom = optionalIsoDate(formData, 'availableFrom');
  const availableUntil = optionalIsoDate(formData, 'availableUntil');
  const input: {
    projectId: string;
    connectionId: string;
    availableFrom?: string;
    availableUntil?: string;
  } = { projectId, connectionId };
  if (availableFrom) input.availableFrom = availableFrom;
  if (availableUntil) input.availableUntil = availableUntil;
  await shareAIConnectionWithProject(input);
  revalidatePath('/ai-connections');
  revalidatePath(`/projects/${projectId}`);
}

export async function setAIConnectionShareModeAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const connectionId = required(formData, 'connectionId');
  const rawMode = required(formData, 'mode');
  if (rawMode !== 'online_only' && rawMode !== 'persistent') {
    throw new Error('mode must be online_only or persistent');
  }
  const mode: AIConnectionShareMode = rawMode;
  await setAIConnectionShareMode({ projectId, connectionId, mode });
  revalidatePath('/ai-connections');
  revalidatePath(`/projects/${projectId}`);
}

export async function updateAIConnectionShareWindowAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const connectionId = required(formData, 'connectionId');
  const availableFrom = optionalIsoDate(formData, 'availableFrom');
  const availableUntil = optionalIsoDate(formData, 'availableUntil');
  // Guard against blind PATCH: the underlying HTTP route treats missing window
  // fields as a no-op, so short-circuit here to avoid a needless round-trip
  // and to make the "nothing to change" branch explicit.
  if (availableFrom === undefined && availableUntil === undefined) {
    revalidatePath('/ai-connections');
    revalidatePath(`/projects/${projectId}`);
    return;
  }
  const input: {
    projectId: string;
    connectionId: string;
    availableFrom?: string;
    availableUntil?: string;
  } = { projectId, connectionId };
  if (availableFrom) input.availableFrom = availableFrom;
  if (availableUntil) input.availableUntil = availableUntil;
  await updateAIConnectionShareWindow(input);
  revalidatePath('/ai-connections');
  revalidatePath(`/projects/${projectId}`);
}

export async function clearAIConnectionShareWindowAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const connectionId = required(formData, 'connectionId');
  await updateAIConnectionShareWindow({
    projectId,
    connectionId,
    availableFrom: null,
    availableUntil: null,
  });
  revalidatePath('/ai-connections');
  revalidatePath(`/projects/${projectId}`);
}

export async function revokeAIConnectionShareAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const connectionId = required(formData, 'connectionId');
  await revokeAIConnectionProjectShare({ projectId, connectionId });
  revalidatePath('/ai-connections');
  revalidatePath(`/projects/${projectId}`);
}
