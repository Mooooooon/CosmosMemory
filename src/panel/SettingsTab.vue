<template>
  <div class="cosmos-settings-tab-panel">
    <!-- API 与模型配置卡片 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-network-wired"></i>
          {{ t`API 与模型` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input id="cosmos_memory_use_tavern_api" v-model="settings.ai.use_tavern_api" type="checkbox" />
        <label for="cosmos_memory_use_tavern_api">{{ t`是否使用酒馆API` }}</label>
      </div>

      <div v-if="settings.ai.use_tavern_api" class="cosmos-memory-hint">
        {{ t`将使用 SillyTavern 当前启用的 API 与思考级别设置。` }}
      </div>

      <div v-else class="cosmos-sub-card">
        <label class="cosmos-memory-field">
          <span>{{ t`自定义端点` }}</span>
          <input
            v-model.trim="settings.ai.custom_api_url"
            class="text_pole"
            type="url"
            placeholder="https://api.deepseek.com/v1"
          />
        </label>

        <label class="cosmos-memory-field">
          <span>{{ t`密钥` }}</span>
          <input v-model.trim="settings.ai.custom_api_key" class="text_pole" type="password" autocomplete="off" />
        </label>

        <div class="cosmos-memory-row flex-container">
          <input
            class="menu_button"
            type="button"
            :value="is_fetching_models ? t`获取中...` : t`获取模型列表`"
            :disabled="is_fetching_models || !settings.ai.custom_api_url.trim()"
            @click="handle_fetch_models"
          />
        </div>

        <label class="cosmos-memory-field">
          <span>{{ t`模型` }}</span>
          <input
            v-model.trim="settings.ai.selected_model"
            class="text_pole"
            type="text"
            list="cosmos_memory_custom_models"
            :placeholder="t`输入或选择模型名称`"
          />
          <datalist id="cosmos_memory_custom_models">
            <option v-for="model in model_options" :key="model" :value="model">
              {{ model }}
            </option>
          </datalist>
        </label>

        <label class="cosmos-memory-field">
          <span>{{ t`API 源` }}</span>
          <select v-model="settings.ai.custom_api_source" class="text_pole">
            <option value="auto">{{ t`自动推断` }}</option>
            <option v-for="source in custom_api_source_options" :key="source" :value="source">{{ source }}</option>
          </select>
        </label>

        <div class="cosmos-memory-hint">
          {{ t`自定义端点的 API 类型。自动推断只能识别 deepseek，其他端点请求失败时请手动选择。` }}
        </div>

        <label class="cosmos-memory-field">
          <span>{{ t`思考级别` }}</span>
          <select
            v-model="settings.ai.reasoning_effort"
            class="text_pole cosmos-memory-reasoning-select"
            :disabled="!is_reasoning_effort_supported"
          >
            <option value="auto">{{ t`跟随 SillyTavern` }}</option>
            <option value="off">{{ t`关闭` }}</option>
            <option value="low">{{ t`低` }}</option>
            <option value="medium">{{ t`中` }}</option>
            <option value="high">{{ t`高` }}</option>
            <option value="max">{{ t`最高` }}</option>
          </select>
        </label>

        <div v-if="resolved_custom_api_source === 'deepseek'" class="cosmos-memory-hint">
          {{ t`DeepSeek：关闭会禁用思考；中级会按官方规则映射为高级。` }}
        </div>
        <div v-else-if="resolved_custom_api_source === 'openai'" class="cosmos-memory-hint">
          {{ t`OpenAI：级别会转换为 Chat Completions 的 reasoning_effort 参数。` }}
        </div>
        <div v-else class="cosmos-memory-hint">
          {{ t`思考级别暂支持 OpenAI 和 DeepSeek API 源。` }}
        </div>

        <label class="cosmos-memory-field">
          <span>{{ t`最大输出 Token` }}</span>
          <input
            v-model.number="settings.ai.max_output_tokens"
            class="text_pole"
            type="number"
            min="1"
            step="256"
            @change="normalize_max_output_tokens"
          />
        </label>

        <div class="cosmos-memory-hint">
          {{ t`包含模型的思维链与最终正文；推理模型建议至少设置为 8192。` }}
        </div>
      </div>
    </div>

    <!-- 容错与重试卡片 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-rotate-right"></i>
          {{ t`请求重试` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input id="cosmos_memory_retry_enabled" v-model="settings.ai.retry_enabled" type="checkbox" />
        <label for="cosmos_memory_retry_enabled">{{ t`启用报错重试` }}</label>
      </div>

      <template v-if="settings.ai.retry_enabled">
        <label class="cosmos-memory-field">
          <span>{{ t`最大重试次数` }}</span>
          <input
            v-model.number="settings.ai.retry_count"
            class="text_pole"
            type="number"
            min="1"
            :max="MAX_AI_RETRY_COUNT"
            step="1"
            @change="normalize_retry_count"
          />
        </label>
      </template>

      <div class="cosmos-memory-hint">
        {{
          t`适用于剧情总结、二次总结和人物重新生成。请求报错、空内容或格式校验失败时自动重试，默认重试 3 次（首次请求之外）；取消任务或鉴权失败时不重试。关闭后只请求一次。`
        }}
      </div>
    </div>

    <!-- 接口测试卡片 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-vial"></i>
          {{ t`连接测试` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input
          class="menu_button"
          type="button"
          :value="is_testing ? t`测试中...` : t`发送测试消息`"
          :disabled="is_test_disabled"
          @click="handle_send_test_message"
        />
      </div>

      <div
        v-if="test_result"
        class="cosmos-memory-test-result"
        :class="`cosmos-memory-test-result--${test_result.type}`"
      >
        {{ test_result.message }}
      </div>
    </div>

    <!-- 界面与状态栏卡片 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-desktop"></i>
          {{ t`界面与状态` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input
          id="cosmos_memory_status_bar_enabled"
          v-model="settings.status_bar.enabled"
          type="checkbox"
          @change="handle_status_bar_toggle"
        />
        <label for="cosmos_memory_status_bar_enabled">{{ t`启用状态栏` }}</label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后会在最新 AI 回复末尾显示状态栏，展示已启用功能的信息。` }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fetchCustomModelNames, resolveCustomApiSource, sendPing } from '@/api/ai';
import { triggerUpdateStatusBar } from '@/core/status-bar';
import { useSettingsStore } from '@/store/settings';
import {
  CUSTOM_API_SOURCE_OPTIONS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_AI_RETRY_COUNT,
  MAX_AI_RETRY_COUNT,
} from '@/type/settings';
import { storeToRefs } from 'pinia';

const custom_api_source_options = CUSTOM_API_SOURCE_OPTIONS.filter(option => option !== 'auto');

type TestResult = {
  type: 'success' | 'error';
  message: string;
};

const { settings } = storeToRefs(useSettingsStore());

const is_fetching_models = ref(false);
const is_testing = ref(false);
const test_result = ref<TestResult | null>(null);

const model_options = computed(() => {
  return [...new Set([settings.value.ai.selected_model, ...settings.value.ai.available_models])]
    .map(model => model.trim())
    .filter(Boolean);
});

const resolved_custom_api_source = computed(() => resolveCustomApiSource(settings.value.ai));
const is_reasoning_effort_supported = computed(() => ['openai', 'deepseek'].includes(resolved_custom_api_source.value));

const is_ai_request_disabled = computed(() => {
  if (settings.value.ai.use_tavern_api) {
    return false;
  }

  return !settings.value.ai.custom_api_url.trim() || !settings.value.ai.selected_model.trim();
});

const is_test_disabled = computed(() => {
  if (is_testing.value) {
    return true;
  }

  return is_ai_request_disabled.value;
});

async function handle_fetch_models() {
  is_fetching_models.value = true;
  test_result.value = null;

  try {
    const models = await fetchCustomModelNames(settings.value.ai);
    settings.value.ai.available_models = models;

    if (!settings.value.ai.selected_model && models.length > 0) {
      settings.value.ai.selected_model = models[0]!;
    }

    toastr.success(t`模型列表获取成功。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message);
    test_result.value = { type: 'error', message };
  } finally {
    is_fetching_models.value = false;
  }
}

async function handle_send_test_message() {
  is_testing.value = true;
  test_result.value = null;

  try {
    const response = await sendPing(settings.value.ai);
    const message = response.trim() || t`AI 返回了空内容。`;
    test_result.value = { type: 'success', message };
    toastr.success(t`测试消息发送成功。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message);
    test_result.value = { type: 'error', message };
  } finally {
    is_testing.value = false;
  }
}

function normalize_max_output_tokens() {
  const count = settings.value.ai.max_output_tokens;
  settings.value.ai.max_output_tokens = Number.isFinite(count)
    ? Math.max(1, Math.floor(count))
    : DEFAULT_MAX_OUTPUT_TOKENS;
}

function normalize_retry_count() {
  const count = settings.value.ai.retry_count;
  settings.value.ai.retry_count = Number.isFinite(count)
    ? Math.min(MAX_AI_RETRY_COUNT, Math.max(1, Math.floor(count)))
    : DEFAULT_AI_RETRY_COUNT;
}

function handle_status_bar_toggle() {
  if (settings.value.status_bar.enabled) {
    triggerUpdateStatusBar();
  } else {
    $('#chat .cosmos-memory-status-bar', window.parent.document).remove();
  }
}
</script>
