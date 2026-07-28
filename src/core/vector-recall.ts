/**
 * 聊天记录向量化召回核心：
 * - 同步：把 AI 楼层原文（酒馆正则后）逐条向量化，增量写入 ST 服务端本地向量索引；
 * - 召回：生成前用最近对话构造查询文本，检索相关历史楼层原文并注入提示词。
 * 与压缩摘要互补：摘要提供全局脉络，向量召回找回相关原文细节。
 */
import { fetchEmbeddings, type EmbeddingConfig } from '@/api/embedding';
import {
  deleteVectorItems,
  insertVectorItems,
  listVectorHashes,
  purgeVectorCollection,
  queryVectorCollection,
  type VectorItem,
  type VectorQueryHit,
} from '@/api/vector-storage';
import { isCosmosMemoryMessage } from '@/core/message-flags';
import { getRegexedAiContent, OPENING_MESSAGE_ID } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';
import type { VectorRecallSettings } from '@/type/settings';
import { getCurrentChatId } from '@sillytavern/script';
import { getStringHash } from '@sillytavern/scripts/utils';

export const VECTOR_RECALL_PROMPT_ID = 'cosmos_memory_vector_recall';

/** 同步防抖间隔：等编辑/删除等连续操作稳定后再统一 diff，避免频繁请求 */
const SYNC_DEBOUNCE_MS = 3000;
/** 检索时放大 topK 倍数，为后续客户端过滤（保护楼层/隐藏状态）预留余量 */
const QUERY_TOP_K_MULTIPLIER = 3;

let is_syncing = false;
let has_pending_sync = false;
/** 同步失败告警每个聊天只弹一次，避免持续骚扰；CHAT_CHANGED 时重置 */
let has_warned_sync_failure = false;

type SyncResult = {
  inserted: number;
  deleted: number;
};

function getVectorRecallSettings(): VectorRecallSettings {
  return useSettingsStore().settings.vector_recall;
}

/** 每个聊天一个集合；cosmos_ 前缀与 ST 内置向量扩展（collectionId=chatId）隔离 */
function getVectorCollectionId(): string | null {
  const chat_id = getCurrentChatId();
  return chat_id ? `cosmos_${chat_id}` : null;
}

function getEmbeddingConfig(settings: VectorRecallSettings): EmbeddingConfig | null {
  const api_key = settings.api_key.trim();
  const model = settings.model.trim();
  if (!settings.enabled || !api_key || !model) {
    return null;
  }

  return { api_key, model };
}

function getOriginalAssistantMessages(): ChatMessage[] {
  return window.TavernHelper.getChatMessages('0-{{lastMessageId}}', {
    role: 'assistant',
    include_swipes: false,
  }).filter(message => !isCosmosMemoryMessage(message));
}

/**
 * 收集当前聊天可向量化的条目：
 * - 排除开场白（始终保留在上下文中）与插件自建楼层；
 * - 文本先应用酒馆正则再截断，hash 按截断后文本计算，保证 diff 幂等；
 * - 隐藏楼层照常入库——被压缩隐藏的楼层正是召回的主要目标。
 */
function collectVectorizableItems(settings: VectorRecallSettings): VectorItem[] {
  const items: VectorItem[] = [];
  for (const message of getOriginalAssistantMessages()) {
    if (message.message_id === OPENING_MESSAGE_ID) {
      continue;
    }

    const text = getRegexedAiContent(message).slice(0, settings.max_chars_per_message);
    if (!text) {
      continue;
    }

    // 完全同文的楼层会合并为一条向量（hash 相同），召回效果等价，可接受
    items.push({ hash: getStringHash(text), text, index: message.message_id });
  }

  return items;
}

function warnSyncFailureOnce(error: unknown) {
  console.error('[CosmosMemory] 向量索引同步失败', error);
  if (!has_warned_sync_failure) {
    has_warned_sync_failure = true;
    const message = error instanceof Error ? error.message : String(error);
    toastr.warning(message, t`Cosmos Memory 向量索引同步失败`);
  }
}

/**
 * 增量同步：无状态 diff（当前楼层 hash 集合 vs 索引已存 hash 集合）。
 * 编辑楼层 = 旧 hash 删 + 新 hash 插；删除楼层 = 直接删，无需感知具体事件类型。
 */
export async function syncChatVectors(): Promise<SyncResult | null> {
  const settings = getVectorRecallSettings();
  const config = getEmbeddingConfig(settings);
  const collection_id = getVectorCollectionId();
  if (!config || !collection_id) {
    return null;
  }

  // 单飞锁：同步进行中收到新请求时仅做标记，本轮结束后补跑一轮
  if (is_syncing) {
    has_pending_sync = true;
    return null;
  }

  is_syncing = true;
  const chat_id_at_start = getCurrentChatId();

  try {
    const items = collectVectorizableItems(settings);
    const stored_hashes = new Set(await listVectorHashes(collection_id, config.model));
    const item_hashes = new Set(items.map(item => item.hash));
    const to_insert = _.uniqBy(
      items.filter(item => !stored_hashes.has(item.hash)),
      item => item.hash,
    );
    const to_delete = [...stored_hashes].filter(hash => !item_hashes.has(hash));

    if (to_insert.length > 0) {
      const embeddings = await fetchEmbeddings(
        to_insert.map(item => item.text),
        config,
      );
      // embedding 请求期间可能切换了聊天，丢弃结果避免写错集合
      if (getCurrentChatId() !== chat_id_at_start) {
        console.info('[CosmosMemory] 向量同步期间聊天已切换，丢弃本次结果');
        return null;
      }

      await insertVectorItems(collection_id, config.model, to_insert, embeddings);
    }

    if (to_delete.length > 0) {
      await deleteVectorItems(collection_id, config.model, to_delete);
    }

    if (to_insert.length > 0 || to_delete.length > 0) {
      console.info('[CosmosMemory] 向量索引同步完成', {
        collection_id,
        inserted: to_insert.length,
        deleted: to_delete.length,
      });
    }

    return { inserted: to_insert.length, deleted: to_delete.length };
  } catch (error) {
    // 同步是后台任务，失败不能打断总结/生成流程
    warnSyncFailureOnce(error);
    return null;
  } finally {
    is_syncing = false;
    if (has_pending_sync) {
      has_pending_sync = false;
      triggerVectorSyncDebounced();
    }
  }
}

const debounced_sync = _.debounce(() => {
  void syncChatVectors();
}, SYNC_DEBOUNCE_MS);

export function triggerVectorSyncDebounced() {
  const settings = getVectorRecallSettings();
  if (!getEmbeddingConfig(settings)) {
    return;
  }

  debounced_sync();
}

export function cancelVectorSyncForChatChange() {
  debounced_sync.cancel();
  has_pending_sync = false;
  has_warned_sync_failure = false;
}

/** 全量重建：清空集合后重新同步，进度回调供面板展示 */
export async function rebuildVectorIndex(): Promise<SyncResult> {
  const settings = getVectorRecallSettings();
  const config = getEmbeddingConfig(settings);
  const collection_id = getVectorCollectionId();
  if (!config || !collection_id) {
    throw new Error(t`请先启用向量召回并填写 API Key 与模型。`);
  }

  await purgeVectorCollection(collection_id);
  const result = await syncChatVectors();
  if (!result) {
    throw new Error(t`向量索引重建未完成，请检查控制台日志。`);
  }

  return result;
}

export async function purgeVectorIndex(): Promise<void> {
  const collection_id = getVectorCollectionId();
  if (!collection_id) {
    throw new Error(t`当前没有打开的聊天。`);
  }

  await purgeVectorCollection(collection_id);
}

/** 已入库条数：实时查询索引，不做本地持久化 */
export async function getVectorIndexStatus(): Promise<{ stored_count: number } | null> {
  const settings = getVectorRecallSettings();
  const model = settings.model.trim();
  const collection_id = getVectorCollectionId();
  if (!model || !collection_id) {
    return null;
  }

  const hashes = await listVectorHashes(collection_id, model);
  return { stored_count: hashes.length };
}

/** 构造查询文本：最近 N 条非隐藏、非插件自建消息（含刚发送的用户消息）的正则后文本 */
function buildQuerySearchText(settings: VectorRecallSettings): string {
  const last_id = window.TavernHelper.getLastMessageId();
  if (last_id < 0) {
    return '';
  }

  // 只取尾部一段楼层做候选，避免超长聊天全量读取
  const range_start = Math.max(0, last_id - 20);
  const recent_messages = window.TavernHelper.getChatMessages(`${range_start}-${last_id}`, { include_swipes: false })
    .filter(message => !message.is_hidden && !isCosmosMemoryMessage(message))
    .slice(-settings.query_recent_message_count);

  const search_text = recent_messages
    .map(message => (message.role === 'assistant' ? getRegexedAiContent(message) : message.message.trim()))
    .filter(Boolean)
    .join('\n');

  // 超长时保留尾部（最靠近当前剧情的部分）
  return search_text.slice(-settings.max_chars_per_message);
}

/** 保护线：倒数第 N 条 AI 楼层的 message_id，该线及之后的楼层不参与召回 */
function getProtectedFloorThreshold(settings: VectorRecallSettings): number {
  const assistant_messages = getOriginalAssistantMessages();
  if (settings.protect_recent_assistant_count === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const protected_messages = assistant_messages.slice(-settings.protect_recent_assistant_count);
  return protected_messages.length > 0 ? protected_messages[0]!.message_id : 0;
}

function buildRecallPromptContent(hits: VectorQueryHit[]): string {
  return [
    '[CosmosMemory 相关剧情回放] 以下是与当前情节相关的早期剧情原文片段，按时间顺序排列，属于历史剧情而非当前对话：',
    hits.map(hit => `【第 ${hit.index} 楼】\n${hit.text}`).join('\n\n'),
    '[/CosmosMemory 相关剧情回放]',
  ].join('\n');
}

/**
 * 生成前召回注入。必须在压缩流程之后调用，
 * 此时楼层的 is_hidden 已是本次生成的最终状态。
 * 返回召回的楼层 id 列表；任何失败都静默降级，绝不阻断生成。
 */
export async function applyVectorRecallForNextGeneration(): Promise<number[]> {
  // once:true 注入理论上生成后自动清除，此处先卸载做双保险
  window.TavernHelper.uninjectPrompts([VECTOR_RECALL_PROMPT_ID]);

  const settings = getVectorRecallSettings();
  const config = getEmbeddingConfig(settings);
  const collection_id = getVectorCollectionId();
  if (!config || !collection_id) {
    return [];
  }

  const search_text = buildQuerySearchText(settings);
  if (!search_text) {
    return [];
  }

  const embeddings = await fetchEmbeddings([search_text], config);
  const query_embedding = embeddings[search_text];
  if (!query_embedding) {
    return [];
  }

  const raw_hits = await queryVectorCollection(
    collection_id,
    config.model,
    search_text,
    query_embedding,
    settings.top_k * QUERY_TOP_K_MULTIPLIER,
    settings.score_threshold,
  );

  const protected_threshold = getProtectedFloorThreshold(settings);
  const message_by_id = new Map(getOriginalAssistantMessages().map(message => [message.message_id, message]));
  const hits = raw_hits
    .filter(hit => hit.index < protected_threshold)
    .filter(hit => {
      const message = message_by_id.get(hit.index);
      if (!message) {
        // 楼层已被删除但索引尚未同步，跳过
        return false;
      }

      // 未隐藏楼层的原文本就在上下文中，默认不重复注入
      return !settings.only_recall_hidden || message.is_hidden;
    })
    .sort((left, right) => left.index - right.index)
    .slice(0, settings.top_k);

  if (hits.length === 0) {
    return [];
  }

  window.TavernHelper.injectPrompts(
    [
      {
        id: VECTOR_RECALL_PROMPT_ID,
        position: 'in_chat' as const,
        depth: settings.injection_depth,
        role: 'system' as const,
        content: buildRecallPromptContent(hits),
      },
    ],
    { once: true },
  );

  const recalled_ids = hits.map(hit => hit.index);
  console.info('[CosmosMemory] 已注入向量召回内容', {
    recalled_message_ids: recalled_ids,
    query_length: search_text.length,
  });
  return recalled_ids;
}
