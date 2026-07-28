/**
 * SiliconFlow API 公共层：embedding 与 rerank 客户端共享的
 * 基础地址、鉴权头与错误处理。所有错误信息禁止包含 API Key。
 */

export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';

export function buildSiliconFlowHeaders(api_key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${api_key}`,
    'Content-Type': 'application/json',
  };
}

export async function throwSiliconFlowResponseError(response: Response, context: string): Promise<never> {
  // 响应体可能包含错误详情，截断后拼进错误信息，便于用户排查（不含 key）
  const body_text = await response.text().catch(() => '');
  const detail = body_text.slice(0, 200);
  throw new Error(`${context}：HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
}

/** 拉取指定子类型的文本模型列表（embedding / reranker），供设置面板下拉选择 */
export async function fetchSiliconFlowModelNames(api_key: string, sub_type: 'embedding' | 'reranker'): Promise<string[]> {
  const response = await fetch(`${SILICONFLOW_BASE_URL}/models?type=text&sub_type=${sub_type}`, {
    method: 'GET',
    headers: buildSiliconFlowHeaders(api_key),
  });

  if (!response.ok) {
    await throwSiliconFlowResponseError(response, t`获取模型列表失败`);
  }

  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = (data.data ?? []).map(model => model.id?.trim()).filter((id): id is string => Boolean(id));
  return [...new Set(models)].sort();
}
