import { DEFAULT_BODY_FILTER_TAG } from '@/type/settings';

/** 接受 content 或 <content>；空值使用默认标签。 */
export function normalizeBodyTag(tag: string): string | null {
  const value = tag.trim() || DEFAULT_BODY_FILTER_TAG;
  const name = value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1).trim() : value;
  return /^[a-zA-Z][\w:.-]*$/.test(name) ? `<${name}>` : null;
}

/** 只保留完整标签内的正文；不匹配或标签无效时返回空文本，不回退到原文。 */
export function filterBodyContent(text: string, enabled: boolean, tag: string): string {
  if (!enabled) return text;
  const normalized = normalizeBodyTag(tag);
  if (!normalized) return '';
  const name = normalized.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markers = new RegExp(`<(/?)${name}\\s*>`, 'gi');
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (const match of text.matchAll(markers)) {
    if (!match[1]) {
      if (depth === 0) start = match.index + match[0].length;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const content = text.slice(start, match.index).replace(markers, '').trim();
        if (content) parts.push(content);
      }
    }
  }
  return parts.join('\n\n');
}
