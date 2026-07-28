/**
 * SiliconFlow rerank 客户端：对向量检索的候选片段按查询相关度重排。
 * embedding 召回负责「找得到」，rerank 负责「排得准」——
 * 交叉编码器对 query-document 逐对打分，精度远高于向量余弦相似度。
 */
import { buildSiliconFlowHeaders, SILICONFLOW_BASE_URL, throwSiliconFlowResponseError } from '@/api/siliconflow';

export type RerankConfig = {
  api_key: string;
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

  const response = await fetch(`${SILICONFLOW_BASE_URL}/rerank`, {
    method: 'POST',
    headers: buildSiliconFlowHeaders(config.api_key),
    body: JSON.stringify({
      model: config.model,
      query,
      documents,
      top_n,
      return_documents: false,
    }),
  });

  if (!response.ok) {
    await throwSiliconFlowResponseError(response, t`Rerank 请求失败`);
  }

  const data = (await response.json()) as { results?: RerankResponseEntry[] };
  return (data.results ?? [])
    .filter(entry => typeof entry.index === 'number' && typeof entry.relevance_score === 'number')
    .map(entry => ({ index: entry.index, relevance_score: entry.relevance_score }));
}
