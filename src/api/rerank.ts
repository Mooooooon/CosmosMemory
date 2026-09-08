/**
 * Rerank 客户端：对向量检索的候选片段按查询相关度重排。
 * 支持自由配置渠道端点（默认 SiliconFlow）。
 * embedding 召回负责「找得到」，rerank 负责「排得准」——
 * 交叉编码器对 query-document 逐对打分，精度远高于向量余弦相似度。
 */
import { buildApiHeaders, fetchSiliconFlowModelNames, normalizeApiUrl, throwApiResponseError } from '@/api/siliconflow';

export type RerankConfig = {
  api_url?: string;
  api_key?: string;
  model: string;
};

export type RerankResult = {
  /** 候选在传入 documents 数组中的下标 */
  index: number;
  /** 相关度分数（模型相关，通常 0-1，越大越相关） */
  relevance_score: number;
};

type RerankResponseEntry = {
  index: number;
  relevance_score: number;
};

/**
 * 对候选文档按查询重排，返回按相关度降序的 (下标, 分数) 列表。
 * top_n 控制返回条数；不返回文档原文（return_documents=false），按下标回查即可。
 */
export async function rerankDocuments(
  query: string,
  documents: string[],
  top_n: number,
  config: RerankConfig,
): Promise<RerankResult[]> {
  if (documents.length === 0) {
    return [];
  }

  const base_url = normalizeApiUrl(config.api_url);
  const response = await fetch(`${base_url}/rerank`, {
    method: 'POST',
    headers: buildApiHeaders(config.api_key),
    body: JSON.stringify({
      model: config.model,
      query,
      documents,
      top_n,
      return_documents: false,
    }),
  });

  if (!response.ok) {
    await throwApiResponseError(response, t`Rerank 请求失败`);
  }

  const data = (await response.json()) as { results?: RerankResponseEntry[] };
  return (data.results ?? [])
    .filter(entry => typeof entry.index === 'number' && typeof entry.relevance_score === 'number')
    .map(entry => ({ index: entry.index, relevance_score: entry.relevance_score }));
}

/** 拉取指定渠道的 rerank 模型列表，供设置面板下拉或输入选择 */
export async function fetchRerankModelNames(api_key: string, api_url?: string): Promise<string[]> {
  return fetchSiliconFlowModelNames(api_key, 'reranker', api_url);
}
