import {
  canRecallCollaborativeMemory,
  type CollaborativeMemoryRecord,
  type MemoryAccessContext,
  type MemoryVisibility,
} from '@engineering-os/domain';

export type MemoryVisibilityDecision =
  | { allowed: true; reason: MemoryInclusionReason }
  | { allowed: false; reason: 'policy_denied' };

export type MemoryInclusionReason =
  | 'session_private_owner'
  | 'workstream_shared'
  | 'project_shared'
  | 'organisation_shared'
  | 'reviewer_private_owner'
  | 'adjudication_shared'
  | 'user_private_owner';

export interface ContextSelectionOptions {
  maxItems: number;
  maxBytes: number;
}

export interface SelectedMemoryContextItem {
  memoryId: string;
  reason: MemoryInclusionReason;
  record: CollaborativeMemoryRecord;
}

export type ExcludedMemoryContextItem =
  | { reason: 'policy_denied' }
  | { memoryId: string; reason: 'budget_exceeded' };
const INCLUSION_REASON_BY_VISIBILITY: Record<MemoryVisibility, MemoryInclusionReason> = {
  session_private: 'session_private_owner',
  workstream_shared: 'workstream_shared',
  project_shared: 'project_shared',
  organisation_shared: 'organisation_shared',
  reviewer_private: 'reviewer_private_owner',
  adjudication_shared: 'adjudication_shared',
  user_private: 'user_private_owner',
};

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

export function resolveMemoryVisibility(
  record: CollaborativeMemoryRecord,
  context: MemoryAccessContext,
): MemoryVisibilityDecision {
  if (!canRecallCollaborativeMemory(record, context)) {
    return { allowed: false, reason: 'policy_denied' };
  }
  return { allowed: true, reason: INCLUSION_REASON_BY_VISIBILITY[record.visibility] };
}

export function selectCollaborativeContext(
  records: readonly CollaborativeMemoryRecord[],
  context: MemoryAccessContext,
  options: ContextSelectionOptions,
): { items: SelectedMemoryContextItem[]; excluded: ExcludedMemoryContextItem[]; totalBytes: number } {
  const maxItems = requirePositiveInteger(options.maxItems, 'maxItems');
  const maxBytes = requirePositiveInteger(options.maxBytes, 'maxBytes');  const items: SelectedMemoryContextItem[] = [];
  const excluded: ExcludedMemoryContextItem[] = [];
  let totalBytes = 0;

  for (const record of records) {
    const visibility = resolveMemoryVisibility(record, context);
    if (!visibility.allowed) {
      excluded.push({ reason: 'policy_denied' });
      continue;
    }

    const item: SelectedMemoryContextItem = {
      memoryId: record.id,
      reason: visibility.reason,
      record,
    };
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (items.length >= maxItems || totalBytes + itemBytes > maxBytes) {
      excluded.push({ memoryId: record.id, reason: 'budget_exceeded' });
      continue;
    }

    items.push(item);
    totalBytes += itemBytes;
  }

  return { items, excluded, totalBytes };
}
