/**
 * SiliconFlow embeddings 客户端：前端直连 https://api.siliconflow.cn，
 * 不经过酒馆助手（generateRaw 只支持对话补全，不支持 embeddings 端点）。
 * 所有错误信息禁止包含 API Key。
 */

const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
/** 单请求批量条数：SiliconFlow 各模型 input 上限 32/64 不等，取保守值并串行请求避免 429 */
const EMBEDDING_BATCH_SIZE = 16;

export type EmbeddingConfig = {
  api_key: string;
  model: string;
};

type EmbeddingResponseEntry = {
  index: number;
  embedding: number[];
};

function buildAuthHeaders(api_key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${api_key}`,
    'Content-Type': 'application/json',
  };
}

async function throwResponseError(response: Response, context: string): Promise<never> {
  // 响应体可能包含错误详情，截断后拼进错误信息，便于用户排查（不含 key）
  const body_text = await response.text().catch(() => '');
  const detail = body_text.slice(0, 200);
  throw new Error(`${context}：HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
}

/**
 * 批量计算向量，返回 text → vector 字典。
 * 字典键与传入文本逐字节一致，供 ST /api/vector 的 webllm 源按原文取用。
 */
export async function fetchEmbeddings(texts: string[], config: EmbeddingConfig): Promise<Record<string, number[]>> {
  const unique_texts = [...new Set(texts)].filter(text => text.length > 0);
  const result: Record<string, number[]> = {};

  for (const chunk of _.chunk(unique_texts, EMBEDDING_BATCH_SIZE)) {
    const response = await fetch(`${SILICONFLOW_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: buildAuthHeaders(config.api_key),
      body: JSON.stringify({
        model: config.model,
        input: chunk,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      await throwResponseError(response, t`Embedding 请求失败`);
    }

    const data = (await response.json()) as { data?: EmbeddingResponseEntry[] };
    for (const entry of data.data ?? []) {
      const text = chunk[entry.index];
      if (text !== undefined && Array.isArray(entry.embedding) && entry.embedding.length > 0) {
        result[text] = entry.embedding;
      }
    }
  }

  const missing = unique_texts.filter(text => !result[text]);
  if (missing.length > 0) {
    throw new Error(t`Embedding 响应缺失 {count} 条向量`.replace('{count}', String(missing.length)));
  }

  return result;
}

/** 拉取 SiliconFlow 的文本 embedding 模型列表，供设置面板下拉选择 */
export async function fetchEmbeddingModelNames(api_key: string): Promise<string[]> {
  const response = await fetch(`${SILICONFLOW_BASE_URL}/models?type=text&sub_type=embedding`, {
    method: 'GET',
    headers: buildAuthHeaders(api_key),
  });

  if (!response.ok) {
    await throwResponseError(response, t`获取 Embedding 模型列表失败`);
  }

  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map(model => model.id?.trim())
    .filter((id): id is string => Boolean(id));
  return [...new Set(models)].sort();
}

/** 连通性测试：对固定短文本计算一次向量，返回维度供 UI 展示 */
export async function pingEmbeddingService(config: EmbeddingConfig): Promise<{ dimension: number }> {
  const test_text = 'ping';
  const embeddings = await fetchEmbeddings([test_text], config);
  return { dimension: embeddings[test_text]!.length };
}
