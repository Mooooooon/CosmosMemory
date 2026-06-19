<template>
  <div class="cosmos-memory-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ t`Cosmos Memory` }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="cosmos-memory-section-title flex-container">
          <strong class="flex1" data-i18n="API设置">{{ t`API设置` }}</strong>
        </div>

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

        <div
          v-if="test_result"
          class="cosmos-memory-test-result"
          :class="`cosmos-memory-test-result--${test_result.type}`"
        >
          {{ test_result.message }}
        </div>

        <div class="cosmos-memory-section-title flex-container">
          <strong class="flex1" data-i18n="总结">{{ t`总结` }}</strong>
        </div>

        <label class="cosmos-memory-field">
          <span>{{ t`保留原文的数量` }}</span>
          <input
            v-model.number="settings.compression.retained_original_assistant_messages"
            class="text_pole"
            type="number"
            min="0"
            step="1"
            @change="normalize_retained_original_count"
          />
        </label>

        <div class="cosmos-memory-hint">
          {{ t`当 AI 回复数量超过该值时，旧回复会被隐藏，并在生成时用已保存的摘要替代。` }}
        </div>

        <div class="cosmos-memory-row flex-container">
          <input class="menu_button" type="button" :value="t`查看已有总结`" @click="handle_show_summaries" />
        </div>

        <div class="cosmos-memory-section-title flex-container">
          <strong class="flex1" data-i18n="时间">{{ t`时间` }}</strong>
        </div>

        <div class="cosmos-memory-row flex-container">
          <input id="cosmos_memory_time_enabled" v-model="settings.time.enabled" type="checkbox" />
          <label for="cosmos_memory_time_enabled">{{ t`时间信息` }}</label>
        </div>

        <div class="cosmos-memory-hint">
          {{ t`开启后会在总结时维护当前故事时间，并注入到人物信息上方。` }}
        </div>

        <div class="cosmos-memory-row flex-container">
          <span>{{ t`当前时间` }}：{{ stored_time || t`尚未记录` }}</span>
          <input class="menu_button" type="button" :value="t`刷新`" @click="handle_refresh_time" />
        </div>

        <div class="cosmos-memory-section-title flex-container">
          <strong class="flex1" data-i18n="人物">{{ t`人物` }}</strong>
        </div>

        <div class="cosmos-memory-row flex-container">
          <input id="cosmos_memory_characters_enabled" v-model="settings.characters.enabled" type="checkbox" />
          <label for="cosmos_memory_characters_enabled">{{ t`人物信息` }}</label>
        </div>

        <div class="cosmos-memory-hint">
          {{ t`开启后会在总结时提取主要角色和会重复出现的次要角色，并注入到后续提示词中。` }}
        </div>

        <div class="cosmos-memory-row flex-container">
          <input class="menu_button" type="button" :value="t`查看人物信息`" @click="handle_show_characters" />
          <input
            class="menu_button"
            type="button"
            :value="is_regenerating_characters ? t`重新生成中...` : t`重新生成`"
            :disabled="is_regenerate_characters_disabled"
            @click="handle_regenerate_characters"
          />
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

    <dialog ref="character_dialog" class="cosmos-memory-dialog">
      <div class="cosmos-memory-dialog-header">
        <b>{{ t`当前聊天人物信息` }}</b>
        <button class="menu_button" type="button" @click="handle_close_characters">{{ t`关闭` }}</button>
      </div>

      <div v-if="stored_characters.length === 0" class="cosmos-memory-empty">
        {{ t`当前聊天记录还没有人物信息。` }}
      </div>

      <div v-else class="cosmos-memory-summary-list">
        <section v-if="primary_characters.length > 0">
          <h4>{{ t`主要角色` }}</h4>
          <article v-for="character in primary_characters" :key="character.name" class="cosmos-memory-summary-item">
            <div class="cosmos-memory-summary-meta">
              <b>{{ character.name }}</b>
            </div>
            <dl class="cosmos-memory-character-fields">
              <template v-if="character.background">
                <dt>{{ t`背景介绍` }}</dt>
                <dd>{{ character.background }}</dd>
              </template>
              <template v-if="character.appearance">
                <dt>{{ t`外貌描写` }}</dt>
                <dd>{{ character.appearance }}</dd>
              </template>
              <template v-if="character.personality">
                <dt>{{ t`性格描写` }}</dt>
                <dd>{{ character.personality }}</dd>
              </template>
            </dl>
          </article>
        </section>

        <section v-if="secondary_characters.length > 0">
          <h4>{{ t`次要角色` }}</h4>
          <article v-for="character in secondary_characters" :key="character.name" class="cosmos-memory-summary-item">
            <div class="cosmos-memory-summary-meta">
              <b>{{ character.name }}</b>
            </div>
            <p>{{ character.brief }}</p>
          </article>
        </section>
      </div>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { fetchCustomModelNames, sendPing } from '@/api/ai';
import { regenerateCharactersFromChat } from '@/core/character-regeneration';
import {
  getStoredCharacters,
  type PrimaryCharacter,
  type SecondaryCharacter,
  type StoredCharacter,
} from '@/core/characters';
import { getStoredMessageSummaries, type MessageSummary } from '@/core/summary';
import { getStoredTime } from '@/core/time';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

type TestResult = {
  type: 'success' | 'error';
  message: string;
};

const { settings } = storeToRefs(useSettingsStore());

const is_fetching_models = ref(false);
const is_testing = ref(false);
const is_regenerating_characters = ref(false);
const test_result = ref<TestResult | null>(null);
const stored_summaries = ref<MessageSummary[]>([]);
const stored_characters = ref<StoredCharacter[]>([]);
const stored_time = ref('');
const summary_dialog = ref<HTMLDialogElement | null>(null);
const character_dialog = ref<HTMLDialogElement | null>(null);

const model_options = computed(() => {
  return [...new Set([settings.value.ai.selected_model, ...settings.value.ai.available_models])]
    .map(model => model.trim())
    .filter(Boolean);
});

const is_test_disabled = computed(() => {
  if (is_testing.value) {
    return true;
  }

  return is_ai_request_disabled.value;
});

const is_ai_request_disabled = computed(() => {
  if (settings.value.ai.use_tavern_api) {
    return false;
  }

  return !settings.value.ai.custom_api_url.trim() || !settings.value.ai.selected_model.trim();
});

const is_regenerate_characters_disabled = computed(() => {
  return is_regenerating_characters.value || is_ai_request_disabled.value;
});

const primary_characters = computed(() => {
  return stored_characters.value.filter((character): character is PrimaryCharacter => character.type === 'primary');
});

const secondary_characters = computed(() => {
  return stored_characters.value.filter((character): character is SecondaryCharacter => character.type === 'secondary');
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
  refresh_stored_time();
  summary_dialog.value?.showModal();
}

function handle_close_summaries() {
  summary_dialog.value?.close();
}

function handle_show_characters() {
  stored_characters.value = getStoredCharacters();
  character_dialog.value?.showModal();
}

function handle_close_characters() {
  character_dialog.value?.close();
}

function handle_refresh_time() {
  refresh_stored_time();
}

function refresh_stored_time() {
  try {
    stored_time.value = getStoredTime();
  } catch (error) {
    console.warn('[CosmosMemory] 读取当前故事时间失败', error);
    stored_time.value = '';
  }
}

async function handle_regenerate_characters() {
  is_regenerating_characters.value = true;

  try {
    stored_characters.value = await regenerateCharactersFromChat(settings.value.ai);
    toastr.success(t`人物信息重新生成成功。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, 'Cosmos Memory');
  } finally {
    is_regenerating_characters.value = false;
  }
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

function normalize_retained_original_count() {
  const count = settings.value.compression.retained_original_assistant_messages;
  settings.value.compression.retained_original_assistant_messages = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 5;
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

.cosmos-memory-section-title {
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  margin: 12px 0 8px;
  padding-bottom: 4px;
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

.cosmos-memory-character-fields {
  margin: 8px 0 0;
}

.cosmos-memory-character-fields dt {
  font-weight: 700;
  margin-top: 8px;
}

.cosmos-memory-character-fields dd {
  margin: 4px 0 0;
  white-space: pre-wrap;
}
</style>
