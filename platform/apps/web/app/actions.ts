'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
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
  reviseKnowledge,
  revokeOrganisationAccess,
  revokeProjectAccess,
  sendProductPartnerTurn,
  SESSION_COOKIE,
  setInvitationPolicy,
  setUserStatus,
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
