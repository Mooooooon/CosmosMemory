<template>
  <div>
    <div class="cosmos-memory-row flex-container">
      <input id="cosmos_memory_vector_recall_enabled" v-model="settings.vector_recall.enabled" type="checkbox" />
      <label for="cosmos_memory_vector_recall_enabled">{{ t`启用向量召回` }}</label>
    </div>

    <div class="cosmos-memory-hint">
      {{ t`开启后会把 AI 回复原文向量化存入本地索引，生成时召回相关的历史剧情原文注入提示词，与摘要压缩互补。` }}
    </div>

    <label class="cosmos-memory-field">
      <span>{{ t`SiliconFlow API Key` }}</span>
      <input v-model.trim="settings.vector_recall.api_key" class="text_pole" type="password" autocomplete="off" />
    </label>

    <div class="cosmos-memory-row flex-container">
      <input
        class="menu_button"
        type="button"
        :value="is_fetching_models ? t`获取中...` : t`获取模型列表`"
        :disabled="is_fetching_models || !settings.vector_recall.api_key.trim()"
        @click="handle_fetch_embedding_models"
      />
      <input
        class="menu_button"
        type="button"
        :value="is_testing ? t`测试中...` : t`测试连接`"
        :disabled="is_testing || !settings.vector_recall.api_key.trim() || !settings.vector_recall.model.trim()"
        @click="handle_test_embedding"
      />
    </div>

    <label class="cosmos-memory-field">
      <span>{{ t`Embedding 模型` }}</span>
      <select v-model="settings.vector_recall.model" class="text_pole">
        <option v-for="model in model_options" :key="model" :value="model">
          {{ model }}
        </option>
      </select>
    </label>

    <div class="cosmos-memory-hint">
      {{ t`更换模型后索引会自动按模型隔离重建，旧模型的索引不受影响。` }}
    </div>

    <div
      v-if="test_result"
      class="cosmos-memory-test-result"
      :class="`cosmos-memory-test-result--${test_result.type}`"
    >
      {{ test_result.message }}
    </div>

    <hr class="sysHR" />

    <label class="cosmos-memory-field">
      <span>{{ t`查询使用的最近消息条数` }}</span>
      <input
        v-model.number="settings.vector_recall.query_recent_message_count"
        class="text_pole"
        type="number"
        min="1"
        step="1"
        @change="normalize_query_recent_message_count"
      />
    </label>

    <label class="cosmos-memory-field">
      <span>{{ t`召回条数上限` }}</span>
      <input
        v-model.number="settings.vector_recall.top_k"
        class="text_pole"
        type="number"
        min="1"
        step="1"
        @change="normalize_top_k"
      />
    </label>

    <label class="cosmos-memory-field">
      <span>{{ t`相似度阈值` }}</span>
      <input
        v-model.number="settings.vector_recall.score_threshold"
        class="text_pole"
        type="number"
        min="0"
        max="1"
        step="0.05"
        @change="normalize_score_threshold"
      />
    </label>

    <label class="cosmos-memory-field">
      <span>{{ t`保护最近 AI 楼层数` }}</span>
      <input
        v-model.number="settings.vector_recall.protect_recent_assistant_count"
        class="text_pole"
        type="number"
        min="0"
        step="1"
        @change="normalize_protect_count"
      />
    </label>

    <div class="cosmos-memory-hint">
      {{ t`最近 N 条 AI 回复不参与召回，它们的原文通常仍在上下文中。` }}
    </div>

    <div class="cosmos-memory-row flex-container">
      <input
        id="cosmos_memory_vector_recall_only_hidden"
        v-model="settings.vector_recall.only_recall_hidden"
        type="checkbox"
      />
      <label for="cosmos_memory_vector_recall_only_hidden">{{ t`仅召回已隐藏楼层` }}</label>
    </div>

    <div class="cosmos-memory-hint">
      {{ t`未隐藏楼层的原文已在上下文中，关闭本项可能导致内容重复，仅建议配合极小的保留原文数量使用。` }}
    </div>

    <label class="cosmos-memory-field">
      <span>{{ t`注入深度` }}</span>
      <input
        v-model.number="settings.vector_recall.injection_depth"
        class="text_pole"
        type="number"
        min="0"
        step="1"
        @change="normalize_injection_depth"
      />
    </label>

    <label class="cosmos-memory-field">
      <span>{{ t`单楼层截断字符数` }}</span>
      <input
        v-model.number="settings.vector_recall.max_chars_per_message"
        class="text_pole"
        type="number"
        min="200"
        step="100"
        @change="normalize_max_chars"
      />
    </label>

    <hr class="sysHR" />

    <div class="cosmos-memory-row flex-container">
      <span>{{ t`已入库片段` }}：{{ stored_count === null ? t`未知` : stored_count }}</span>
      <input class="menu_button" type="button" :value="t`刷新`" @click="handle_refresh_status" />
    </div>

    <div class="cosmos-memory-row flex-container">
      <input
        class="menu_button"
        type="button"
        :value="is_syncing ? t`同步中...` : t`立即同步`"
        :disabled="is_busy"
        @click="handle_sync_now"
      />
      <input
        class="menu_button"
        type="button"
        :value="is_rebuilding ? t`重建中...` : t`全量重建索引`"
        :disabled="is_busy"
        @click="handle_rebuild_index"
      />
      <input
        class="menu_button"
        type="button"
        :value="is_purging ? t`清空中...` : t`清空索引`"
        :disabled="is_busy"
        @click="handle_purge_index"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { fetchEmbeddingModelNames, pingEmbeddingService } from '@/api/embedding';
import {
  getVectorIndexStatus,
  purgeVectorIndex,
  rebuildVectorIndex,
  syncChatVectors,
} from '@/core/vector-recall';
import { useSettingsStore } from '@/store/settings';
import {
  DEFAULT_VECTOR_RECALL_INJECTION_DEPTH,
  DEFAULT_VECTOR_RECALL_MAX_CHARS,
} from '@/type/settings';
import { storeToRefs } from 'pinia';

type TestResult = {
  type: 'success' | 'error';
  message: string;
};

const { settings } = storeToRefs(useSettingsStore());

const is_fetching_models = ref(false);
const is_testing = ref(false);
const is_syncing = ref(false);
const is_rebuilding = ref(false);
const is_purging = ref(false);
const test_result = ref<TestResult | null>(null);
const stored_count = ref<number | null>(null);

const is_busy = computed(() => is_syncing.value || is_rebuilding.value || is_purging.value);

const model_options = computed(() => {
  return [...new Set([settings.value.vector_recall.model, ...settings.value.vector_recall.available_models])]
    .map(model => model.trim())
    .filter(Boolean);
});

onMounted(() => {
  void refresh_status();
});

async function refresh_status() {
  try {
    const status = await getVectorIndexStatus();
    stored_count.value = status?.stored_count ?? null;
  } catch (error) {
    console.warn('[CosmosMemory] 读取向量索引状态失败', error);
    stored_count.value = null;
  }
}

async function handle_fetch_embedding_models() {
  is_fetching_models.value = true;
  test_result.value = null;

  try {
    const models = await fetchEmbeddingModelNames(settings.value.vector_recall.api_key.trim());
    settings.value.vector_recall.available_models = models;

    if (!settings.value.vector_recall.model && models.length > 0) {
      settings.value.vector_recall.model = models[0]!;
    }

    toastr.success(t`Embedding 模型列表获取成功。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message);
    test_result.value = { type: 'error', message };
  } finally {
    is_fetching_models.value = false;
  }
}

async function handle_test_embedding() {
  is_testing.value = true;
  test_result.value = null;

  try {
    const { dimension } = await pingEmbeddingService({
      api_key: settings.value.vector_recall.api_key.trim(),
      model: settings.value.vector_recall.model.trim(),
    });
    test_result.value = {
      type: 'success',
      message: t`连接成功，模型 {model}，向量维度 {dimension}。`
        .replace('{model}', settings.value.vector_recall.model)
        .replace('{dimension}', String(dimension)),
    };
    toastr.success(t`Embedding 连接测试成功。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message);
    test_result.value = { type: 'error', message };
  } finally {
    is_testing.value = false;
  }
}

async function handle_sync_now() {
  is_syncing.value = true;

  try {
    const result = await syncChatVectors();
    if (!result) {
      toastr.warning(t`同步未执行：请确认已启用向量召回并填写 API Key 与模型，且当前有打开的聊天。`, 'Cosmos Memory');
      return;
    }

    toastr.success(
      t`同步完成：新增 {inserted} 条，删除 {deleted} 条。`
        .replace('{inserted}', String(result.inserted))
        .replace('{deleted}', String(result.deleted)),
      'Cosmos Memory',
    );
    await refresh_status();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 向量同步失败`);
  } finally {
    is_syncing.value = false;
  }
}

async function handle_rebuild_index() {
  if (!confirm(t`确定要清空并全量重建当前聊天的向量索引吗？`)) {
    return;
  }

  is_rebuilding.value = true;

  try {
    const result = await rebuildVectorIndex();
    toastr.success(t`索引重建完成，共写入 {count} 条。`.replace('{count}', String(result.inserted)), 'Cosmos Memory');
    await refresh_status();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 索引重建失败`);
  } finally {
    is_rebuilding.value = false;
  }
}

async function handle_purge_index() {
  if (!confirm(t`确定要清空当前聊天的向量索引吗？此操作不可撤销。`)) {
    return;
  }

  is_purging.value = true;

  try {
    await purgeVectorIndex();
    toastr.success(t`向量索引已清空。`, 'Cosmos Memory');
    await refresh_status();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 清空索引失败`);
  } finally {
    is_purging.value = false;
  }
}

function handle_refresh_status() {
  void refresh_status();
}

function normalize_query_recent_message_count() {
  const count = settings.value.vector_recall.query_recent_message_count;
  settings.value.vector_recall.query_recent_message_count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 3;
}

function normalize_top_k() {
  const count = settings.value.vector_recall.top_k;
  settings.value.vector_recall.top_k = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 5;
}

function normalize_score_threshold() {
  const value = settings.value.vector_recall.score_threshold;
  settings.value.vector_recall.score_threshold = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.35;
}

function normalize_protect_count() {
  const count = settings.value.vector_recall.protect_recent_assistant_count;
  settings.value.vector_recall.protect_recent_assistant_count = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 10;
}

function normalize_injection_depth() {
  const depth = settings.value.vector_recall.injection_depth;
  settings.value.vector_recall.injection_depth = Number.isFinite(depth)
    ? Math.max(0, Math.floor(depth))
    : DEFAULT_VECTOR_RECALL_INJECTION_DEPTH;
}

function normalize_max_chars() {
  const chars = settings.value.vector_recall.max_chars_per_message;
  settings.value.vector_recall.max_chars_per_message = Number.isFinite(chars)
    ? Math.max(200, Math.floor(chars))
    : DEFAULT_VECTOR_RECALL_MAX_CHARS;
}
</script>

<style scoped>
/* Panel.vue 的同名样式是 scoped 的，子组件需要自带一份 */
.cosmos-memory-row {
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}

.cosmos-memory-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
}

.cosmos-memory-field > span,
.cosmos-memory-hint {
  opacity: 0.85;
}

.cosmos-memory-test-result {
  border-radius: 8px;
  margin: 8px 0;
  padding: 8px 10px;
  white-space: pre-wrap;
}

.cosmos-memory-test-result--success {
  background: rgba(46, 125, 50, 0.22);
  border: 1px solid #2e7d32;
}

.cosmos-memory-test-result--error {
  background: rgba(198, 40, 40, 0.18);
  border: 1px solid #c62828;
}
</style>
