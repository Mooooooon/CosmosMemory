/**
 * 向量与重排 API 公共层：
 * 支持自由配置渠道端点（默认 SiliconFlow）、鉴权头与错误处理。
 * 所有错误信息禁止包含 API Key。
 */

export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';

/** 标准化渠道基础地址：去除首尾空格、末尾斜杠及误填的具体端点路径 */
export function normalizeApiUrl(url?: string): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) {
    return SILICONFLOW_BASE_URL;
  }

  let cleaned = trimmed.replace(/\/+$/, '');
  if (cleaned.endsWith('/embeddings')) {
    cleaned = cleaned.slice(0, -'/embeddings'.length).replace(/\/+$/, '');
  } else if (cleaned.endsWith('/rerank')) {
    cleaned = cleaned.slice(0, -'/rerank'.length).replace(/\/+$/, '');
  }

  return cleaned || SILICONFLOW_BASE_URL;
}

/** 构造请求头；若未填写 API Key（如本地免鉴权端点）则不附加 Authorization */
export function buildApiHeaders(api_key?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const trimmed_key = api_key?.trim();
  if (trimmed_key) {
    headers.Authorization = `Bearer ${trimmed_key}`;
  }

  return headers;
}

/** 兼容旧版命名 */
export const buildSiliconFlowHeaders = buildApiHeaders;

export async function throwApiResponseError(response: Response, context: string): Promise<never> {
  // 响应体可能包含错误详情，截断后拼进错误信息，便于用户排查（不含 key）
  const body_text = await response.text().catch(() => '');
  const detail = body_text.slice(0, 200);
  throw new Error(`${context}：HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
}

/** 兼容旧版命名 */
export const throwSiliconFlowResponseError = throwApiResponseError;

/**
 * 拉取指定渠道的模型列表：
 * - 如果是 SiliconFlow，优先使用其特有的 sub_type 参数精准过滤；
 * - 针对通用 OpenAI 兼容端点，拉取 /models 并按子类型关键字（embed/rerank）进行推荐筛选；
 * - 若无匹配关键字则返回全部模型，确保用户始终可选。
 */
export async function fetchSiliconFlowModelNames(
  api_key: string,
  sub_type: 'embedding' | 'reranker',
  api_url?: string,
): Promise<string[]> {
  const base_url = normalizeApiUrl(api_url);
  const is_siliconflow = base_url.includes('siliconflow.cn');

  if (is_siliconflow) {
    try {
      const response = await fetch(`${base_url}/models?type=text&sub_type=${sub_type}`, {
        method: 'GET',
        headers: buildApiHeaders(api_key),
      });

      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ id?: string }> };
        const models = (data.data ?? []).map(model => model.id?.trim()).filter((id): id is string => Boolean(id));
        return [...new Set(models)].sort();
      }
    } catch {
      // 请求失败时降级走标准 /models 端点
    }
  }

  const response = await fetch(`${base_url}/models`, {
    method: 'GET',
    headers: buildApiHeaders(api_key),
  });

  if (!response.ok) {
    await throwApiResponseError(response, t`获取模型列表失败`);
  }

  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const all_models = (data.data ?? []).map(model => model.id?.trim()).filter((id): id is string => Boolean(id));
  const unique_models = [...new Set(all_models)].sort();

  if (sub_type === 'reranker') {
    const rerank_models = unique_models.filter(id => id.toLowerCase().includes('rerank'));
    return rerank_models.length > 0 ? rerank_models : unique_models;
  }

  const embedding_models = unique_models.filter(id => {
    const lower = id.toLowerCase();
    return lower.includes('embed') || lower.includes('bge') || lower.includes('gte');
  });

  return embedding_models.length > 0 ? embedding_models : unique_models;
}
