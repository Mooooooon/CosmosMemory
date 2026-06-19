import { summarizeMessage } from '@/api/ai';
import { useSettingsStore } from '@/store/settings';

const STORAGE_ROOT = 'cosmos_memory';
const SUMMARY_STORAGE_PATH = `${STORAGE_ROOT}.summaries`;

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

export async function summarizeReceivedMessage(message_id: number): Promise<MessageSummary | null> {
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
