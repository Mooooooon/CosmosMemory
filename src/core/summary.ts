import { summarizeMessage, type SummaryContextEntry } from '@/api/ai';
import {
  CharacterOperationsResponse,
  applyCharacterOperations,
  getStoredCharacters,
  rebuildStoredCharactersFromSummaries,
  type CharacterOperation,
} from '@/core/characters';
import {
  ItemOperationsResponse,
  applyItemOperations,
  getStoredItems,
  rebuildStoredItemsFromSummaries,
  type ItemOperation,
} from '@/core/items';
import {
  LocationOperationsResponse,
  applyLocationOperations,
  getStoredLocations,
  rebuildStoredLocationsFromSummaries,
  type LocationOperation,
} from '@/core/locations';
import {
  CurrentInfoUpdateResponse,
  applyCurrentInfoUpdate,
  getStoredCurrentInfo,
  rebuildStoredCurrentInfoFromSummaries,
  type CurrentInfoUpdate,
} from '@/core/current-info';
import { STORAGE_ROOT } from '@/core/entity-store';
import { useSettingsStore } from '@/store/settings';
import { getCurrentChatId } from '@sillytavern/script';

const SUMMARY_STORAGE_PATH = `${STORAGE_ROOT}.summaries`;
const SUMMARY_BACKFILL_CONCURRENCY = 2;

type SummarizingTask = {
  promise: Promise<MessageSummary | null>;
  generation_id: string;
};

const summarizing_messages = new Map<number, SummarizingTask>();
const cancelled_message_ids = new Set<number>();
let backfill_abort_signal: { aborted: boolean } | null = null;

export type MessageSummary = {
  message_id: number;
  summary: string;
  character_operations?: CharacterOperation[];
  item_operations?: ItemOperation[];
  location_operations?: LocationOperation[];
  current_info_update?: CurrentInfoUpdate | null;
  updated_at: string;
};

export type MemoryBacktrackCheckOptions = {
  max_message_id?: number;
};

export type MemoryBacktrackCheckResult = {
  max_message_id: number;
  removed_summaries: MessageSummary[];
  summarized_summaries: MessageSummary[];
  rebuilt: boolean;
  aborted: boolean;
};

function getAssistantMessage(message_id: number): ChatMessage | null {
  const message = window.TavernHelper.getChatMessages(message_id, { include_swipes: false })[0];
  if (!message) {
    console.info('[CosmosMemory] 未找到消息楼层', { message_id });
    return null;
  }

  if (message.role !== 'assistant') {
    console.info('[CosmosMemory] 跳过非 assistant 消息', { message_id, role: message.role });
    return null;
  }

  console.info('[CosmosMemory] 获取到 assistant 消息', {
    message_id,
    content_length: message.message.length,
    is_hidden: message.is_hidden,
  });
  return message;
}

function getRegexedAiContent(message: ChatMessage): string {
  const regexed_content = window.TavernHelper.formatAsTavernRegexedString(message.message, 'ai_output', 'prompt', {
    depth: 0,
  }).trim();

  console.info('[CosmosMemory] 完成酒馆正则过滤', {
    message_id: message.message_id,
    original_length: message.message.length,
    regexed_length: regexed_content.length,
  });

  return regexed_content;
}

function getPreviousSummaryContext(message_id: number, count: number): SummaryContextEntry[] {
  if (count <= 0) {
    return [];
  }

  return getStoredMessageSummaries()
    .filter(summary => summary.message_id < message_id)
    .slice(-count)
    .map(summary => ({
      message_id: summary.message_id,
      summary: summary.summary,
    }));
}

function saveMessageSummary(summary: MessageSummary) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      _.set(variables, `${SUMMARY_STORAGE_PATH}.${summary.message_id}`, summary);
      return variables;
    },
    { type: 'chat' },
  );
  console.info('[CosmosMemory] 已写入聊天变量', {
    path: `${SUMMARY_STORAGE_PATH}.${summary.message_id}`,
    message_id: summary.message_id,
  });
}

function getStoredSummaryIds(): Set<number> {
  return new Set(getStoredMessageSummaries().map(summary => summary.message_id));
}

function getExistingChatMessages(max_message_id: number): ChatMessage[] {
  return window.TavernHelper.getChatMessages('0-{{lastMessageId}}', {
    include_swipes: false,
  }).filter(message => message.message_id <= max_message_id);
}

function getCurrentLastMessageId(): number {
  return window.TavernHelper.getChatMessages('0-{{lastMessageId}}', {
    include_swipes: false,
  }).reduce((max_message_id, message) => Math.max(max_message_id, message.message_id), -1);
}

function getMissingAssistantMessageIds(max_message_id: number): number[] {
  const stored_summary_ids = getStoredSummaryIds();
  return getExistingChatMessages(max_message_id)
    .filter(message => message.role === 'assistant' && !stored_summary_ids.has(message.message_id))
    .map(message => message.message_id);
}

export function getStoredMessageSummaries(): MessageSummary[] {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const summaries = _.get(variables, SUMMARY_STORAGE_PATH, {}) as Record<string, MessageSummary>;

  return Object.values(summaries)
    .filter((summary): summary is MessageSummary => {
      return (
        typeof summary === 'object' &&
        summary !== null &&
        typeof summary.message_id === 'number' &&
        typeof summary.summary === 'string'
      );
    })
    .map(summary => {
      const character_operations = CharacterOperationsResponse.safeParse(summary.character_operations);
      const item_operations = ItemOperationsResponse.safeParse(summary.item_operations);
      const location_operations = LocationOperationsResponse.safeParse(summary.location_operations);
      const current_info_update = CurrentInfoUpdateResponse.nullable()
        .optional()
        .safeParse(summary.current_info_update);
      return {
        ...summary,
        character_operations: character_operations.success ? character_operations.data : [],
        item_operations: item_operations.success ? item_operations.data : [],
        location_operations: location_operations.success ? location_operations.data : [],
        current_info_update: current_info_update.success ? current_info_update.data : null,
      };
    })
    .sort((left, right) => left.message_id - right.message_id);
}

function rebuildMemoryFromSummaries(summaries: MessageSummary[]) {
  rebuildStoredCharactersFromSummaries(summaries);
  rebuildStoredItemsFromSummaries(summaries);
  rebuildStoredLocationsFromSummaries(summaries);
  rebuildStoredCurrentInfoFromSummaries(summaries);
}

function pruneInvalidMessageSummaries(
  max_message_id: number,
  existing_assistant_message_ids: Set<number>,
): MessageSummary[] {
  const removed_summaries: MessageSummary[] = [];

  window.TavernHelper.updateVariablesWith(
    variables => {
      const summaries = _.get(variables, SUMMARY_STORAGE_PATH, {}) as Record<string, MessageSummary>;
      for (const [key, summary] of Object.entries(summaries)) {
        if (
          typeof summary === 'object' &&
          summary !== null &&
          typeof summary.message_id === 'number' &&
          (summary.message_id > max_message_id || !existing_assistant_message_ids.has(summary.message_id))
        ) {
          removed_summaries.push(summary);
          _.unset(variables, `${SUMMARY_STORAGE_PATH}.${key}`);
        }
      }

      return variables;
    },
    { type: 'chat' },
  );

  return removed_summaries.sort((left, right) => left.message_id - right.message_id);
}

export function pruneMessageSummariesAfterMessage(message_id: number): MessageSummary[] {
  const existing_assistant_message_ids = new Set(
    getExistingChatMessages(message_id)
      .filter(message => message.role === 'assistant')
      .map(message => message.message_id),
  );
  const removed_summaries = pruneInvalidMessageSummaries(message_id, existing_assistant_message_ids);

  if (removed_summaries.length > 0) {
    console.info('[CosmosMemory] 已清理高于当前发送楼层的悬空总结', {
      current_message_id: message_id,
      removed_message_ids: removed_summaries.map(summary => summary.message_id),
    });
    rebuildMemoryFromSummaries(getStoredMessageSummaries());
  }

  return removed_summaries;
}

function safeGetCurrentChatId(): string | null {
  try {
    return getCurrentChatId() || null;
  } catch (error) {
    console.warn('[CosmosMemory] 获取当前聊天 ID 失败', error);
    return null;
  }
}

async function summarizeReceivedMessageCore(message_id: number, generation_id: string): Promise<MessageSummary | null> {
  const chat_id = safeGetCurrentChatId();

  const message = getAssistantMessage(message_id);
  if (!message) {
    return null;
  }

  const source = getRegexedAiContent(message);
  if (!source) {
    console.info('[CosmosMemory] 正则过滤后的内容为空，跳过总结', { message_id });
    return null;
  }

  const { settings } = useSettingsStore();
  console.info('[CosmosMemory] 开始请求 AI 总结', {
    message_id,
    use_tavern_api: settings.ai.use_tavern_api,
    custom_api_url: settings.ai.use_tavern_api ? undefined : settings.ai.custom_api_url,
    selected_model: settings.ai.use_tavern_api ? undefined : settings.ai.selected_model,
    characters_enabled: settings.characters.enabled,
    items_enabled: settings.items.enabled,
    locations_enabled: settings.locations.enabled,
    current_info_enabled: settings.current_info.enabled,
    send_descriptions_and_world_info: settings.summary.send_descriptions_and_world_info,
    send_summary_context: settings.summary.send_summary_context,
    summary_context_count: settings.summary.summary_context_count,
  });
  const previous_summaries = settings.summary.send_summary_context
    ? getPreviousSummaryContext(message_id, settings.summary.summary_context_count)
    : [];
  const result = await summarizeMessage(settings.ai, source, {
    characters_enabled: settings.characters.enabled,
    stored_characters: settings.characters.enabled ? getStoredCharacters() : [],
    items_enabled: settings.items.enabled,
    stored_items: settings.items.enabled ? getStoredItems() : [],
    locations_enabled: settings.locations.enabled,
    stored_locations: settings.locations.enabled ? getStoredLocations() : [],
    current_info_enabled: settings.current_info.enabled,
    current_info: settings.current_info.enabled ? getStoredCurrentInfo() : undefined,
    send_descriptions_and_world_info: settings.summary.send_descriptions_and_world_info,
    previous_summaries,
    generation_id,
    should_cancel: () => cancelled_message_ids.has(message_id),
  });

  // 异步请求期间任务可能被手动停止：直接丢弃结果，不再写入变量
  if (cancelled_message_ids.has(message_id)) {
    console.info('[CosmosMemory] 总结任务已被取消，丢弃总结结果', { message_id });
    return null;
  }

  // 异步请求期间用户可能切换了聊天：此时写入会污染新聊天的变量，直接丢弃结果
  if (safeGetCurrentChatId() !== chat_id) {
    console.warn('[CosmosMemory] 总结完成时聊天已切换，丢弃总结结果', { message_id, chat_id });
    return null;
  }

  const summary: MessageSummary = {
    message_id,
    summary: result.summary,
    character_operations: settings.characters.enabled ? result.characters : [],
    item_operations: settings.items.enabled ? result.item_operations : [],
    location_operations: settings.locations.enabled ? result.location_operations : [],
    current_info_update: settings.current_info.enabled ? (result.current_info_update ?? null) : null,
    updated_at: new Date().toISOString(),
  };

  // swipe / regenerate / continue 会覆盖同楼层旧摘要：旧摘要派生的实体变更必须回滚，
  // 因此覆盖时按现存摘要全量重放，而不是增量应用新摘要的操作
  const had_previous_summary = getStoredSummaryIds().has(message_id);
  saveMessageSummary(summary);
  if (had_previous_summary) {
    console.info('[CosmosMemory] 同楼层旧摘要已被覆盖，重建记忆以回滚旧分支变更', { message_id });
    rebuildMemoryFromSummaries(getStoredMessageSummaries());
  } else {
    const entity_meta = { source_message_id: message_id, updated_at: summary.updated_at };
    if (settings.characters.enabled && summary.character_operations && summary.character_operations.length > 0) {
      applyCharacterOperations(summary.character_operations, entity_meta);
    }
    if (settings.items.enabled && summary.item_operations && summary.item_operations.length > 0) {
      applyItemOperations(summary.item_operations, entity_meta);
    }
    if (settings.locations.enabled && summary.location_operations && summary.location_operations.length > 0) {
      applyLocationOperations(summary.location_operations, entity_meta);
    }
    if (settings.current_info.enabled) {
      applyCurrentInfoUpdate(summary.current_info_update);
    }
  }
  return summary;
}

export function summarizeReceivedMessage(message_id: number): Promise<MessageSummary | null> {
  const existing_task = summarizing_messages.get(message_id);
  if (existing_task) {
    console.info('[CosmosMemory] 复用正在进行的楼层总结任务', { message_id });
    return existing_task.promise;
  }

  cancelled_message_ids.delete(message_id);
  const generation_id = `cosmos-memory-summary-${message_id}-${Date.now()}`;
  const promise = summarizeReceivedMessageCore(message_id, generation_id).finally(() => {
    summarizing_messages.delete(message_id);
  });

  summarizing_messages.set(message_id, { promise, generation_id });
  return promise;
}

/** 停止所有进行中的总结请求，并标记中止当前的补全循环 */
export function stopSummarizeTasks() {
  if (backfill_abort_signal) {
    backfill_abort_signal.aborted = true;
  }

  for (const [message_id, task] of summarizing_messages) {
    cancelled_message_ids.add(message_id);
    try {
      window.TavernHelper.stopGenerationById(task.generation_id);
    } catch (error) {
      console.warn('[CosmosMemory] 停止总结请求失败', { message_id, error });
    }
  }
  summarizing_messages.clear();
}

/** 聊天切换时调用：取消未完成的总结任务，防止结果写入新聊天 */
export function cancelSummarizationForChatChange() {
  if (summarizing_messages.size === 0 && backfill_abort_signal === null) {
    return;
  }

  console.info('[CosmosMemory] 聊天已切换，取消未完成的总结任务', { pending_count: summarizing_messages.size });
  stopSummarizeTasks();
}

export function wasSummarizeTaskCancelled(message_id: number): boolean {
  return cancelled_message_ids.has(message_id);
}

/** 取消指定楼层正在进行的总结任务（编辑楼层后，基于旧内容的任务结果必须丢弃） */
function cancelSummarizeTask(message_id: number) {
  const task = summarizing_messages.get(message_id);
  if (!task) {
    return;
  }

  cancelled_message_ids.add(message_id);
  try {
    window.TavernHelper.stopGenerationById(task.generation_id);
  } catch (error) {
    console.warn('[CosmosMemory] 停止总结请求失败', { message_id, error });
  }
  summarizing_messages.delete(message_id);
}

function deleteMessageSummary(message_id: number) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      _.unset(variables, `${SUMMARY_STORAGE_PATH}.${message_id}`);
      return variables;
    },
    { type: 'chat' },
  );
}

/**
 * 楼层内容被编辑后调用：取消基于旧内容的进行中任务、删除旧摘要、
 * 全量重放剩余摘要（回滚旧摘要的实体变更），最后基于新内容重新总结。
 * 没有摘要的楼层（如保留窗口内的近期楼层）不受影响。
 */
export async function invalidateAndResummarizeMessage(message_id: number): Promise<MessageSummary | null> {
  if (!getStoredSummaryIds().has(message_id)) {
    return null;
  }

  console.info('[CosmosMemory] 楼层内容已被编辑，旧摘要失效，回滚其变更后重新总结', { message_id });
  cancelSummarizeTask(message_id);
  deleteMessageSummary(message_id);
  rebuildMemoryFromSummaries(getStoredMessageSummaries());
  return summarizeReceivedMessage(message_id);
}

async function backfillMissingSummaries(
  message_ids: number[],
): Promise<{ summaries: MessageSummary[]; aborted: boolean }> {
  const abort_signal = { aborted: false };
  backfill_abort_signal = abort_signal;

  toastr.info(`${t`Cosmos Memory 正在补全缺失的剧情总结，请稍候…`}（${message_ids.length}）`);

  const summaries: MessageSummary[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < message_ids.length && !abort_signal.aborted) {
      const message_id = message_ids[cursor];
      cursor += 1;
      console.info('[CosmosMemory] 补全楼层总结', { message_id });
      try {
        const summary = await summarizeReceivedMessage(message_id);
        if (summary) {
          summaries.push(summary);
        }
      } catch (error) {
        // 单个楼层失败（包含被手动停止）不应阻断整体补全
        console.warn('[CosmosMemory] 补全楼层总结失败，跳过该楼层', { message_id, error });
      }
    }
  };

  try {
    const worker_count = Math.min(SUMMARY_BACKFILL_CONCURRENCY, message_ids.length);
    await Promise.all(Array.from({ length: worker_count }, () => worker()));
  } finally {
    if (backfill_abort_signal === abort_signal) {
      backfill_abort_signal = null;
    }
  }

  // 并发补全时实体变更可能乱序应用，最后按楼层顺序全量重放一次保证一致性
  if (summaries.length > 0) {
    rebuildMemoryFromSummaries(getStoredMessageSummaries());
  }

  console.info('[CosmosMemory] 缺失总结补全结束', {
    requested_count: message_ids.length,
    summarized_count: summaries.length,
    aborted: abort_signal.aborted,
  });

  return { summaries, aborted: abort_signal.aborted };
}

export async function summarizeMissingAssistantMessages(): Promise<MessageSummary[]> {
  const message_ids = getMissingAssistantMessageIds(getCurrentLastMessageId());
  if (message_ids.length === 0) {
    console.info('[CosmosMemory] 发送前检查完成，没有缺失总结的 assistant 楼层');
    return [];
  }

  console.info('[CosmosMemory] 发送前发现缺失总结的 assistant 楼层，开始补全', {
    message_ids,
    count: message_ids.length,
  });

  const { summaries } = await backfillMissingSummaries(message_ids);
  return summaries;
}

export async function runMemoryBacktrackCheck(
  options: MemoryBacktrackCheckOptions = {},
): Promise<MemoryBacktrackCheckResult> {
  const max_message_id = options.max_message_id ?? getCurrentLastMessageId();
  if (max_message_id < 0) {
    console.info('[CosmosMemory] 回溯检查完成，当前聊天没有可检查楼层');
    return {
      max_message_id,
      removed_summaries: [],
      summarized_summaries: [],
      rebuilt: false,
      aborted: false,
    };
  }

  const existing_messages = getExistingChatMessages(max_message_id);
  const existing_assistant_message_ids = new Set(
    existing_messages.filter(message => message.role === 'assistant').map(message => message.message_id),
  );

  console.info('[CosmosMemory] 开始回溯检查记忆', {
    max_message_id,
    existing_assistant_message_ids: [...existing_assistant_message_ids],
  });

  const removed_summaries = pruneInvalidMessageSummaries(max_message_id, existing_assistant_message_ids);
  if (removed_summaries.length > 0) {
    console.info('[CosmosMemory] 回溯检查已清理悬空总结', {
      max_message_id,
      removed_message_ids: removed_summaries.map(summary => summary.message_id),
    });
  }

  const rebuilt = removed_summaries.length > 0;
  if (rebuilt) {
    rebuildMemoryFromSummaries(getStoredMessageSummaries());
  }

  const missing_message_ids = getMissingAssistantMessageIds(max_message_id);
  if (missing_message_ids.length === 0) {
    console.info('[CosmosMemory] 回溯检查完成，没有缺失总结的 assistant 楼层');
    return {
      max_message_id,
      removed_summaries,
      summarized_summaries: [],
      rebuilt,
      aborted: false,
    };
  }

  console.info('[CosmosMemory] 回溯检查发现缺失总结的 assistant 楼层，开始补全', {
    max_message_id,
    message_ids: missing_message_ids,
    count: missing_message_ids.length,
  });

  const { summaries: summarized_summaries, aborted } = await backfillMissingSummaries(missing_message_ids);

  console.info('[CosmosMemory] 回溯检查完成', {
    max_message_id,
    removed_count: removed_summaries.length,
    summarized_count: summarized_summaries.length,
    rebuilt,
    aborted,
  });

  return {
    max_message_id,
    removed_summaries,
    summarized_summaries,
    rebuilt,
    aborted,
  };
}
