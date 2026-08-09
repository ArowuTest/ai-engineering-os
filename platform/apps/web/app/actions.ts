'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addKnowledge,
  appendMessage,
  changeProductPartner,
  createProject,
  reviseKnowledge,
  type KnowledgeStatus,
  type ProductPartner,
} from '../lib/api';

function required(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
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
