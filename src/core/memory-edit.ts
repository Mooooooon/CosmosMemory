import { requestMemoryEdit } from '@/api/memory-edit';
import { getStoredCharacters, manualApplyCharacterOperation } from '@/core/characters';
import { getStoredItems, manualApplyItemOperation } from '@/core/items';
import { getStoredLocations, manualApplyLocationOperation } from '@/core/locations';
import { getStoredCurrentInfo, manualSaveCurrentInfo } from '@/core/current-info';
import { getSettingChanges, manualApplySettingChangeOperation } from '@/core/setting-changes';
import { getMemoryInstructions, saveMemoryInstructions } from '@/core/memory-instructions';
import { STORAGE_ROOT } from '@/core/entity-store';
import { isCosmosMemoryMessage } from '@/core/message-flags';
import { triggerUpdateStatusBar } from '@/core/status-bar';
import { MemoryEditResponse, type MemoryEditResult } from '@/type/memory-edit';
import type { Settings } from '@/type/settings';
import { getCurrentChatId } from '@sillytavern/script';
import { getFloorBinding, isFloorBindingActive, type FloorBinding } from '@/core/floor-history';

const RECENT_MESSAGE_COUNT = 6;
type EditTask = { generation_id: string; cancelled: boolean };
type EditPreview = { chat_id: string; binding: FloorBinding; baseline: unknown; result: MemoryEditResult };
let active_task: EditTask | null = null;
export const is_editing_memory = ref(false);
export const memory_edit_preview = ref<EditPreview | null>(null);
export const memory_edit_revision = ref(0);

function getMemorySnapshot(): unknown {
  return klona(_.get(window.TavernHelper.getVariables({ type: 'chat' }), STORAGE_ROOT));
}

function assertChat(): string {
  if (!window.TavernHelper) throw new Error(t`酒馆助手尚未就绪。`);
  const chat_id = getCurrentChatId();
  if (!chat_id) throw new Error(t`请先打开一个聊天。`);
  return chat_id;
}

export function stopMemoryEdit() {
  if (!active_task) return;
  active_task.cancelled = true;
  window.TavernHelper.stopGenerationById(active_task.generation_id);
}

export function resetMemoryEditForChatChange() {
  stopMemoryEdit();
  memory_edit_preview.value = null;
  memory_edit_revision.value++;
}

export async function generateMemoryEdit(request: string, settings: Settings): Promise<boolean> {
  if (active_task) throw new Error(t`已有记忆修改请求正在进行。`);
  if (!request.trim()) throw new Error(t`请填写修改要求。`);
  const chat_id = assertChat();
  const binding = getFloorBinding();
  const baseline = getMemorySnapshot();
  const last_message_id = window.TavernHelper.getLastMessageId();
  const recent_messages =
    last_message_id < 0
      ? []
      : window.TavernHelper.getChatMessages(
          `${Math.max(0, last_message_id - RECENT_MESSAGE_COUNT + 1)}-${last_message_id}`,
          { hide_state: 'unhidden', include_swipes: false },
        )
          .filter(message => message.role !== 'system' && !isCosmosMemoryMessage(message) && message.message.trim())
          .map(message => ({
            message_id: message.message_id,
            role: message.role,
            name: message.name,
            content: message.message,
          }));
  const context = {
    characters: getStoredCharacters(),
    items: getStoredItems(),
    locations: getStoredLocations(),
    current_info: getStoredCurrentInfo(),
    setting_changes: getSettingChanges(),
    instructions: getMemoryInstructions(),
    enabled: {
      characters: settings.characters.enabled,
      items: settings.items.enabled,
      locations: settings.locations.enabled,
      current_info: settings.current_info.enabled,
      setting_changes: settings.setting_changes.enabled,
    },
    recent_messages,
  };
  const request_id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const task: EditTask = { generation_id: `cosmos-memory-edit-${request_id}`, cancelled: false };
  active_task = task;
  is_editing_memory.value = true;
  memory_edit_preview.value = null;
  try {
    const result = await requestMemoryEdit(settings.ai, request.trim(), context, {
      generation_id: task.generation_id,
      should_cancel: () =>
        task.cancelled ||
        getCurrentChatId() !== chat_id ||
        !isFloorBindingActive(binding) ||
        window.TavernHelper.getLastMessageId() !== binding.message_id,
    });
    if (task.cancelled || getCurrentChatId() !== chat_id || !_.isEqual(binding, getFloorBinding())) return false;
    if (!_.isEqual(baseline, getMemorySnapshot()) || !_.isEqual(binding, getFloorBinding()))
      throw new Error(t`聊天记忆已变化，请重新生成修改预览。`);
    memory_edit_preview.value = { chat_id, binding, baseline, result };
    return true;
  } catch (error) {
    if (
      task.cancelled ||
      getCurrentChatId() !== chat_id ||
      !isFloorBindingActive(binding) ||
      window.TavernHelper.getLastMessageId() !== binding.message_id
    )
      return false;
    console.error('[CosmosMemory] 模型记忆修改失败');
    throw error;
  } finally {
    active_task = null;
    is_editing_memory.value = false;
  }
}

export function applyMemoryEditPreview() {
  const preview = memory_edit_preview.value;
  if (!preview) throw new Error(t`请先生成修改预览。`);
  if (
    assertChat() !== preview.chat_id ||
    !_.isEqual(preview.baseline, getMemorySnapshot()) ||
    !_.isEqual(preview.binding, getFloorBinding())
  ) {
    memory_edit_preview.value = null;
    throw new Error(t`聊天记忆已变化，请重新生成修改预览。`);
  }
  const result = MemoryEditResponse.parse(preview.result);
  const backup = getMemorySnapshot();
  try {
    result.character_operations.forEach(manualApplyCharacterOperation);
    result.item_operations.forEach(manualApplyItemOperation);
    result.location_operations.forEach(manualApplyLocationOperation);
    result.setting_change_operations.forEach(manualApplySettingChangeOperation);
    if (result.current_info !== null) manualSaveCurrentInfo(result.current_info);
    if (result.instructions !== null) saveMemoryInstructions(result.instructions);
  } catch (error) {
    // 同步应用过程中失败时恢复本插件的数据及手动操作日志，保留其他扩展变量。
    window.TavernHelper.updateVariablesWith(
      variables => {
        if (backup === undefined) _.unset(variables, STORAGE_ROOT);
        else _.set(variables, STORAGE_ROOT, backup);
        return variables;
      },
      { type: 'chat' },
    );
    console.error('[CosmosMemory] 应用记忆修改失败，已恢复原数据');
    throw error;
  }
  memory_edit_preview.value = null;
  memory_edit_revision.value++;
  triggerUpdateStatusBar();
}
