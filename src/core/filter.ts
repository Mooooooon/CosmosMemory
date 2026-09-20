import { getTokenCountAsync } from '@sillytavern/scripts/tokenizers';
import { type FilterSettings } from '@/type/settings';
import { useSettingsStore } from '@/store/settings';

export type FilterCheckResult = {
  filtered: boolean;
  reason?: string;
  count?: number;
  unit?: 'token' | 'char';
};

export type AutoRetryResult = {
  retried: boolean;
  attempt?: number;
  max_retries?: number;
};

export const SERVER_ERROR_PATTERNS: RegExp[] = [
  /failed to load resource/i,
  /status of 500/i,
  /status 500/i,
  /internal server error/i,
  /500\s+internal\s+server\s+error/i,
  /502\s+bad\s+gateway/i,
  /503\s+service\s+unavailable/i,
  /504\s+gateway\s+timeout/i,
  /server responded with a status of (?:5\d\d|429)/i,
  /got response status (?:5\d\d|429)/i,
  /failed to fetch/i,
  /text generation error/i,
  /st server cannot be reached/i,
  /econnreset/i,
  /etimedout/i,
];

let current_retry_count = 0;
let pending_retry_timeout: ReturnType<typeof setTimeout> | null = null;
let is_generation_active = false;
let active_generation_type: string | null = null;
let last_generation_started_at = 0;
let was_generation_stopped_by_user = false;
let last_failure_retry_timestamp = 0;
let is_interceptors_registered = false;

export function setGenerationActive(active: boolean, type?: string): void {
  is_generation_active = active;
  if (active) {
    active_generation_type = type ?? 'normal';
    last_generation_started_at = Date.now();
    was_generation_stopped_by_user = false;
  } else {
    active_generation_type = null;
  }
}

export function markGenerationStoppedByUser(): void {
  was_generation_stopped_by_user = true;
  is_generation_active = false;
  active_generation_type = null;
  cancelPendingAutoRetry();
}

export function isGenerationActive(): boolean {
  return is_generation_active;
}

export function extractErrorSummary(error_text: string): string {
  const text = (error_text || '').trim();
  if (!text) return t`未知服务器错误`;

  if (/status of 500|500\s+internal\s+server\s+error|internal server error/i.test(text)) {
    return '500 Internal Server Error';
  }
  if (/502\s+bad\s+gateway|bad gateway/i.test(text)) {
    return '502 Bad Gateway';
  }
  if (/503\s+service\s+unavailable|service unavailable/i.test(text)) {
    return '503 Service Unavailable';
  }
  if (/504\s+gateway\s+timeout|gateway timeout/i.test(text)) {
    return '504 Gateway Timeout';
  }
  if (/429|rate limit/i.test(text)) {
    return '429 Rate Limit';
  }
  if (/failed to fetch/i.test(text)) {
    return t`网络请求失败 (Failed to fetch)`;
  }
  if (/failed to load resource/i.test(text)) {
    return 'Failed to load resource (500)';
  }

  return text.length > 35 ? `${text.slice(0, 35)}...` : text;
}

export function handleGenerationError(error_text: string, title?: string): boolean {
  const { settings } = useSettingsStore();
  if (!settings.filter.enabled || !settings.filter.auto_retry) {
    return false;
  }

  // 忽略 Cosmos Memory 自身弹出的通知
  if (
    (typeof title === 'string' && title.includes('Cosmos Memory')) ||
    (typeof error_text === 'string' && error_text.includes('Cosmos Memory'))
  ) {
    return false;
  }

  // 用户主动中止时不重试
  if (was_generation_stopped_by_user) {
    return false;
  }

  // 检查是否正在或刚刚在进行非 quiet 消息生成
  const now = Date.now();
  const is_recent_generation = is_generation_active || now - last_generation_started_at < 5000;
  if (!is_recent_generation || active_generation_type === 'quiet') {
    return false;
  }

  const full_text = `${title ?? ''} ${error_text ?? ''}`.trim();
  if (!full_text) {
    return false;
  }

  // 鉴权类错误不重试（如 Key 错误或未授权）
  const is_auth_error =
    /\b(?:401|403)\b|unauthorized|forbidden|invalid[_ ]?api[_ ]?key|incorrect[_ ]?api[_ ]?key|authentication|鉴权/i.test(
      full_text,
    );
  if (is_auth_error) {
    return false;
  }

  // 匹配是否为服务器或网络报错
  const is_server_error = SERVER_ERROR_PATTERNS.some(pattern => pattern.test(full_text));
  if (!is_server_error) {
    return false;
  }

  // 防抖：2 秒内不重复触发同一失败重试
  if (now - last_failure_retry_timestamp < 2000 || pending_retry_timeout !== null) {
    return false;
  }
  last_failure_retry_timestamp = now;

  const max_retries = settings.filter.max_retries;
  if (current_retry_count < max_retries) {
    current_retry_count++;
    const attempt = current_retry_count;
    const reason_summary = extractErrorSummary(full_text);
    console.info(
      `[CosmosMemory] 检测到生成服务器报错，触发自动重试 (${attempt}/${max_retries})，报错: ${reason_summary}`,
    );

    if (typeof toastr !== 'undefined') {
      const message = t`生成报错（{reason}），正在自动重试 ({attempt}/{max})...`
        .replace('{reason}', reason_summary)
        .replace('{attempt}', String(attempt))
        .replace('{max}', String(max_retries));
      toastr.info(message, t`Cosmos Memory 自动重试`);
    }

    cancelPendingAutoRetry();
    // 服务器错误等待 1000ms 让服务端缓冲
    pending_retry_timeout = setTimeout(async () => {
      pending_retry_timeout = null;
      try {
        await triggerRegenerate();
      } catch (error) {
        console.error('[CosmosMemory] 自动触发重新生成失败', error);
        if (typeof toastr !== 'undefined') {
          toastr.error(error instanceof Error ? error.message : String(error), t`Cosmos Memory 自动重试失败`);
        }
      }
    }, 1000);

    return true;
  }

  console.warn(`[CosmosMemory] 连续自动重试已达最大上限 (${max_retries})，停止重试`);
  if (typeof toastr !== 'undefined') {
    const reason_summary = extractErrorSummary(full_text);
    const message = t`生成报错（{reason}），已达到最大重试次数 ({max})，已停止自动重试`
      .replace('{reason}', reason_summary)
      .replace('{max}', String(max_retries));
    toastr.warning(message, t`Cosmos Memory 自动重试停止`);
  }
  resetFilterRetryCount();
  return false;
}

export function setupGlobalErrorInterceptors(): void {
  if (is_interceptors_registered || typeof window === 'undefined') {
    return;
  }

  // 1. 包装 window.toastr.error 捕获酒馆前端弹出错误
  if (window.toastr && typeof window.toastr.error === 'function') {
    const original_toastr_error = window.toastr.error;
    window.toastr.error = function (message: any, title?: any, ...args: any[]) {
      try {
        const msg_str = typeof message === 'string' ? message : String(message?.message ?? message ?? '');
        const title_str = typeof title === 'string' ? title : '';
        handleGenerationError(msg_str, title_str);
      } catch (err) {
        console.warn('[CosmosMemory] 报错拦截处理异常', err);
      }
      return original_toastr_error.apply(this, [message, title, ...args]);
    };
  }

  // 2. 监听 window 的 unhandledrejection 事件捕获未处理异步错误
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      try {
        const reason = event.reason;
        const msg = reason instanceof Error ? reason.message : String(reason ?? '');
        handleGenerationError(msg);
      } catch (err) {
        console.warn('[CosmosMemory] 全局 unhandledrejection 拦截处理异常', err);
      }
    });
  }

  is_interceptors_registered = true;
}

export function getFilterRetryCount(): number {
  return current_retry_count;
}

export function resetFilterRetryCount(): void {
  current_retry_count = 0;
  cancelPendingAutoRetry();
}

export function cancelPendingAutoRetry(): void {
  if (pending_retry_timeout !== null) {
    clearTimeout(pending_retry_timeout);
    pending_retry_timeout = null;
  }
}

/**
 * 触发酒馆重新生成当前最后一条回复。
 * 优先使用 TavernHelper.triggerSlash('/regenerate')，
 * 降级尝试点击 #option_regenerate 按钮，
 * 最后降级尝试直接调用 SillyTavern 导出的 Generate('regenerate')。
 */
export async function triggerRegenerate(): Promise<void> {
  if (window.TavernHelper && typeof window.TavernHelper.triggerSlash === 'function') {
    try {
      await window.TavernHelper.triggerSlash('/regenerate');
      return;
    } catch (error) {
      console.warn('[CosmosMemory] 通过 TavernHelper.triggerSlash 触发 /regenerate 失败，尝试界面按钮回退', error);
    }
  }

  const regenerate_button = document.querySelector<HTMLElement>('#option_regenerate');
  if (regenerate_button) {
    regenerate_button.click();
    return;
  }

  try {
    const { Generate } = await import('@sillytavern/script');
    if (typeof Generate === 'function') {
      await Generate('regenerate');
      return;
    }
  } catch (error) {
    console.error('[CosmosMemory] 回退调用 Generate 失败', error);
  }

  throw new Error('无法触发重新生成：TavernHelper.triggerSlash 及回退方式均不可用');
}

/**
 * 当回复被过滤拦截且启用了自动重试时，调度重新生成。
 * 若已达到最大重试次数则熔断停止重试。
 */
export function triggerFilterAutoRetry(message_id: number, reason?: string): AutoRetryResult {
  const { settings } = useSettingsStore();
  if (!settings.filter.enabled || !settings.filter.auto_retry) {
    return { retried: false };
  }

  if (window.TavernHelper && typeof window.TavernHelper.getLastMessageId === 'function') {
    const last_message_id = window.TavernHelper.getLastMessageId();
    if (typeof last_message_id === 'number' && message_id !== last_message_id) {
      console.warn('[CosmosMemory] 过滤楼层并非聊天最新楼层，跳过自动重新生成', {
        message_id,
        last_message_id,
      });
      return { retried: false };
    }
  }

  const max_retries = settings.filter.max_retries;
  if (current_retry_count < max_retries) {
    current_retry_count++;
    const attempt = current_retry_count;
    console.info(
      `[CosmosMemory] 回复触发过滤条件，触发自动重试 (${attempt}/${max_retries})，原因: ${reason ?? '未知'}`,
    );
    const reason_text = reason ?? t`未通过过滤`;
    if (typeof toastr !== 'undefined') {
      const message = t`回复触发过滤条件（{reason}），正在自动重试 ({attempt}/{max})...`
        .replace('{reason}', reason_text)
        .replace('{attempt}', String(attempt))
        .replace('{max}', String(max_retries));
      toastr.info(message, t`Cosmos Memory 自动重试`);
    }

    cancelPendingAutoRetry();
    pending_retry_timeout = setTimeout(async () => {
      pending_retry_timeout = null;
      try {
        await triggerRegenerate();
      } catch (error) {
        console.error('[CosmosMemory] 自动触发重新生成失败', error);
        if (typeof toastr !== 'undefined') {
          toastr.error(error instanceof Error ? error.message : String(error), t`Cosmos Memory 自动重试失败`);
        }
      }
    }, 200);

    return { retried: true, attempt, max_retries };
  }

  console.warn(`[CosmosMemory] 连续自动重试已达最大上限 (${max_retries})，停止重试`);
  if (typeof toastr !== 'undefined') {
    const reason_text = reason ?? t`未通过过滤`;
    const message = t`回复触发过滤条件（{reason}），已达到最大重试次数 ({max})，已停止自动重试`
      .replace('{reason}', reason_text)
      .replace('{max}', String(max_retries));
    toastr.warning(message, t`Cosmos Memory 自动重试停止`);
  }
  resetFilterRetryCount();
  return { retried: false, max_retries };
}

/**
 * 统计消息文本的 Token 数量。
 * 优先调用 SillyTavern 内置的 getTokenCountAsync，若执行失败则按 3.35 字符/token 安全降级。
 */
export async function countMessageTokens(text: string): Promise<number> {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return 0;
  }

  try {
    if (typeof getTokenCountAsync === 'function') {
      const count = await getTokenCountAsync(trimmed);
      if (typeof count === 'number' && !Number.isNaN(count)) {
        return Math.max(0, Math.floor(count));
      }
    }
  } catch (error) {
    console.warn('[CosmosMemory] 计算 token 数量失败，回退为字符比例估算', error);
  }

  // 字符数到 token 的回退估算（SillyTavern 默认 CHARACTERS_PER_TOKEN_RATIO 约为 3.35）
  return Math.max(1, Math.ceil(trimmed.length / 3.35));
}

/**
 * 统计消息文本的字符字数。
 */
export function countMessageCharacters(text: string): number {
  return text ? text.trim().length : 0;
}

/**
 * 校验 AI 回复文本是否应被过滤拦截。
 * 拦截条件（满足任一即拦截）：
 * 1. 内容为空或仅空白；
 * 2. 包含配置的报错/拒答关键词（如 "I cannot", "抱歉", "我不能" 等，不区分大小写）；
 * 3. 长度低于配置的阈值（Token 数或字数，可设置；为 0 时不限制）。
 */
export async function evaluateMessageFilter(text: string, filter_settings: FilterSettings): Promise<FilterCheckResult> {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return {
      filtered: true,
      reason: '回复内容为空',
      count: 0,
      unit: filter_settings.length_unit,
    };
  }

  if (!filter_settings.enabled) {
    return {
      filtered: false,
    };
  }

  // 1. 关键词过滤（不区分大小写）
  const lower_text = trimmed.toLowerCase();
  for (const raw_keyword of filter_settings.blocked_keywords) {
    const keyword = raw_keyword.trim();
    if (keyword && lower_text.includes(keyword.toLowerCase())) {
      return {
        filtered: true,
        reason: `包含过滤关键词: "${keyword}"`,
      };
    }
  }

  // 1.5 服务器与网络报错特征识别（如 500 Internal Server Error、Failed to load resource 等）
  for (const pattern of SERVER_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        filtered: true,
        reason: t`检测到服务器报错信息`,
      };
    }
  }

  // 2. 长度过滤（少于阈值则过滤）
  if (filter_settings.min_length > 0) {
    if (filter_settings.length_unit === 'char') {
      const chars = countMessageCharacters(trimmed);
      if (chars < filter_settings.min_length) {
        return {
          filtered: true,
          reason: `字数 (${chars}) 少于设定阈值 (${filter_settings.min_length})`,
          count: chars,
          unit: 'char',
        };
      }
      return {
        filtered: false,
        count: chars,
        unit: 'char',
      };
    } else {
      const tokens = await countMessageTokens(trimmed);
      if (tokens < filter_settings.min_length) {
        return {
          filtered: true,
          reason: `Token 数 (${tokens}) 少于设定阈值 (${filter_settings.min_length})`,
          count: tokens,
          unit: 'token',
        };
      }
      return {
        filtered: false,
        count: tokens,
        unit: 'token',
      };
    }
  }

  return {
    filtered: false,
  };
}
