import { normalizeText, STORAGE_ROOT } from '@/core/entity-store';

const SETTING_CHANGE_STORAGE_PATH = `${STORAGE_ROOT}.setting_changes`;
export const SETTING_CHANGE_PROMPT_ID = 'cosmos_memory_setting_changes';
/** 设定变更需要覆盖原始人设，因此放在其他运行时记忆之前。 */
export const SETTING_CHANGE_PROMPT_DEPTH = 10003;
export const SETTING_CHANGE_MAX_LENGTH = 500;

export type SettingChange = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

const SettingChangeResponse = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1).max(SETTING_CHANGE_MAX_LENGTH),
  created_at: z.string(),
  updated_at: z.string(),
});

const SettingChangesResponse = z.array(SettingChangeResponse);

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `setting-change-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

export function getSettingChanges(): SettingChange[] {
  return readSettingChanges();
}

export function addSettingChange(content: string): SettingChange[] {
  const normalized_content = normalizeText(content);
  const now = new Date().toISOString();
  const entry = SettingChangeResponse.parse({
    id: createId(),
    content: normalized_content,
    created_at: now,
    updated_at: now,
  });
  const changes = [...readSettingChanges(), entry];
  saveSettingChanges(changes);
  return changes;
}

export function updateSettingChange(id: string, content: string): SettingChange[] {
  const normalized_id = normalizeText(id);
  const normalized_content = normalizeText(content);
  const changes = readSettingChanges();
  const index = changes.findIndex(change => change.id === normalized_id);
  if (index < 0) {
    throw new Error(t`要编辑的设定变更已不存在。`);
  }

  changes[index] = SettingChangeResponse.parse({
    ...changes[index],
    content: normalized_content,
    updated_at: new Date().toISOString(),
  });
  saveSettingChanges(changes);
  return changes;
}

export function deleteSettingChange(id: string): SettingChange[] {
  const normalized_id = normalizeText(id);
  const changes = readSettingChanges();
  const next_changes = changes.filter(change => change.id !== normalized_id);
  if (next_changes.length === changes.length) {
    throw new Error(t`要删除的设定变更已不存在。`);
  }

  saveSettingChanges(next_changes);
  return next_changes;
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
