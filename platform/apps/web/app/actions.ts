'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  acceptKnowledgeCandidate,
  addKnowledge,
  appendMessage,
  cancelInvitation,
  changeCapabilityGovernanceState,
  changeProductPartner,
  closeRequirementsAssuranceFinding,
  createCapabilityEligibility,
  createCapabilityRelease,
  createInvitation,
  createProject,
  getCurrentIdentityWithToken,
  grantCapabilityPopulationMembership,
  refreshCapabilityEstateFromEcc,
  revokeCapabilityEligibility,
  revokeCapabilityPopulationMembership,
  revokeCapabilityRelease,
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
  runRequirementsAssurance,
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
  uploadStudioInteractionArtifact,
  type AIConnectionShareMode,
  type KnowledgeStatus,
  type OrganisationRole,
  type ProductPartner,
  type ProjectRole,
} from '../lib/api';
import { parseAIConnectionDateTime } from '../lib/ai-connection-datetime';
import {
  assertStudioArtifactBytes,
  assertStudioArtifactCount,
  assertStudioArtifactSourceKind,
  normalizeStudioSelectionValue,
  studioArtifactKindForMediaType,
} from '../lib/studio-composer';


function required(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function studioFiles(formData: FormData, key: string): File[] {
  return formData.getAll(key).filter(
    (value): value is File => value instanceof File && value.size > 0 && value.name.trim() !== '',
  );
}

function requiredNumber(formData: FormData, key: string): number {
  const value = Number(required(formData, key));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
}

async function setPlatformSession(token: string, expiresAt: string): Promise<void> {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(expiresAt),
  });
}

async function setAuthenticatedSession(
  token: string,
  expiresAt: string,
  organisationId: string,
): Promise<void> {
  await setPlatformSession(token, expiresAt);
  const cookieStore = await cookies();
  cookieStore.set(ORGANISATION_COOKIE, organisationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
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
  if (!organisation && identity.platformRole === 'admin') {
    await setPlatformSession(login.token, login.expiresAt);
    redirect('/admin/capabilities');
  }
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
  const uploadedFiles = studioFiles(formData, 'artifacts');
  const screenshotFiles = studioFiles(formData, 'screenshots');
  const voiceValue = formData.get('voice');
  const voiceFile = voiceValue instanceof File && voiceValue.size > 0 && voiceValue.name.trim() !== ''
    ? voiceValue : null;
  const prepared = [
    ...uploadedFiles.map((file) => ({
      file, kind: studioArtifactKindForMediaType(file.type), source: 'upload' as const,
    })),
    ...screenshotFiles.map((file) => ({
      file, kind: studioArtifactKindForMediaType(file.type), source: 'screenshot' as const,
    })),
    ...(voiceFile === null ? [] : [{
      file: voiceFile,
      kind: studioArtifactKindForMediaType(voiceFile.type),
      source: 'microphone' as const,
    }]),
  ];
  assertStudioArtifactCount(prepared.length);
  assertStudioArtifactBytes(prepared.reduce((total, item) => total + item.file.size, 0));
  for (const item of prepared) assertStudioArtifactSourceKind(item.source, item.kind);

  const artifactIds: string[] = [];
  for (const item of prepared) {
    const artifact = await uploadStudioInteractionArtifact(projectId, {
      data: await item.file.arrayBuffer(),
      kind: item.kind,
      source: item.source,
      mediaType: item.file.type.toLowerCase(),
    });
    artifactIds.push(artifact.id);
  }

  const agentId = normalizeStudioSelectionValue(formData.get('agentId'));
  const harnessId = normalizeStudioSelectionValue(formData.get('harnessId'));
  const modelRouteId = normalizeStudioSelectionValue(formData.get('modelRouteId'));
  await sendProductPartnerTurn(projectId, required(formData, 'content'), {
    ...(agentId === undefined ? {} : { agentId }),
    ...(harnessId === undefined ? {} : { harnessId }),
    ...(modelRouteId === undefined ? {} : { modelRouteId }),
    ...(artifactIds.length === 0 ? {} : { artifactIds }),
  });
  revalidatePath('/');
  revalidatePath(`/projects/${projectId}`);
  // Failed extraction state is reconstructible from durable studio.latestFailedExtractionRun
  // on the next render — no redirect-only query params.
}

export async function runRequirementsAssuranceAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const reviewerRouteId = normalizeStudioSelectionValue(formData.get('reviewerRouteId'));
  await runRequirementsAssurance(projectId, reviewerRouteId);
  revalidatePath(`/projects/${projectId}`);
}

export async function closeRequirementsAssuranceFindingAction(formData: FormData) {
  const projectId = required(formData, 'projectId');
  const findingId = required(formData, 'findingId');
  const status = required(formData, 'status');
  if (status !== 'resolved' && status !== 'dismissed') {
    throw new Error('status must be resolved or dismissed');
  }
  await closeRequirementsAssuranceFinding(projectId, findingId, {
    status,
    resolutionNote: required(formData, 'resolutionNote'),
  });
  revalidatePath(`/projects/${projectId}`);
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
// The parser lives in ../lib/ai-connection-datetime.ts so it can be unit-tested
// independently of Next.js server-action wiring and of the hosting TZ.
function optionalIsoDate(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    return parseAIConnectionDateTime(raw);
  } catch {
    throw new Error(`${key} must be a valid ISO date`);
  }
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
  // Initial sharing is deliberately a bare Online Only operation. Usage-window
  // policy is a separate owner action after the share exists.
  await shareAIConnectionWithProject({ projectId, connectionId });
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

export async function refreshCapabilityEstateAction() {
  await refreshCapabilityEstateFromEcc();
  revalidatePath('/admin/capabilities');
}

export async function changeCapabilityGovernanceStateAction(formData: FormData) {
  await changeCapabilityGovernanceState(
    required(formData, 'capabilityId'),
    required(formData, 'governanceState'),
  );
  revalidatePath('/admin/capabilities');
}
export async function createCapabilityReleaseAction(formData: FormData) {
  const capabilityId = required(formData, 'capabilityId');
  const input: Record<string, string> = { scope: required(formData, 'scope') };
  const organisationId = String(formData.get('organisationId') ?? '').trim();
  if (organisationId) input.organisationId = organisationId;
  for (const key of ['projectId', 'projectRole', 'teamId', 'cohortId', 'userId']) {
    const value = String(formData.get(key) ?? '').trim();
    if (value) input[key] = value;
  }
  await createCapabilityRelease(capabilityId, input);
  revalidatePath('/admin/capabilities');
}

export async function revokeCapabilityReleaseAction(formData: FormData) {
  const organisationId = String(formData.get('organisationId') ?? '').trim();
  await revokeCapabilityRelease(
    required(formData, 'capabilityId'),
    required(formData, 'releaseId'),
    required(formData, 'platformScoped') === 'true',
    organisationId || undefined,
  );
  revalidatePath('/admin/capabilities');
}
export async function createCapabilityEligibilityAction(formData: FormData) {
  const capabilityId = required(formData, 'capabilityId');
  const input: Record<string, string> = {
    organisationId: required(formData, 'organisationId'),
    scope: required(formData, 'scope'),
    decision: required(formData, 'decision'),
  };
  for (const key of ['projectId', 'projectRole', 'teamId', 'cohortId', 'userId']) {
    const value = String(formData.get(key) ?? '').trim();
    if (value) input[key] = value;
  }
  await createCapabilityEligibility(capabilityId, input);
  revalidatePath('/admin/capabilities');
}

export async function revokeCapabilityEligibilityAction(formData: FormData) {
  await revokeCapabilityEligibility(
    required(formData, 'capabilityId'),
    required(formData, 'policyId'),
    required(formData, 'organisationId'),
  );
  revalidatePath('/admin/capabilities');
}

export async function grantCapabilityPopulationMembershipAction(formData: FormData) {
  await grantCapabilityPopulationMembership({
    organisationId: required(formData, 'organisationId'),
    kind: required(formData, 'kind') as 'team' | 'cohort',
    populationId: required(formData, 'populationId'),
    userId: required(formData, 'userId'),
  });
  revalidatePath('/admin/capabilities');
}

export async function revokeCapabilityPopulationMembershipAction(formData: FormData) {
  await revokeCapabilityPopulationMembership({
    organisationId: required(formData, 'organisationId'),
    kind: required(formData, 'kind') as 'team' | 'cohort',
    populationId: required(formData, 'populationId'),
    userId: required(formData, 'userId'),
  });
  revalidatePath('/admin/capabilities');
}
