<template>
<<<<<<< HEAD
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
            <input
              id="cosmos_memory_send_descriptions_and_world_info"
              v-model="settings.summary.send_descriptions_and_world_info"
              type="checkbox"
            />
            <label for="cosmos_memory_send_descriptions_and_world_info">{{ t`发送描述与世界书` }}</label>
          </div>

          <div class="cosmos-memory-hint">
            {{ t`开启后，总结请求会按顺序附带世界书（角色前）、玩家描述、角色描述、世界书（角色后）。` }}
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

          <div class="cosmos-memory-row flex-container">
            <input class="menu_button" type="button" :value="t`查看已有总结`" @click="handle_show_summaries" />
            <input
              class="menu_button"
              type="button"
              :value="is_checking_memory ? t`检查中...` : t`手动检查记忆`"
              :disabled="is_checking_memory"
              @click="handle_check_memory"
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

          <div class="cosmos-memory-current-info">
            <div class="cosmos-memory-row flex-container">
              <span>{{ t`当前时间` }}：{{ stored_current_info.current_time || t`尚未记录` }}</span>
              <input class="menu_button" type="button" :value="t`刷新`" @click="handle_refresh_current_info" />
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
=======
  <div class="example-extension-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ t`插件示例` }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="example-extension_block flex-container">
          <input class="menu_button" type="submit" :value="t`示例按钮`" @click="handle_button_click" />
        </div>

        <div class="example-extension_block flex-container">
          <input v-model="settings.button_selected" type="checkbox" />
          <label for="example_setting">{{ t`示例开关` }}</label>
>>>>>>> 9f42542b0815b4cf67f8b9a81b484596cb0edda3
        </div>

        <hr class="sysHR" />
      </div>
    </div>
<<<<<<< HEAD

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

    <dialog ref="item_dialog" class="cosmos-memory-dialog">
      <div class="cosmos-memory-dialog-header">
        <b>{{ t`当前聊天物品信息` }}</b>
        <button class="menu_button" type="button" @click="handle_close_items">{{ t`关闭` }}</button>
      </div>

      <div v-if="stored_items.length === 0" class="cosmos-memory-empty">
        {{ t`当前聊天记录还没有物品信息。` }}
      </div>

      <div v-else class="cosmos-memory-summary-list">
        <article v-for="item in stored_items" :key="item.name" class="cosmos-memory-summary-item">
          <div class="cosmos-memory-summary-meta">
            <b>{{ item.name }}</b>
          </div>
          <p>{{ item.brief }}</p>
        </article>
      </div>
    </dialog>

    <dialog ref="location_dialog" class="cosmos-memory-dialog">
      <div class="cosmos-memory-dialog-header">
        <b>{{ t`当前聊天地点信息` }}</b>
        <button class="menu_button" type="button" @click="handle_close_locations">{{ t`关闭` }}</button>
      </div>

      <div v-if="stored_locations.length === 0" class="cosmos-memory-empty">
        {{ t`当前聊天记录还没有地点信息。` }}
      </div>

      <div v-else class="cosmos-memory-summary-list">
        <article
          v-for="world in stored_locations"
          :key="world.name"
          class="cosmos-memory-summary-item cosmos-memory-location-item"
        >
          <div class="cosmos-memory-summary-meta">
            <b>{{ t`世界/大陆` }}：{{ world.name }}</b>
          </div>
          <p v-if="world.brief">{{ world.brief }}</p>

          <section v-for="country in sorted_location_countries(world)" :key="country.name">
            <h4>{{ t`国家/地区` }}：{{ country.name }}</h4>
            <p v-if="country.brief">{{ country.brief }}</p>

            <section v-for="city in sorted_location_cities(country)" :key="city.name">
              <h5>{{ t`城市/城镇` }}：{{ city.name }}</h5>
              <p v-if="city.brief">{{ city.brief }}</p>

              <section v-for="scene in sorted_location_scenes(city)" :key="scene.name">
                <h6>{{ t`场景/建筑` }}：{{ scene.name }}</h6>
                <p v-if="scene.brief">{{ scene.brief }}</p>

                <dl v-if="sorted_location_rooms(scene).length > 0" class="cosmos-memory-location-rooms">
                  <template v-for="room in sorted_location_rooms(scene)" :key="room.name">
                    <dt>{{ t`房间/具体地点` }}：{{ room.name }}</dt>
                    <dd v-if="room.brief">{{ room.brief }}</dd>
                  </template>
                </dl>
              </section>
            </section>
          </section>
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
=======
>>>>>>> 9f42542b0815b4cf67f8b9a81b484596cb0edda3
  </div>
</template>

<script setup lang="ts">
<<<<<<< HEAD
import { fetchCustomModelNames, sendPing } from '@/api/ai';
import { regenerateCharactersFromChat } from '@/core/character-regeneration';
import {
  getStoredCharacters,
  type PrimaryCharacter,
  type SecondaryCharacter,
  type StoredCharacter,
} from '@/core/characters';
import { getStoredItems, type StoredItem } from '@/core/items';
import {
  getStoredMessageSummaries,
  runMemoryBacktrackCheck,
  type MemoryBacktrackCheckResult,
  type MessageSummary,
} from '@/core/summary';
import { getStoredCurrentInfo, type CurrentInfo } from '@/core/current-info';
import {
  getStoredLocations,
  type StoredLocationCity,
  type StoredLocationCountry,
  type StoredLocationRoom,
  type StoredLocationScene,
  type StoredLocationWorld,
} from '@/core/locations';
import { triggerUpdateStatusBar } from '@/core/status-bar';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

type TestResult = {
  type: 'success' | 'error';
  message: string;
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
]);

const is_fetching_models = ref(false);
const is_testing = ref(false);
const is_checking_memory = ref(false);
const is_regenerating_characters = ref(false);
const test_result = ref<TestResult | null>(null);
const stored_summaries = ref<MessageSummary[]>([]);
const stored_characters = ref<StoredCharacter[]>([]);
const stored_items = ref<StoredItem[]>([]);
const stored_locations = ref<StoredLocationWorld[]>([]);
const stored_current_info = ref<CurrentInfo>({
  current_time: '',
  location: '',
  characters: {},
});
const summary_dialog = ref<HTMLDialogElement | null>(null);
const character_dialog = ref<HTMLDialogElement | null>(null);
const item_dialog = ref<HTMLDialogElement | null>(null);
const location_dialog = ref<HTMLDialogElement | null>(null);

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

const current_character_entries = computed(() => {
  return Object.entries(stored_current_info.value.characters).sort(([left], [right]) => left.localeCompare(right));
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
  stored_characters.value = getStoredCharacters();
  character_dialog.value?.showModal();
}

function handle_close_characters() {
  character_dialog.value?.close();
}

function handle_show_items() {
  stored_items.value = getStoredItems();
  item_dialog.value?.showModal();
}

function handle_close_items() {
  item_dialog.value?.close();
}

function handle_show_locations() {
  stored_locations.value = getStoredLocations();
  location_dialog.value?.showModal();
}

function handle_close_locations() {
  location_dialog.value?.close();
}

function handle_refresh_current_info() {
  refresh_stored_current_info();
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
  stored_characters.value = getStoredCharacters();
  stored_items.value = getStoredItems();
  stored_locations.value = getStoredLocations();
  refresh_stored_current_info();
}

async function handle_check_memory() {
  is_checking_memory.value = true;

  try {
    const result = await runMemoryBacktrackCheck();
    refresh_stored_memory();
    if (result.removed_summaries.length > 0 || result.summarized_summaries.length > 0) {
      triggerUpdateStatusBar();
    }
    toastr.success(format_memory_check_result(result), 'Cosmos Memory');
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

  return `${t`记忆检查完成：已清理`} ${removed_count} ${t`条悬空总结，补全`} ${summarized_count} ${t`条缺失总结。`}`;
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

function normalize_summary_context_count() {
  const count = settings.value.summary.summary_context_count;
  settings.value.summary.summary_context_count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 5;
}

function handle_status_bar_toggle() {
  if (settings.value.status_bar.enabled) {
    triggerUpdateStatusBar();
  } else {
    // 关闭时移除已有状态栏
    $('#chat .cosmos-memory-status-bar', window.parent.document).remove();
  }
}

function sorted_location_countries(world: StoredLocationWorld): StoredLocationCountry[] {
  return Object.values(world.countries).sort((left, right) => left.name.localeCompare(right.name));
}

function sorted_location_cities(country: StoredLocationCountry): StoredLocationCity[] {
  return Object.values(country.cities).sort((left, right) => left.name.localeCompare(right.name));
}

function sorted_location_scenes(city: StoredLocationCity): StoredLocationScene[] {
  return Object.values(city.scenes).sort((left, right) => left.name.localeCompare(right.name));
}

function sorted_location_rooms(scene: StoredLocationScene): StoredLocationRoom[] {
  return Object.values(scene.rooms).sort((left, right) => left.name.localeCompare(right.name));
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

.cosmos-memory-location-item section {
  margin: 10px 0 0 12px;
}

.cosmos-memory-location-item h4,
.cosmos-memory-location-item h5 {
  margin: 8px 0 0;
}

.cosmos-memory-location-rooms {
  margin: 8px 0 0 12px;
}

.cosmos-memory-location-rooms dt {
  font-weight: 700;
  margin-top: 6px;
}

.cosmos-memory-location-rooms dd {
  margin: 4px 0 0 12px;
  white-space: pre-wrap;
}

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
=======
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());

const handle_button_click = () => {
  toastr.success('你好呀!');
};
</script>

<style scoped></style>
>>>>>>> 9f42542b0815b4cf67f8b9a81b484596cb0edda3
