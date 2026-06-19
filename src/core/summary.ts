import { summarizeMessage } from '@/api/ai';
import { useSettingsStore } from '@/store/settings';

const STORAGE_ROOT = 'cosmos_memory';
const SUMMARY_STORAGE_PATH = `${STORAGE_ROOT}.summaries`;

const summarizing_messages = new Map<number, Promise<MessageSummary | null>>();

export type MessageSummary = {
  message_id: number;
  summary: string;
  updated_at: string;
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

function getMissingAssistantMessageIds(): number[] {
  const stored_summary_ids = getStoredSummaryIds();
  return window.TavernHelper.getChatMessages('0-{{lastMessageId}}', {
    role: 'assistant',
    include_swipes: false,
  })
    .filter(message => !stored_summary_ids.has(message.message_id))
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
    .sort((left, right) => left.message_id - right.message_id);
}

async function summarizeReceivedMessageCore(message_id: number): Promise<MessageSummary | null> {
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
  });
  const summary: MessageSummary = {
    message_id,
    summary: await summarizeMessage(settings.ai, source),
    updated_at: new Date().toISOString(),
  };

  saveMessageSummary(summary);
  return summary;
}

export function summarizeReceivedMessage(message_id: number): Promise<MessageSummary | null> {
  const existing_task = summarizing_messages.get(message_id);
  if (existing_task) {
    console.info('[CosmosMemory] 复用正在进行的楼层总结任务', { message_id });
    return existing_task;
  }

  const task = summarizeReceivedMessageCore(message_id).finally(() => {
    summarizing_messages.delete(message_id);
  });

  summarizing_messages.set(message_id, task);
  return task;
}

export async function summarizeMissingAssistantMessages(): Promise<MessageSummary[]> {
  const message_ids = getMissingAssistantMessageIds();
  if (message_ids.length === 0) {
    console.info('[CosmosMemory] 发送前检查完成，没有缺失总结的 assistant 楼层');
    return [];
  }

  console.info('[CosmosMemory] 发送前发现缺失总结的 assistant 楼层，开始依次补全', {
    message_ids,
    count: message_ids.length,
  });

  const summaries: MessageSummary[] = [];
  for (const message_id of message_ids) {
    console.info('[CosmosMemory] 发送前补全楼层总结', { message_id });
    const summary = await summarizeReceivedMessage(message_id);
    if (summary) {
      summaries.push(summary);
    }
  }

  console.info('[CosmosMemory] 发送前缺失总结补全完成', {
    requested_count: message_ids.length,
    summarized_count: summaries.length,
  });

  return summaries;
}
