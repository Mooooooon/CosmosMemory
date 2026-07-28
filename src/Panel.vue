<template>
  <div class="cosmos-memory-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ t`Cosmos Memory` }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <!-- Tabs Header -->
        <div class="cosmos-settings-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="cosmos-settings-tab"
            :class="{ active: active_tab === tab.id }"
            @click="active_tab = tab.id"
          >
            {{ tab.name }}
          </button>
        </div>

        <!-- Settings Tab -->
        <div v-show="active_tab === 'settings'" class="cosmos-settings-tab-panel">
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

          <hr class="sysHR" />

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

        <!-- Summary Tab -->
        <div v-show="active_tab === 'summary'" class="cosmos-settings-tab-panel">
          <div class="cosmos-memory-row flex-container">
            <input
              id="cosmos_memory_compression_enabled"
              v-model="settings.compression.enabled"
              type="checkbox"
              @change="handle_compression_toggle"
            />
            <label for="cosmos_memory_compression_enabled">{{ t`启用压缩` }}</label>
          </div>

          <label class="cosmos-memory-field">
            <span>{{ t`保留原文的数量` }}</span>
            <input
              v-model.number="settings.compression.retained_original_assistant_messages"
              class="text_pole"
              type="number"
              min="0"
              step="1"
              :disabled="!settings.compression.enabled"
              @change="normalize_retained_original_count"
            />
          </label>

          <div class="cosmos-memory-hint">
            {{ t`当 AI 回复数量超过该值时，旧回复会被隐藏，并在生成时用已保存的摘要替代。` }}
          </div>

          <div class="cosmos-memory-row flex-container">
            <input
              id="cosmos_memory_send_descriptions_and_world_info"
              v-model="settings.summary.send_descriptions_and_world_info"
              type="checkbox"
            />
            <label for="cosmos_memory_send_descriptions_and_world_info">{{ t`发送描述与世界书` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{
              t`开启后，总结请求会按顺序附带世界书（角色前）、玩家描述、角色描述、世界书（角色后）；世界书条目按待总结原消息使用酒馆规则激活。`
            }}
          </div>

          <div class="cosmos-memory-row flex-container">
            <input
              id="cosmos_memory_send_previous_message_original"
              v-model="settings.summary.send_previous_message_original"
              type="checkbox"
            />
            <label for="cosmos_memory_send_previous_message_original">{{ t`发送上一条 AI 原文` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{ t`开启后，总结请求会附带当前回复之前最近一条 AI 回复的原文；若与已有总结重合，则只发送原文。` }}
          </div>

          <div class="cosmos-memory-row cosmos-memory-sub-option flex-container">
            <input
              id="cosmos_memory_include_opening_message_original"
              v-model="settings.summary.include_opening_message_original"
              type="checkbox"
              :disabled="!settings.summary.send_previous_message_original"
            />
            <label for="cosmos_memory_include_opening_message_original">{{ t`包括开场白` }}</label>
          </div>

          <div class="cosmos-memory-row flex-container">
            <input
              id="cosmos_memory_send_summary_context"
              v-model="settings.summary.send_summary_context"
              type="checkbox"
            />
            <label for="cosmos_memory_send_summary_context">{{ t`发送上下文` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{ t`开启后，总结请求会附带最近的已有总结，帮助 AI 理解之前的剧情走向。` }}
          </div>

          <label class="cosmos-memory-field">
            <span>{{ t`发送总结条数` }}</span>
            <input
              v-model.number="settings.summary.summary_context_count"
              class="text_pole"
              type="number"
              min="1"
              step="1"
              :disabled="!settings.summary.send_summary_context"
              @change="normalize_summary_context_count"
            />
          </label>

          <hr class="sysHR" />

          <div class="cosmos-memory-row flex-container">
            <input
              id="cosmos_memory_summary_rollup_enabled"
              v-model="settings.summary_rollup.enabled"
              type="checkbox"
            />
            <label for="cosmos_memory_summary_rollup_enabled">{{ t`启用二次压缩` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{
              t`开启后，当未合并的总结达到触发条数时，会自动将旧总结二次总结成一篇连贯的前情文章，替代逐楼摘要注入。`
            }}
          </div>

          <label class="cosmos-memory-field">
            <span>{{ t`触发条数` }}</span>
            <input
              v-model.number="settings.summary_rollup.trigger_summary_count"
              class="text_pole"
              type="number"
              min="2"
              step="1"
              :disabled="!settings.summary_rollup.enabled"
              @change="normalize_rollup_trigger_count"
            />
          </label>

          <label class="cosmos-memory-field">
            <span>{{ t`保留最近总结条数` }}</span>
            <input
              v-model.number="settings.summary_rollup.retained_recent_summary_count"
              class="text_pole"
              type="number"
              min="0"
              step="1"
              :disabled="!settings.summary_rollup.enabled"
              @change="normalize_rollup_retained_count"
            />
          </label>

          <div class="cosmos-memory-hint">
            {{ t`最近的总结不参与合并，保留逐楼细节；只有更早的总结会被并入前情文章。` }}
          </div>

          <div class="cosmos-memory-row flex-container">
            <input
              class="menu_button"
              type="button"
              :value="is_rolling_up ? t`二次总结中...` : t`立即二次总结`"
              :disabled="is_rolling_up || is_ai_request_disabled"
              @click="handle_run_rollup"
            />
          </div>

          <div class="cosmos-memory-row flex-container">
            <input class="menu_button" type="button" :value="t`查看已有总结`" @click="handle_show_summaries" />
            <input
              class="menu_button"
              type="button"
              :value="is_checking_memory ? t`停止检查` : t`手动检查记忆`"
              @click="handle_memory_check_button"
            />
          </div>
        </div>

        <!-- Current Info Tab -->
        <div v-show="active_tab === 'current_info'" class="cosmos-settings-tab-panel">
          <div class="cosmos-memory-row flex-container">
            <input id="cosmos_memory_current_info_enabled" v-model="settings.current_info.enabled" type="checkbox" />
            <label for="cosmos_memory_current_info_enabled">{{ t`启用当前信息` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{ t`开启后会在总结时维护当前时间、地点和角色状态，并注入到人物信息上方。` }}
          </div>

          <div v-if="editing_current_info" class="cosmos-memory-edit-form">
            <label class="cosmos-memory-field">
              <span>{{ t`当前时间` }}</span>
              <input v-model.trim="editing_current_info.current_time" class="text_pole" type="text" />
            </label>

            <label class="cosmos-memory-field">
              <span>{{ t`当前地点` }}</span>
              <input v-model.trim="editing_current_info.location" class="text_pole" type="text" />
            </label>

            <div
              v-for="(character, index) in editing_current_info.characters"
              :key="index"
              class="cosmos-memory-edit-form"
            >
              <label class="cosmos-memory-field">
                <span>{{ t`角色名` }}</span>
                <input v-model.trim="character.name" class="text_pole" type="text" />
              </label>
              <label class="cosmos-memory-field">
                <span>{{ t`角色服装` }}</span>
                <input v-model.trim="character.clothing" class="text_pole" type="text" />
              </label>
              <label class="cosmos-memory-field">
                <span>{{ t`角色状态` }}</span>
                <input v-model.trim="character.status" class="text_pole" type="text" />
              </label>
              <div class="cosmos-memory-entity-actions">
                <button class="menu_button" type="button" @click="editing_current_info.characters.splice(index, 1)">
                  {{ t`移除该角色` }}
                </button>
              </div>
            </div>

            <div class="cosmos-memory-entity-actions">
              <button class="menu_button" type="button" @click="handle_add_current_character">
                {{ t`添加角色` }}
              </button>
              <button class="menu_button" type="button" @click="handle_save_current_info">{{ t`保存` }}</button>
              <button class="menu_button" type="button" @click="editing_current_info = null">{{ t`取消` }}</button>
            </div>
          </div>

          <div v-else class="cosmos-memory-current-info">
            <div class="cosmos-memory-row flex-container">
              <span>{{ t`当前时间` }}：{{ stored_current_info.current_time || t`尚未记录` }}</span>
              <input class="menu_button" type="button" :value="t`刷新`" @click="handle_refresh_current_info" />
              <input class="menu_button" type="button" :value="t`编辑`" @click="handle_edit_current_info" />
            </div>
            <div class="cosmos-memory-row flex-container">
              <span>{{ t`当前地点` }}：{{ stored_current_info.location || t`尚未记录` }}</span>
            </div>
            <div v-if="current_character_entries.length > 0" class="cosmos-memory-current-characters">
              <div class="cosmos-memory-current-characters-title">{{ t`当前角色列表` }}</div>
              <dl v-for="[name, character] in current_character_entries" :key="name">
                <dt>{{ name }}</dt>
                <dd v-if="character.clothing">{{ t`角色服装` }}：{{ character.clothing }}</dd>
                <dd v-if="character.status">{{ t`角色状态` }}：{{ character.status }}</dd>
              </dl>
            </div>
          </div>
        </div>

        <!-- Locations Tab -->
        <div v-show="active_tab === 'locations'" class="cosmos-settings-tab-panel">
          <div class="cosmos-memory-row flex-container">
            <input id="cosmos_memory_locations_enabled" v-model="settings.locations.enabled" type="checkbox" />
            <label for="cosmos_memory_locations_enabled">{{ t`启用地点信息` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{ t`开启后会在总结时记录有重复使用价值的地点，并按世界/大陆、国家、城市、场景、房间层级注入。` }}
          </div>

          <div class="cosmos-memory-row flex-container">
            <input class="menu_button" type="button" :value="t`查看地点信息`" @click="handle_show_locations" />
          </div>
        </div>

        <!-- Items Tab -->
        <div v-show="active_tab === 'items'" class="cosmos-settings-tab-panel">
          <div class="cosmos-memory-row flex-container">
            <input id="cosmos_memory_items_enabled" v-model="settings.items.enabled" type="checkbox" />
            <label for="cosmos_memory_items_enabled">{{ t`启用物品信息` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{ t`开启后会在总结时记录影响剧情的重要道具，并注入到人物信息上方。` }}
          </div>

          <div class="cosmos-memory-row flex-container">
            <input class="menu_button" type="button" :value="t`查看物品信息`" @click="handle_show_items" />
          </div>
        </div>

        <!-- Characters Tab -->
        <div v-show="active_tab === 'characters'" class="cosmos-settings-tab-panel">
          <div class="cosmos-memory-row flex-container">
            <input id="cosmos_memory_characters_enabled" v-model="settings.characters.enabled" type="checkbox" />
            <label for="cosmos_memory_characters_enabled">{{ t`启用人物信息` }}</label>
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
        </div>

        <!-- Vector Recall Tab -->
        <div v-show="active_tab === 'vector_recall'" class="cosmos-settings-tab-panel">
          <VectorRecallTab />
        </div>

        <hr class="sysHR" />
      </div>
    </div>

    <dialog ref="summary_dialog" class="cosmos-memory-dialog">
      <div class="cosmos-memory-dialog-header">
        <b>{{ t`当前聊天总结` }}</b>
        <button class="menu_button" type="button" @click="handle_close_summaries">{{ t`关闭` }}</button>
      </div>

      <div v-if="stored_summaries.length === 0 && !stored_rollup" class="cosmos-memory-empty">
        {{ t`当前聊天记录还没有总结。` }}
      </div>

      <div v-else class="cosmos-memory-summary-list">
        <article v-if="stored_rollup" class="cosmos-memory-summary-item">
          <div class="cosmos-memory-summary-meta">
            <b>
              {{ t`前情文章` }}（{{
                t`已合并 {count} 条总结`.replace('{count}', String(stored_rollup.sources.length))
              }}）
            </b>
            <span>{{ format_time(stored_rollup.updated_at) }}</span>
          </div>
          <p>{{ stored_rollup.article }}</p>
        </article>
        <article v-for="summary in stored_summaries" :key="summary.message_id" class="cosmos-memory-summary-item">
          <div class="cosmos-memory-summary-meta">
            <b>
              {{ t`楼层` }} #{{ summary.message_id }}
              <template v-if="rollup_covered_ids.has(summary.message_id)">（{{ t`已并入前情文章` }}）</template>
            </b>
            <span>{{ format_time(summary.updated_at) }}</span>
          </div>
          <p>{{ summary.summary }}</p>
        </article>
      </div>
    </dialog>

    <ItemDialog ref="item_dialog" />
    <LocationDialog ref="location_dialog" />
    <CharacterDialog ref="character_dialog" />
  </div>
</template>

<script setup lang="ts">
import { fetchCustomModelNames, sendPing } from '@/api/ai';
import { regenerateCharactersFromChat } from '@/core/character-regeneration';
import { applySummaryCompressionForNextGeneration } from '@/core/compression';
import {
  getStoredMessageSummaries,
  runMemoryBacktrackCheck,
  stopSummarizeTasks,
  type MemoryBacktrackCheckResult,
  type MessageSummary,
} from '@/core/summary';
import { getStoredCurrentInfo, manualSaveCurrentInfo, type CurrentInfo } from '@/core/current-info';
import { getValidSummaryRollup, runSummaryRollup, type SummaryRollup } from '@/core/summary-rollup';
import { triggerUpdateStatusBar } from '@/core/status-bar';
import CharacterDialog from '@/panel/CharacterDialog.vue';
import ItemDialog from '@/panel/ItemDialog.vue';
import LocationDialog from '@/panel/LocationDialog.vue';
import VectorRecallTab from '@/panel/VectorRecallTab.vue';
import { useSettingsStore } from '@/store/settings';
import { CUSTOM_API_SOURCE_OPTIONS, DEFAULT_MAX_OUTPUT_TOKENS } from '@/type/settings';
import { storeToRefs } from 'pinia';

const custom_api_source_options = CUSTOM_API_SOURCE_OPTIONS.filter(option => option !== 'auto');

type TestResult = {
  type: 'success' | 'error';
  message: string;
};

/** 当前信息编辑表单：characters 由 Record 展平为数组便于 v-for 编辑 */
type EditingCurrentInfo = {
  current_time: string;
  location: string;
  characters: Array<{ name: string; clothing: string; status: string }>;
};

const { settings } = storeToRefs(useSettingsStore());

const active_tab = ref('settings');
const tabs = computed(() => [
  { id: 'settings', name: t`设置` },
  { id: 'summary', name: t`总结` },
  { id: 'current_info', name: t`当前信息` },
  { id: 'characters', name: t`人物` },
  { id: 'locations', name: t`地点` },
  { id: 'items', name: t`物品` },
  { id: 'vector_recall', name: t`向量召回` },
]);

const is_fetching_models = ref(false);
const is_testing = ref(false);
const is_checking_memory = ref(false);
const is_regenerating_characters = ref(false);
const is_rolling_up = ref(false);
const test_result = ref<TestResult | null>(null);
const stored_summaries = ref<MessageSummary[]>([]);
const stored_rollup = ref<SummaryRollup | null>(null);
const stored_current_info = ref<CurrentInfo>({
  current_time: '',
  location: '',
  characters: {},
});
const editing_current_info = ref<EditingCurrentInfo | null>(null);
const summary_dialog = ref<HTMLDialogElement | null>(null);
const character_dialog = ref<InstanceType<typeof CharacterDialog> | null>(null);
const item_dialog = ref<InstanceType<typeof ItemDialog> | null>(null);
const location_dialog = ref<InstanceType<typeof LocationDialog> | null>(null);

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

const current_character_entries = computed(() => {
  return Object.entries(stored_current_info.value.characters).sort(([left], [right]) => left.localeCompare(right));
});

const rollup_covered_ids = computed(() => {
  return new Set(stored_rollup.value?.sources.map(source => source.message_id) ?? []);
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
  refresh_stored_memory();
  summary_dialog.value?.showModal();
}

function handle_close_summaries() {
  summary_dialog.value?.close();
}

function handle_show_characters() {
  character_dialog.value?.open();
}

function handle_show_items() {
  item_dialog.value?.open();
}

function handle_show_locations() {
  location_dialog.value?.open();
}

function handle_refresh_current_info() {
  refresh_stored_current_info();
}

function handle_edit_current_info() {
  refresh_stored_current_info();
  editing_current_info.value = {
    current_time: stored_current_info.value.current_time,
    location: stored_current_info.value.location,
    characters: Object.entries(stored_current_info.value.characters).map(([name, character]) => ({
      name,
      clothing: character.clothing,
      status: character.status,
    })),
  };
}

function handle_add_current_character() {
  editing_current_info.value?.characters.push({ name: '', clothing: '', status: '' });
}

function handle_save_current_info() {
  const form = editing_current_info.value;
  if (!form) {
    return;
  }

  try {
    stored_current_info.value = manualSaveCurrentInfo({
      current_time: form.current_time,
      location: form.location,
      characters: Object.fromEntries(
        form.characters
          .filter(character => character.name.trim())
          .map(character => [character.name.trim(), { clothing: character.clothing, status: character.status }]),
      ),
    });
    editing_current_info.value = null;
    triggerUpdateStatusBar();
    toastr.success(t`当前信息已保存。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 保存当前信息失败`);
  }
}

function refresh_stored_current_info() {
  try {
    stored_current_info.value = getStoredCurrentInfo();
  } catch (error) {
    console.warn('[CosmosMemory] 读取当前信息失败', error);
    stored_current_info.value = {
      current_time: '',
      location: '',
      characters: {},
    };
  }
}

function refresh_stored_memory() {
  stored_summaries.value = getStoredMessageSummaries();
  try {
    stored_rollup.value = getValidSummaryRollup();
  } catch (error) {
    console.warn('[CosmosMemory] 读取前情文章失败', error);
    stored_rollup.value = null;
  }
  refresh_stored_current_info();
}

async function handle_run_rollup() {
  is_rolling_up.value = true;

  try {
    const rollup = await runSummaryRollup();
    refresh_stored_memory();
    if (rollup) {
      toastr.success(
        t`二次总结完成，已合并 {count} 条总结。`.replace('{count}', String(rollup.sources.length)),
        'Cosmos Memory',
      );
    } else {
      toastr.info(t`没有可合并的总结。`, 'Cosmos Memory');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 二次总结失败`);
  } finally {
    is_rolling_up.value = false;
  }
}

function handle_memory_check_button() {
  if (is_checking_memory.value) {
    // 检查进行中再次点击 = 停止补全
    stopSummarizeTasks();
    return;
  }

  void handle_check_memory();
}

async function handle_check_memory() {
  is_checking_memory.value = true;

  try {
    const result = await runMemoryBacktrackCheck();
    refresh_stored_memory();
    if (result.removed_summaries.length > 0 || result.summarized_summaries.length > 0) {
      triggerUpdateStatusBar();
    }
    if (result.aborted) {
      toastr.warning(t`记忆检查已手动停止。`, 'Cosmos Memory');
    } else {
      toastr.success(format_memory_check_result(result), 'Cosmos Memory');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 记忆检查失败`);
  } finally {
    is_checking_memory.value = false;
  }
}

function format_memory_check_result(result: MemoryBacktrackCheckResult): string {
  const removed_count = result.removed_summaries.length;
  const summarized_count = result.summarized_summaries.length;
  if (removed_count === 0 && summarized_count === 0) {
    return t`记忆检查完成，没有发现需要修复的内容。`;
  }

  return t`记忆检查完成：已清理 {removed} 条悬空总结，补全 {summarized} 条缺失总结。`
    .replace('{removed}', String(removed_count))
    .replace('{summarized}', String(summarized_count));
}

async function handle_regenerate_characters() {
  is_regenerating_characters.value = true;

  try {
    await regenerateCharactersFromChat(settings.value.ai);
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

function handle_compression_toggle() {
  // 关闭压缩时立即恢复被压缩隐藏的楼层；开启时无需处理，下次生成前会自动应用压缩
  if (!settings.value.compression.enabled) {
    void applySummaryCompressionForNextGeneration(false).catch(error => {
      console.error('[CosmosMemory] 关闭压缩时恢复隐藏楼层失败', error);
    });
  }
}

function normalize_retained_original_count() {
  const count = settings.value.compression.retained_original_assistant_messages;
  settings.value.compression.retained_original_assistant_messages = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 5;
}

function normalize_max_output_tokens() {
  const count = settings.value.ai.max_output_tokens;
  settings.value.ai.max_output_tokens = Number.isFinite(count)
    ? Math.max(1, Math.floor(count))
    : DEFAULT_MAX_OUTPUT_TOKENS;
}

function normalize_summary_context_count() {
  const count = settings.value.summary.summary_context_count;
  settings.value.summary.summary_context_count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 5;
}

function normalize_rollup_trigger_count() {
  const count = settings.value.summary_rollup.trigger_summary_count;
  settings.value.summary_rollup.trigger_summary_count = Number.isFinite(count) ? Math.max(2, Math.floor(count)) : 30;
}

function normalize_rollup_retained_count() {
  const count = settings.value.summary_rollup.retained_recent_summary_count;
  settings.value.summary_rollup.retained_recent_summary_count = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 10;
}

function handle_status_bar_toggle() {
  if (settings.value.status_bar.enabled) {
    triggerUpdateStatusBar();
  } else {
    // 关闭时移除已有状态栏
    $('#chat .cosmos-memory-status-bar', window.parent.document).remove();
  }
}
</script>

<style scoped>
.cosmos-memory-row {
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}

.cosmos-memory-sub-option {
  margin-left: 24px;
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

.cosmos-memory-current-info {
  margin: 8px 0;
}

.cosmos-memory-current-characters {
  margin-top: 8px;
}

.cosmos-memory-current-characters-title {
  font-weight: 700;
  margin-bottom: 4px;
}

.cosmos-memory-current-characters dl {
  margin: 6px 0;
}

.cosmos-memory-current-characters dt {
  font-weight: 700;
}

.cosmos-memory-current-characters dd {
  margin: 2px 0 0 12px;
  white-space: pre-wrap;
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

/* 弹窗、编辑表单等公共样式在 global.css 中（scoped 样式对子组件 dialog 不生效） */

/* 扩展设置面板 Tab 样式 */
.cosmos-settings-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  padding-bottom: 10px;
}

.cosmos-settings-tab {
  flex: 1 1 calc(33.33% - 6px);
  min-width: 80px;
  padding: 8px 10px;
  font-size: 0.88em;
  font-weight: 500;
  text-align: center;
  color: var(--SmartThemeBodyColor);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  user-select: none;
}

.cosmos-settings-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}

.cosmos-settings-tab:active {
  transform: translateY(0);
}

.cosmos-settings-tab.active {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 100%);
  border-color: var(--SmartThemeBorderColor);
  font-weight: 700;
  box-shadow:
    0 4px 10px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
}

.cosmos-settings-tab-panel {
  animation: cosmos-panel-fade-in 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes cosmos-panel-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
