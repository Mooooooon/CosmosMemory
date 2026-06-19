import { getStoredMessageSummaries, type MessageSummary } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';

const SUMMARY_PROMPT_ID_PREFIX = 'cosmos_memory_summary_';
const MESSAGE_DATA_PATH = 'cosmos_memory';
const HIDDEN_BY_COMPRESSION_PATH = `${MESSAGE_DATA_PATH}.hidden_by_compression`;

let injected_summary_prompt_ids: string[] = [];

type CompressionResult = {
  hidden_message_ids: number[];
  restored_message_ids: number[];
  injected_summary_ids: number[];
  skipped_without_summary_ids: number[];
};

function isCosmosMemoryMessage(message: ChatMessage): boolean {
  return _.get(message.data, `${MESSAGE_DATA_PATH}.kind`) === 'summary';
}

function isHiddenByCompression(message: ChatMessage): boolean {
  return _.get(message.data, HIDDEN_BY_COMPRESSION_PATH) === true;
}

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

function clearInjectedSummaryPrompts() {
  if (injected_summary_prompt_ids.length === 0) {
    return;
  }

  window.TavernHelper.uninjectPrompts(injected_summary_prompt_ids);
  injected_summary_prompt_ids = [];
}

function buildSummaryPromptContent(summary: MessageSummary): string {
  return summary.summary;
}

function injectSummariesForHiddenMessages(messages: ChatMessage[], summaries: Map<number, MessageSummary>): number[] {
  clearInjectedSummaryPrompts();

  const last_message_id = window.TavernHelper.getLastMessageId();
  const prompts = messages
    .map(message => {
      const summary = summaries.get(message.message_id);
      if (!summary) {
        return null;
      }

      const id = `${SUMMARY_PROMPT_ID_PREFIX}${message.message_id}`;
      return {
        id,
        position: 'in_chat' as const,
        depth: Math.max(0, last_message_id - message.message_id),
        role: 'assistant' as const,
        content: buildSummaryPromptContent(summary),
      };
    })
    .filter((prompt): prompt is NonNullable<typeof prompt> => prompt !== null);

  if (prompts.length === 0) {
    return [];
  }

  injected_summary_prompt_ids = prompts.map(prompt => prompt.id);
  window.TavernHelper.injectPrompts(prompts, { once: true });
  return messages.map(message => message.message_id);
}

export async function applySummaryCompressionForNextGeneration(): Promise<CompressionResult> {
  const assistant_messages = getOriginalAssistantMessages();
  const retained_count = getRetainedOriginalAssistantCount();
  const compressible_messages =
    retained_count === 0 ? assistant_messages : assistant_messages.slice(0, -retained_count);
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

  for (const message of assistant_messages) {
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

  const injected_summary_ids = injectSummariesForHiddenMessages(messages_to_hide, summaries);

  console.info('[CosmosMemory] 已应用生成前摘要压缩', {
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
