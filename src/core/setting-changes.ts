import { normalizeEntityKey, normalizeText, STORAGE_ROOT, type EntityMeta } from '@/core/entity-store';

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

function saveManualOperations(operations: SettingChangeOperation[]) {
  const validated = SettingChangeOperationsResponse.parse(operations);
  window.TavernHelper.updateVariablesWith(
    variables => {
      // 即使为空也保留初始化标记，避免自动生成的记录被误迁移为手动覆盖。
      _.set(variables, SETTING_CHANGE_MANUAL_OPERATIONS_PATH, validated);
      return variables;
    },
    { type: 'chat' },
  );
}

function getManualOperations(changes: SettingChange[]): SettingChangeOperation[] {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  if (_.has(variables, SETTING_CHANGE_MANUAL_OPERATIONS_PATH)) {
    const result = SettingChangeOperationsResponse.safeParse(_.get(variables, SETTING_CHANGE_MANUAL_OPERATIONS_PATH));
    if (result.success) {
      return result.data;
    }

    console.warn('[CosmosMemory] 存储的设定变更手动操作格式异常，已按空操作处理', result.error);
    saveManualOperations([]);
    return [];
  }

  // 1.3.1 只支持手动记录：首次启用自动维护时把已有条目迁移为手动覆盖，避免重建后丢失。
  const migrated_operations = changes.map<SettingChangeOperation>(change => ({
    type: 'set',
    key: change.id,
    content: change.content,
  }));
  saveManualOperations(migrated_operations);
  return migrated_operations;
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

function replayManualOperations(
  record: Map<string, SettingChange>,
  manual_operations: SettingChangeOperation[],
  updated_at = new Date().toISOString(),
) {
  applyOperationsToRecord(record, manual_operations, { updated_at });
}

function removeManualOperationsSupersededByAutomaticChanges(
  manual_operations: SettingChangeOperation[],
  automatic_operations: SettingChangeOperation[],
): SettingChangeOperation[] {
  const touched_keys = new Set(
    automatic_operations
      .filter(operation => operation.type === 'delete' || Boolean(normalizeText(operation.content)))
      .map(operation => normalizeKey(operation.key)),
  );
  return manual_operations.filter(operation => !touched_keys.has(normalizeKey(operation.key)));
}

export function getSettingChanges(): SettingChange[] {
  return readSettingChanges();
}

/**
 * 增量应用一条新摘要提取出的自动操作。
 * 手动修正会覆盖此前的自动结果；若后续剧情再次明确改变同一 key，则新的自动操作按时间顺序接管，
 * 并清理该 key 的旧手动覆盖，避免未来 rebuild 时把角色恢复到过时状态。
 */
export function applySettingChangeOperations(
  operations: SettingChangeOperation[],
  meta: EntityMeta = {},
): SettingChange[] {
  const changes = readSettingChanges();
  const manual_operations = getManualOperations(changes);
  const remaining_manual_operations = removeManualOperationsSupersededByAutomaticChanges(manual_operations, operations);
  const record = changesToRecord(changes);
  applyOperationsToRecord(record, operations, meta);
  replayManualOperations(record, remaining_manual_operations);
  saveManualOperations(remaining_manual_operations);
  const next_changes = recordToChanges(record);
  saveSettingChanges(next_changes);
  return next_changes;
}

/** 按现存摘要全量重放，供编辑、删楼、Swipe 和记忆修复回滚自动变更。 */
export function rebuildSettingChangesFromSummaries(summaries: SummaryWithSettingChangeOperations[]): SettingChange[] {
  const stored_changes = readSettingChanges();
  const manual_operations = getManualOperations(stored_changes);
  const record = new Map<string, SettingChange>();

  for (const summary of summaries) {
    applyOperationsToRecord(record, summary.setting_change_operations ?? [], {
      source_message_id: summary.message_id,
      updated_at: summary.updated_at,
    });
  }

  replayManualOperations(record, manual_operations);
  const changes = recordToChanges(record);
  saveSettingChanges(changes);
  return changes;
}

function applyManualOperation(operation: SettingChangeOperation): SettingChange[] {
  const changes = readSettingChanges();
  const manual_operations = getManualOperations(changes);
  const record = changesToRecord(changes);
  applyOperationsToRecord(record, [operation], { updated_at: new Date().toISOString() });
  saveManualOperations([...manual_operations, operation]);
  const next_changes = recordToChanges(record);
  saveSettingChanges(next_changes);
  return next_changes;
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
