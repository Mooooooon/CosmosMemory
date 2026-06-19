<template>
  <div class="cosmos-memory-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ t`Cosmos Memory` }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="cosmos-memory-row flex-container">
          <input id="cosmos_memory_use_tavern_api" v-model="settings.ai.use_tavern_api" type="checkbox" />
          <label for="cosmos_memory_use_tavern_api">{{ t`是否使用酒馆API` }}</label>
        </div>

        <div v-if="settings.ai.use_tavern_api" class="cosmos-memory-hint">
          {{ t`将使用 SillyTavern 当前启用的 API 设置。` }}
        </div>

        <template v-else>
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
            <select v-model="settings.ai.selected_model" class="text_pole" :disabled="model_options.length === 0">
              <option value="">{{ t`请选择模型` }}</option>
              <option v-for="model in model_options" :key="model" :value="model">
                {{ model }}
              </option>
            </select>
          </label>
        </template>

        <div class="cosmos-memory-row flex-container">
          <input
            class="menu_button"
            type="button"
            :value="is_testing ? t`测试中...` : t`发送测试消息`"
            :disabled="is_test_disabled"
            @click="handle_send_test_message"
          />
        </div>

        <div v-if="test_result" class="cosmos-memory-test-result" :class="`cosmos-memory-test-result--${test_result.type}`">
          {{ test_result.message }}
        </div>

        <div class="cosmos-memory-row flex-container">
          <input class="menu_button" type="button" :value="t`查看已有总结`" @click="handle_show_summaries" />
        </div>

        <hr class="sysHR" />
      </div>
    </div>

    <dialog ref="summary_dialog" class="cosmos-memory-dialog">
      <div class="cosmos-memory-dialog-header">
        <b>{{ t`当前聊天总结` }}</b>
        <button class="menu_button" type="button" @click="handle_close_summaries">{{ t`关闭` }}</button>
      </div>

      <div v-if="stored_summaries.length === 0" class="cosmos-memory-empty">
        {{ t`当前聊天记录还没有总结。` }}
      </div>

      <div v-else class="cosmos-memory-summary-list">
        <article v-for="summary in stored_summaries" :key="summary.message_id" class="cosmos-memory-summary-item">
          <div class="cosmos-memory-summary-meta">
            <b>{{ t`楼层` }} #{{ summary.message_id }}</b>
            <span>{{ format_time(summary.updated_at) }}</span>
          </div>
          <p>{{ summary.summary }}</p>
        </article>
      </div>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { fetchCustomModelNames, sendPing } from '@/api/ai';
import { getStoredMessageSummaries, type MessageSummary } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

type TestResult = {
  type: 'success' | 'error';
  message: string;
};

const { settings } = storeToRefs(useSettingsStore());

const is_fetching_models = ref(false);
const is_testing = ref(false);
const test_result = ref<TestResult | null>(null);
const stored_summaries = ref<MessageSummary[]>([]);
const summary_dialog = ref<HTMLDialogElement | null>(null);

const model_options = computed(() => {
  return [...new Set([settings.value.ai.selected_model, ...settings.value.ai.available_models])]
    .map(model => model.trim())
    .filter(Boolean);
});

const is_test_disabled = computed(() => {
  if (is_testing.value) {
    return true;
  }

  if (settings.value.ai.use_tavern_api) {
    return false;
  }

  return !settings.value.ai.custom_api_url.trim() || !settings.value.ai.selected_model.trim();
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

function handle_show_summaries() {
  stored_summaries.value = getStoredMessageSummaries();
  summary_dialog.value?.showModal();
}

function handle_close_summaries() {
  summary_dialog.value?.close();
}

function format_time(value: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
</script>

<style scoped>
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

.cosmos-memory-dialog {
  background: var(--SmartThemeBlurTintColor);
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  color: var(--SmartThemeBodyColor);
  max-height: min(720px, 80vh);
  max-width: min(720px, 90vw);
  padding: 12px;
  width: 720px;
}

.cosmos-memory-dialog::backdrop {
  background: rgba(0, 0, 0, 0.45);
}

.cosmos-memory-dialog-header,
.cosmos-memory-summary-meta {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.cosmos-memory-empty {
  margin-top: 12px;
  opacity: 0.85;
}

.cosmos-memory-summary-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  overflow-y: auto;
}

.cosmos-memory-summary-item {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 10px;
}

.cosmos-memory-summary-item p {
  margin: 8px 0 0;
  white-space: pre-wrap;
}

.cosmos-memory-summary-meta span {
  font-size: 0.9em;
  opacity: 0.75;
}
</style>
