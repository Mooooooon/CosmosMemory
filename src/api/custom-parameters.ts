import type { AiSettings } from '@/type/settings';
import { parseDocument } from 'yaml';

const BodyParameters = z.record(z.string(), z.json());
const ExcludedParameters = z.array(z.string().trim().min(1));
const RequestHeaders = z.record(z.string().min(1), z.string()).transform(headers =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      // 酒馆后端用这两个大小写形式设置默认头，统一名称才能覆盖而非合并成重复值。
      const normalized_name =
        name.toLowerCase() === 'authorization'
          ? 'Authorization'
          : name.toLowerCase() === 'content-type'
            ? 'Content-Type'
            : name;
      return [normalized_name, value];
    }),
  ),
);

/** 与酒馆自定义源一致：根字段覆盖，随后排除；JSON 也是合法的 YAML。 */
export function parseCustomApiParameters(
  settings: Pick<AiSettings, 'custom_include_body' | 'custom_exclude_body' | 'custom_include_headers'>,
) {
  function parseField<T>(raw: string, schema: z.ZodType<T>, fallback: T, message: string): T {
    if (!raw.trim()) return fallback;
    try {
      const document = parseDocument(raw);
      if (document.errors.length || document.warnings.length) throw new Error(message);
      return schema.parse(document.toJS());
    } catch {
      // 解析错误可能包含用户填写的密钥或请求头，不将原文写入错误信息。
      throw new Error(message);
    }
  }

  return {
    custom_include_body: parseField(
      settings.custom_include_body,
      BodyParameters,
      {},
      t`追加请求体无效，请填写 YAML 或 JSON 对象。`,
    ),
    custom_exclude_body: parseField(
      settings.custom_exclude_body,
      ExcludedParameters,
      [],
      t`排除请求体字段无效，请填写 YAML 或 JSON 字符串数组。`,
    ),
    custom_include_headers: parseField(
      settings.custom_include_headers,
      RequestHeaders,
      {},
      t`追加请求头无效，请填写值为字符串的 YAML 或 JSON 对象。`,
    ),
  };
}
