import {
  HIDDEN_BY_COMPRESSION_PATH,
  isCosmosMemoryMessage,
  isExcludedFromMemory,
  isHiddenByCompression,
} from '@/core/message-flags';
import { getValidSummaryRollups, type SummaryRollupSegment } from '@/core/summary-rollup';
import { getStoredMessageSummaries, OPENING_MESSAGE_ID, type MessageSummary } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';
import { isOpeningMessageCompressionEnabled } from '@/type/settings';

const SUMMARY_PROMPT_ID = 'cosmos_memory_summary';

let uninject_summary_prompt: (() => void) | undefined;

type CompressionResult = {
  hidden_message_ids: number[];
  restored_message_ids: number[];
  injected_summary_ids: number[];
  skipped_without_summary_ids: number[];
};

function cloneMessageData(message: ChatMessage): Record<string, any> {
  return _.cloneDeep(message.data ?? {});
}

function getOriginalAssistantMessages(): ChatMessage[] {
  return window.TavernHelper.getChatMessages('0-{{lastMessageId}}', {
    role: 'assistant',
    include_swipes: false,
  }).filter(message => !isCosmosMemoryMessage(message));
}

function getSummaryByMessageId(): Map<number, MessageSummary> {
  return new Map(getStoredMessageSummaries().map(summary => [summary.message_id, summary]));
}

function getRetainedOriginalAssistantCount(): number {
  const { settings } = useSettingsStore();
  const count = settings.compression.retained_original_assistant_messages;
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 5;
}

export function clearInjectedSummaryPrompts() {
  uninject_summary_prompt?.();
  uninject_summary_prompt = undefined;
}

/**
 * 将全部摘要合并为一条注入内容：
 * - 只在开头说明一次这是总结内容，避免每个楼层重复一遍提示；
 * - 已被前情分段覆盖的楼层用对应分段文章替代；
 * - 分段文章和未合并的逐楼摘要统一按来源楼层排序，保持剧情时间线。
 */
function buildCombinedSummaryPromptContent(summaries: MessageSummary[], rollups: SummaryRollupSegment[]): string {
  const covered_ids = new Set(rollups.flatMap(rollup => rollup.sources.map(source => source.message_id)));
  const sections = [
    ...rollups.map(rollup => ({ message_id: rollup.sources[0]!.message_id, content: rollup.article })),
    ...summaries
      .filter(summary => !covered_ids.has(summary.message_id))
      .map(summary => ({ message_id: summary.message_id, content: summary.summary })),
  ]
    .sort((left, right) => left.message_id - right.message_id)
    .map(section => section.content);

  return [
    '[CosmosMemory 前情摘要] 以下是对此前被压缩隐藏的早期剧情的总结，属于前情提要而非当前对话内容：',
    sections.join('\n\n'),
    '[/CosmosMemory 前情摘要]',
  ].join('\n');
}

function injectSummariesForHiddenMessages(
  messages: ChatMessage[],
  summaries: Map<number, MessageSummary>,
  signal: AbortSignal,
): number[] {
  clearInjectedSummaryPrompts();

  // messages 按楼层升序传入，过滤后仍保持时间顺序
  const ordered_summaries = messages
    .map(message => summaries.get(message.message_id))
    .filter((summary): summary is MessageSummary => summary !== undefined);
  if (ordered_summaries.length === 0) {
    return [];
  }

  // 每个前情分段独立判断：只有该段覆盖的楼层全部处于注入集合内时才使用它；
  // 否则该段退回逐楼摘要，避免与仍在上下文中的原文重复。
  const stored_rollups = getValidSummaryRollups();
  const injected_ids = new Set(ordered_summaries.map(summary => summary.message_id));
  const rollups = stored_rollups.filter(rollup => rollup.sources.every(source => injected_ids.has(source.message_id)));

  // 合并为一条提示词，注入到最旧一条摘要所在楼层的深度，让前情摘要整体出现在保留楼层原文之前
  const last_message_id = window.TavernHelper.getLastMessageId();
  const depth = Math.max(0, last_message_id - ordered_summaries[0].message_id);

  uninject_summary_prompt = window.TavernHelper.injectPrompts(
    [
      {
        id: SUMMARY_PROMPT_ID,
        position: 'in_chat' as const,
        depth,
        role: 'system' as const,
        content: buildCombinedSummaryPromptContent(ordered_summaries, rollups),
        filter: () => !signal.aborted,
      },
    ],
    { once: true },
  ).uninject;
  return ordered_summaries.map(summary => summary.message_id);
}

export async function applySummaryCompressionForNextGeneration(enabled: boolean = true): Promise<CompressionResult> {
  const { settings, getRunSignal } = useSettingsStore();
  const signal = getRunSignal();
  if (signal.aborted) {
    return {
      hidden_message_ids: [],
      restored_message_ids: [],
      injected_summary_ids: [],
      skipped_without_summary_ids: [],
    };
  }
  const assistant_messages = getOriginalAssistantMessages();
  const retained_count = getRetainedOriginalAssistantCount();
  const allow_opening = isOpeningMessageCompressionEnabled(settings);

  // 压缩候选楼层：如果不包括开场白，开场白楼层不参与压缩
  const memory_messages = assistant_messages.filter(message => !isExcludedFromMemory(message));
  const candidates_for_compression = allow_opening
    ? memory_messages
    : memory_messages.filter(message => message.message_id !== OPENING_MESSAGE_ID);

  // 压缩关闭时不隐藏任何楼层，但恢复逻辑照常执行，会把之前压缩隐藏的楼层恢复原文
  const compressible_messages =
    !enabled || settings.summary_paused
      ? []
      : retained_count === 0
        ? candidates_for_compression
        : candidates_for_compression.slice(0, -retained_count);
  const summaries = getSummaryByMessageId();
  const skipped_without_summary_ids = compressible_messages
    .filter(message => !summaries.has(message.message_id))
    .map(message => message.message_id);
  const messages_to_hide = compressible_messages.filter(message => {
    if (!summaries.has(message.message_id)) {
      return false;
    }

    return !message.is_hidden || isHiddenByCompression(message);
  });
  const messages_to_hide_ids = new Set(messages_to_hide.map(message => message.message_id));
  const updates: Array<{ message_id: number; is_hidden: boolean; data: Record<string, any> }> = [];
  const hidden_message_ids: number[] = [];
  const restored_message_ids: number[] = [];

  // 临时关闭期间只注入已有摘要，跳过隐藏和恢复楼层。
  for (const message of settings.summary_paused ? [] : assistant_messages) {
    const should_hide = messages_to_hide_ids.has(message.message_id);
    if (should_hide && !message.is_hidden) {
      const data = cloneMessageData(message);
      _.set(data, HIDDEN_BY_COMPRESSION_PATH, true);
      updates.push({ message_id: message.message_id, is_hidden: true, data });
      hidden_message_ids.push(message.message_id);
      continue;
    }

    if (!should_hide && isHiddenByCompression(message)) {
      const data = cloneMessageData(message);
      _.unset(data, HIDDEN_BY_COMPRESSION_PATH);
      updates.push({ message_id: message.message_id, is_hidden: false, data });
      restored_message_ids.push(message.message_id);
    }
  }

  if (updates.length > 0) {
    await window.TavernHelper.setChatMessages(updates, { refresh: 'affected' });
  }

  // 注入对象 = 生成时处于隐藏状态且有摘要的全部楼层（含用户手动隐藏的楼层），
  // 排除刚刚被恢复为未隐藏的楼层，避免其在内存对象上残留旧的 is_hidden 状态导致误注入
  const restored_ids_set = new Set(restored_message_ids);
  const messages_to_inject = memory_messages.filter(message => {
    if (!summaries.has(message.message_id)) {
      return false;
    }

    if (restored_ids_set.has(message.message_id)) {
      return false;
    }

    return message.is_hidden || messages_to_hide_ids.has(message.message_id);
  });
  const injected_summary_ids = signal.aborted
    ? []
    : injectSummariesForHiddenMessages(messages_to_inject, summaries, signal);

  console.info('[CosmosMemory] 已应用生成前摘要压缩', {
    enabled,
    retained_count,
    assistant_count: assistant_messages.length,
    hidden_message_ids,
    restored_message_ids,
    injected_summary_ids,
    skipped_without_summary_ids,
  });

  return {
    hidden_message_ids,
    restored_message_ids,
    injected_summary_ids,
    skipped_without_summary_ids,
  };
}
