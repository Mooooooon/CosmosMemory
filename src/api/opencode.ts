import { getCurrentChatId, getRequestHeaders } from '@sillytavern/script';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { stringify } from 'yaml';

export const OPENCODE_API_SOURCE = 'opencode';
export const OPENCODE_GO_API_URL = 'https://opencode.ai/inference/go/openai/v1';
const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/inference/go/v1';
const SESSION_STORAGE_PATH = 'cosmos_memory.opencode_session';
const Session = z.object({ chat_id: z.string(), id: z.uuid() });
let standalone_session: string | undefined;

/** 会话标识随聊天保存；复制为新聊天时重新分配，无聊天时使用本页面的测试会话。 */
function getSessionId(): string {
  const chat_id = getCurrentChatId();
  if (!chat_id) return (standalone_session ??= uuidv4());

  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const stored = Session.safeParse(_.get(variables, SESSION_STORAGE_PATH));
  if (stored.success && stored.data.chat_id === chat_id) return stored.data.id;

  const session = { chat_id, id: uuidv4() };
  window.TavernHelper.updateVariablesWith(
    current => {
      _.set(current, SESSION_STORAGE_PATH, session);
      return current;
    },
    { type: 'chat' },
  );
  return session.id;
}

/** 经酒馆后端发送，避免浏览器覆盖 User-Agent；显式覆盖鉴权，避免继承酒馆全局密钥。 */
export function buildOpenCodeHeaders(key: string): Record<string, string> {
  if (!key.trim()) throw new Error(t`请先填写 OpenCode Go 密钥。`);
  return {
    Authorization: `Bearer ${key.trim()}`,
    'User-Agent': `CosmosMemory/${__COSMOS_MEMORY_VERSION__}`,
    'x-opencode-session': getSessionId(),
  };
}

/** getModelList 未暴露请求头能力，使用酒馆同一模型列表转发端点。 */
export async function fetchOpenCodeModelNames(key: string): Promise<string[]> {
  const response = await fetch('/api/backends/chat-completions/status', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      chat_completion_source: 'custom',
      custom_url: OPENCODE_GO_MODELS_URL,
      custom_include_headers: stringify(buildOpenCodeHeaders(key)),
    }),
    cache: 'no-cache',
  });
  if (!response.ok) throw new Error(t`OpenCode Go 模型列表获取失败。` + ` (HTTP ${response.status})`);

  const invalid_response_message = t`OpenCode Go 模型列表无效或为空，请检查密钥和套餐状态。`;
  const payload: unknown = await response.json().catch(() => {
    throw new Error(invalid_response_message);
  });
  const result = z
    .object({ data: z.array(z.object({ id: z.string().trim().min(1) })).min(1), error: z.never().optional() })
    .safeParse(payload);
  // 不展示服务端原文，避免错误响应回显鉴权信息。
  if (!result.success) throw new Error(invalid_response_message);
  return [...new Set(result.data.data.map(model => model.id))].sort((left, right) => left.localeCompare(right));
}
