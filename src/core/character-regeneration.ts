import { extractCharactersFromChatContent } from '@/api/ai';
import { replaceStoredCharacters, type StoredCharacter } from '@/core/characters';
import type { AiSettings } from '@/type/settings';

const MESSAGE_DATA_PATH = 'cosmos_memory';

function isCosmosMemoryMessage(message: ChatMessage): boolean {
  return _.get(message.data, `${MESSAGE_DATA_PATH}.kind`) === 'summary';
}

function getAssistantChatContent(): string {
  const messages = window.TavernHelper.getChatMessages('0-{{lastMessageId}}', {
    role: 'assistant',
    include_swipes: false,
  })
    .filter(message => !isCosmosMemoryMessage(message))
    .map(message => {
      const content = message.message.trim();
      if (!content) {
        return '';
      }

      return `楼层 #${message.message_id}\n${content}`;
    })
    .filter(Boolean);

  return messages.join('\n\n---\n\n');
}

export async function regenerateCharactersFromChat(settings: AiSettings): Promise<StoredCharacter[]> {
  const content = getAssistantChatContent();
  if (!content) {
    throw new Error('当前聊天没有可用于生成人物信息的 AI 回复。');
  }

  const characters = await extractCharactersFromChatContent(settings, content);
  return replaceStoredCharacters(characters);
}
