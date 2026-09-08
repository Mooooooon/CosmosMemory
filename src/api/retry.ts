import { DEFAULT_AI_RETRY_COUNT, MAX_AI_RETRY_COUNT, type AiSettings } from '@/type/settings';

const RETRY_DELAY_MS = 1000;

/** 一次 attempt 包含请求和结果校验；重试次数不包含首次请求。 */
export async function retryAiRequest<T>(
  settings: AiSettings,
  attempt: (retry_index: number) => Promise<T>,
  should_cancel?: () => boolean,
): Promise<T> {
  const retry_count = Number.isFinite(settings.retry_count)
    ? Math.min(MAX_AI_RETRY_COUNT, Math.max(1, Math.floor(settings.retry_count)))
    : DEFAULT_AI_RETRY_COUNT;

  for (let retry_index = 0; ; retry_index++) {
    if (should_cancel?.()) {
      throw new DOMException(t`AI 请求已取消。`, 'AbortError');
    }

    try {
      const result = await attempt(retry_index);
      if (should_cancel?.()) {
        throw new DOMException(t`AI 请求已取消。`, 'AbortError');
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const is_aborted = error instanceof Error && error.name === 'AbortError';
      const is_auth_error =
        /\b(?:401|403)\b|unauthorized|forbidden|invalid[_ ]?api[_ ]?key|incorrect[_ ]?api[_ ]?key|authentication|鉴权/i.test(
          message,
        );
      if (should_cancel?.() || is_aborted || is_auth_error || !settings.retry_enabled || retry_index >= retry_count) {
        throw error;
      }

      // 不记录请求参数或原始错误内容，避免端点错误回显密钥。
      console.warn('[CosmosMemory] AI 请求失败，准备重试', { retry: retry_index + 1, retry_count });
      toastr.info(`${t`AI 请求失败或返回内容无效，正在重试…`} (${retry_index + 1}/${retry_count})`);
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      // 等待期间关闭开关时，不再发送下一次请求，并保留最后一次失败原因。
      if (!settings.retry_enabled || should_cancel?.()) {
        throw error;
      }
    }
  }
}
