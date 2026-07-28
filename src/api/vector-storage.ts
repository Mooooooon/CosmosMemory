/**
 * SillyTavern 服务端 /api/vector/* 封装。
 * 借用 source='webllm' 的机制：请求体自带 embeddings（text → vector 字典），
 * 服务端直接取用向量，无需在 ST 中保存 embedding 服务商的 API Key。
 * 索引路径为 vectors/webllm/<collectionId>/<model>，按模型天然隔离，
 * 换模型即全新空索引，不存在维度不一致问题。
 */
import { getRequestHeaders } from '@sillytavern/script';

const VECTOR_SOURCE = 'webllm';

export type VectorItem = {
  /** 文本内容 hash，用于增量同步 diff 与删除定位 */
  hash: number;
  text: string;
  /** 借用服务端 metadata 的 index 字段存放楼层 message_id */
  index: number;
};

export type VectorQueryHit = {
  hash: number;
  text: string;
  index: number;
};

async function postVectorApi(endpoint: string, body: Record<string, unknown>): Promise<Response> {
  const response = await fetch(`/api/vector/${endpoint}`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`/api/vector/${endpoint} 请求失败：HTTP ${response.status}`);
  }

  return response;
}

/** 批量写入向量。embeddings 字典键必须与 items[].text 逐字节一致，否则服务端会插入 undefined 向量 */
export async function insertVectorItems(
  collection_id: string,
  model: string,
  items: VectorItem[],
  embeddings: Record<string, number[]>,
): Promise<void> {
  const missing = items.filter(item => !Array.isArray(embeddings[item.text]) || embeddings[item.text]!.length === 0);
  if (missing.length > 0) {
    throw new Error(`向量写入中止：${missing.length} 条文本缺失对应向量`);
  }

  await postVectorApi('insert', {
    collectionId: collection_id,
    items,
    source: VECTOR_SOURCE,
    model,
    embeddings,
  });
}

/** 相似度检索。返回值取服务端已按 threshold 过滤的 metadata（hashes 字段未过滤，不使用） */
export async function queryVectorCollection(
  collection_id: string,
  model: string,
  search_text: string,
  embedding: number[],
  top_k: number,
  threshold: number,
): Promise<VectorQueryHit[]> {
  const response = await postVectorApi('query', {
    collectionId: collection_id,
    searchText: search_text,
    topK: top_k,
    threshold,
    source: VECTOR_SOURCE,
    model,
    embeddings: { [search_text]: embedding },
  });

  const data = (await response.json()) as { metadata?: VectorQueryHit[] };
  return (data.metadata ?? []).filter(hit => typeof hit.index === 'number' && typeof hit.text === 'string');
}

/** 列出集合内已存的全部 hash，用于增量同步 diff */
export async function listVectorHashes(collection_id: string, model: string): Promise<number[]> {
  const response = await postVectorApi('list', {
    collectionId: collection_id,
    source: VECTOR_SOURCE,
    model,
  });

  const data = (await response.json()) as number[];
  return Array.isArray(data) ? data.map(Number) : [];
}

/** 按 hash 删除集合内的向量 */
export async function deleteVectorItems(collection_id: string, model: string, hashes: number[]): Promise<void> {
  await postVectorApi('delete', {
    collectionId: collection_id,
    hashes,
    source: VECTOR_SOURCE,
    model,
  });
}

/** 清空集合（服务端会删除该 collectionId 在所有 source 下的索引；collectionId 带 cosmos_ 前缀与 ST 内置向量扩展隔离） */
export async function purgeVectorCollection(collection_id: string): Promise<void> {
  await postVectorApi('purge', {
    collectionId: collection_id,
  });
}
