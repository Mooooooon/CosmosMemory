import { normalizeEntityKey, normalizeText, STORAGE_ROOT, type EntityMeta } from '@/core/entity-store';
import { defineFloorHistory, getFloorBinding, replayFloorTimeline } from '@/core/floor-history';

const SETTING_CHANGE_STORAGE_PATH = `${STORAGE_ROOT}.setting_changes`;
const SETTING_CHANGE_MANUAL_OPERATIONS_PATH = `${STORAGE_ROOT}.setting_changes_manual_ops`;
export const SETTING_CHANGE_PROMPT_ID = 'cosmos_memory_setting_changes';
/** 设定变更需要覆盖原始人设，因此放在其他运行时记忆之前。 */
export const SETTING_CHANGE_PROMPT_DEPTH = 10003;
export const SETTING_CHANGE_MAX_LENGTH = 500;

export type SettingChangeOperationType = 'add' | 'set' | 'delete';

export type SettingChangeOperation = {
  type: SettingChangeOperationType;
  /** 稳定的“角色/属性”键，例如“林秋/年级”，用于后续成长时覆盖旧状态。 */
  key: string;
  /** 当前有效事实；delete 操作时为空字符串。 */
  content: string;
};

export type SettingChange = {
  /** 与自动操作 key 相同；手动新增记录使用独立 UUID。 */
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  source_message_id?: number;
};

export const SettingChangeOperationResponse = z.object({
  type: z.enum(['add', 'set', 'delete']),
  key: z.string().trim().min(1),
  content: z.string().trim().max(SETTING_CHANGE_MAX_LENGTH).default(''),
});

export const SettingChangeOperationsResponse = z.array(SettingChangeOperationResponse).default([]);

const SettingChangeResponse = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1).max(SETTING_CHANGE_MAX_LENGTH),
  created_at: z.string(),
  updated_at: z.string(),
  source_message_id: z.number().int().optional(),
});

const SettingChangesResponse = z.array(SettingChangeResponse);
const history = defineFloorHistory(SETTING_CHANGE_MANUAL_OPERATIONS_PATH, SettingChangeOperationResponse);

type SummaryWithSettingChangeOperations = {
  message_id?: number;
  updated_at?: string;
  setting_change_operations?: SettingChangeOperation[];
};

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `setting-change-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeKey(key: string): string {
  return normalizeEntityKey(key);
}

function readSettingChanges(): SettingChange[] {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const stored = _.get(variables, SETTING_CHANGE_STORAGE_PATH, []);
  const result = SettingChangesResponse.safeParse(stored);
  if (result.success) {
    return result.data;
  }

  if (stored !== undefined && (!Array.isArray(stored) || stored.length > 0)) {
    console.warn('[CosmosMemory] 存储的设定变更格式异常，已忽略无效记录', result.error);
  }

  if (!Array.isArray(stored)) {
    return [];
  }

  return stored.flatMap(value => {
    const entry = SettingChangeResponse.safeParse(value);
    return entry.success ? [entry.data] : [];
  });
}

function saveSettingChanges(changes: SettingChange[]) {
  const validated = SettingChangesResponse.parse(changes);
  window.TavernHelper.updateVariablesWith(
    variables => {
      if (validated.length > 0) {
        _.set(variables, SETTING_CHANGE_STORAGE_PATH, validated);
      } else {
        _.unset(variables, SETTING_CHANGE_STORAGE_PATH);
      }
      return variables;
    },
    { type: 'chat' },
  );
}

function changesToRecord(changes: SettingChange[]): Map<string, SettingChange> {
  return new Map(changes.map(change => [normalizeKey(change.id), change]));
}

function applyOperationsToRecord(
  record: Map<string, SettingChange>,
  operations: SettingChangeOperation[],
  meta: EntityMeta = {},
) {
  const fallback_time = meta.updated_at ?? new Date().toISOString();
  for (const operation of SettingChangeOperationsResponse.parse(operations)) {
    const key = normalizeKey(operation.key);
    if (!key) {
      continue;
    }

    if (operation.type === 'delete') {
      record.delete(key);
      continue;
    }

    const content = normalizeText(operation.content);
    if (!content) {
      continue;
    }

    const existing = record.get(key);
    record.set(key, {
      id: key,
      content,
      created_at: existing?.created_at ?? fallback_time,
      updated_at: fallback_time,
      ...(meta.source_message_id !== undefined ? { source_message_id: meta.source_message_id } : {}),
    });
  }
}

function recordToChanges(record: Map<string, SettingChange>): SettingChange[] {
  return [...record.values()].sort(
    (left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );
}

export function getSettingChanges(): SettingChange[] {
  return readSettingChanges();
}

/**
 * 增量应用一条新摘要提取出的自动操作。
 * 后续剧情自然接管先前状态；保留完整手动日志，以便回到先前楼层时恢复。
 */
export function applySettingChangeOperations(
  operations: SettingChangeOperation[],
  meta: EntityMeta = {},
): SettingChange[] {
  const changes = readSettingChanges();
  const record = changesToRecord(changes);
  applyOperationsToRecord(record, operations, meta);
  const next_changes = recordToChanges(record);
  saveSettingChanges(next_changes);
  return next_changes;
}

/** 按现存摘要全量重放，供编辑、删楼、Swipe 和记忆修复回滚自动变更。 */
export function getSettingChangesAtMessage(
  summaries: SummaryWithSettingChangeOperations[],
  max_message_id?: number,
): SettingChange[] {
  const record = new Map<string, SettingChange>();
  replayFloorTimeline(
    summaries,
    history.active(max_message_id),
    summary => summary.message_id ?? -1,
    summary =>
      applyOperationsToRecord(record, summary.setting_change_operations ?? [], {
        source_message_id: summary.message_id,
        updated_at: summary.updated_at,
      }),
    edit =>
      applyOperationsToRecord(record, [edit.value], {
        source_message_id: edit.message_id,
        updated_at: edit.updated_at,
      }),
    max_message_id,
  );
  return recordToChanges(record);
}

export function rebuildSettingChangesFromSummaries(
  summaries: SummaryWithSettingChangeOperations[],
  max_message_id?: number,
): SettingChange[] {
  const changes = getSettingChangesAtMessage(summaries, max_message_id);
  saveSettingChanges(changes);
  return changes;
}

function applyManualOperation(operation: SettingChangeOperation): SettingChange[] {
  const changes = readSettingChanges();
  const binding = getFloorBinding();
  const record = changesToRecord(changes);
  applyOperationsToRecord(record, [operation], {
    source_message_id: binding.message_id,
    updated_at: new Date().toISOString(),
  });
  history.append(operation, binding);
  const next_changes = recordToChanges(record);
  saveSettingChanges(next_changes);
  return next_changes;
}

export function manualApplySettingChangeOperation(operation: SettingChangeOperation): SettingChange[] {
  return applyManualOperation(SettingChangeOperationResponse.parse(operation));
}

export function addSettingChange(content: string): SettingChange[] {
  return applyManualOperation({
    type: 'set',
    key: `manual:${createId()}`,
    content: normalizeText(content),
  });
}

export function updateSettingChange(id: string, content: string): SettingChange[] {
  const normalized_id = normalizeKey(id);
  if (!readSettingChanges().some(change => normalizeKey(change.id) === normalized_id)) {
    throw new Error(t`要编辑的设定变更已不存在。`);
  }

  return applyManualOperation({
    type: 'set',
    key: normalized_id,
    content: normalizeText(content),
  });
}

export function deleteSettingChange(id: string): SettingChange[] {
  const normalized_id = normalizeKey(id);
  if (!readSettingChanges().some(change => normalizeKey(change.id) === normalized_id)) {
    throw new Error(t`要删除的设定变更已不存在。`);
  }

  return applyManualOperation({ type: 'delete', key: normalized_id, content: '' });
}

export function formatSettingChangesForPrompt(changes: SettingChange[] = getSettingChanges()): string {
  if (changes.length === 0) {
    return '';
  }

  return [
    '[CosmosMemory 设定变更]',
    '以下内容是剧情发展后当前有效的设定，优先级高于角色卡、玩家人设、世界书等原始设定。',
    '若与原始设定冲突，以这里记录的最新状态为准；自然地延续这些变化，不要让角色退回旧状态。',
    ...changes.map(change => `- ${change.content}`),
    '[/CosmosMemory 设定变更]',
  ].join('\n');
}

/** 总结模型需要看到稳定 key，才能在再次成长时 set 覆盖旧记录而不是不断追加。 */
export function formatSettingChangesForSummaryRequest(changes: SettingChange[] = getSettingChanges()): string {
  if (changes.length === 0) {
    return ['[CosmosMemory 已有设定变更]', '暂无记录。', '[/CosmosMemory 已有设定变更]'].join('\n');
  }

  return [
    '[CosmosMemory 已有设定变更]',
    ...changes.map(change => `- key="${change.id}"：${change.content}`),
    '[/CosmosMemory 已有设定变更]',
  ].join('\n');
}
