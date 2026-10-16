/** 仅移除字符串外的尾逗号，以及对象末尾误写的 ,"}；不补全截断内容或字段值。 */
function repairJsonSeparators(text: string): string {
  let result = '';
  let in_string = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (in_string) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') in_string = false;
      continue;
    }

    if (char === ',') {
      const remainder = text.slice(index + 1);
      if (/^\s*[}\]]/.test(remainder)) continue;
      // 模型偶尔将 characters 的结束写成 ...},"},"elapsed_time":...。
      const stray_key = remainder.match(/^\s*"\s*(?=}(?:\s*,|\s*}|\s*$))/);
      if (stray_key) {
        index += stray_key[0].length;
        continue;
      }
    }

    result += char;
    if (char === '"') in_string = true;
  }

  return result;
}

/** 返回 unknown，调用方必须继续使用业务 schema 校验。 */
export function parseAiJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new Error(t`AI 返回了空内容。`);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const json_text = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;

  try {
    return JSON.parse(json_text);
  } catch (cause) {
    const repaired = repairJsonSeparators(json_text);
    if (repaired !== json_text) {
      try {
        const parsed: unknown = JSON.parse(repaired);
        console.warn('[CosmosMemory] 已修复 AI JSON 中多余的分隔符，继续进行数据校验');
        return parsed;
      } catch {
        // 保留原始解析错误作为诊断原因，不记录原始剧情内容。
      }
    }
    throw new Error(t`AI 返回的 JSON 格式无效，无法安全修复，请重试。`, { cause });
  }
}
