import { getTokenCountAsync } from '@sillytavern/scripts/tokenizers';
import { type FilterSettings } from '@/type/settings';

export type FilterCheckResult = {
  filtered: boolean;
  reason?: string;
  count?: number;
  unit?: 'token' | 'char';
};

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
