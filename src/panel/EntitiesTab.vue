<template>
  <div class="cosmos-settings-tab-panel">
    <!-- 1. 当前信息卡片 -->
    <div class="cosmos-section-card cosmos-entity-card">
      <div class="cosmos-entity-title-row">
        <input id="cosmos_memory_current_info_enabled" v-model="settings.current_info.enabled" type="checkbox" />
        <label for="cosmos_memory_current_info_enabled" class="cosmos-entity-title">
          <i class="fa-solid fa-clock"></i>
          {{ t`当前信息` }}
        </label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后会在总结时维护当前时间、地点和角色状态，并注入到人物信息上方。` }}
      </div>

      <div class="cosmos-entity-actions">
        <button class="menu_button" type="button" @click="handle_show_current_info">
          {{ t`查看当前信息` }}
        </button>
      </div>
    </div>

    <!-- 2. 设定变更卡片 -->
    <div class="cosmos-section-card cosmos-entity-card">
      <div class="cosmos-entity-title-row">
        <input
          id="cosmos_memory_setting_changes_enabled"
          v-model="settings.setting_changes.enabled"
          type="checkbox"
          @change="handle_setting_changes_toggle"
        />
        <label for="cosmos_memory_setting_changes_enabled" class="cosmos-entity-title">
          <i class="fa-solid fa-scroll"></i>
          {{ t`设定变更` }}
        </label>
      </div>

      <div class="cosmos-memory-hint">
        {{
          t`开启后会在总结时自动识别角色成长造成的长期设定变化，也可手动修正；生成时会提醒 AI 优先采用新设定，避免退回旧状态。`
        }}
      </div>

      <div class="cosmos-entity-actions">
        <button class="menu_button" type="button" @click="handle_show_setting_changes">
          {{ t`管理设定变更` }}
        </button>
      </div>
    </div>

    <!-- 3. 人物信息卡片 -->
    <div class="cosmos-section-card cosmos-entity-card">
      <div class="cosmos-entity-title-row">
        <input id="cosmos_memory_characters_enabled" v-model="settings.characters.enabled" type="checkbox" />
        <label for="cosmos_memory_characters_enabled" class="cosmos-entity-title">
          <i class="fa-solid fa-user-group"></i>
          {{ t`人物` }}
        </label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后会在总结时提取主要角色和会重复出现的次要角色，并注入到后续提示词中。` }}
      </div>

      <div class="cosmos-entity-actions">
        <button class="menu_button" type="button" @click="handle_show_characters">
          {{ t`查看人物信息` }}
        </button>
        <button
          class="menu_button"
          type="button"
          :disabled="is_regenerate_characters_disabled"
          @click="handle_regenerate_characters"
        >
          {{ is_regenerating_characters ? t`重新生成中...` : t`重新生成` }}
        </button>
      </div>
    </div>

    <!-- 4. 地点信息卡片 -->
    <div class="cosmos-section-card cosmos-entity-card">
      <div class="cosmos-entity-title-row">
        <input id="cosmos_memory_locations_enabled" v-model="settings.locations.enabled" type="checkbox" />
        <label for="cosmos_memory_locations_enabled" class="cosmos-entity-title">
          <i class="fa-solid fa-map-location-dot"></i>
          {{ t`地点` }}
        </label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后会在总结时记录有重复使用价值的地点，并按世界/大陆、国家、城市、场景、房间层级注入。` }}
      </div>

      <div class="cosmos-entity-actions">
        <button class="menu_button" type="button" @click="handle_show_locations">
          {{ t`查看地点信息` }}
        </button>
      </div>
    </div>

    <!-- 5. 物品信息卡片 -->
    <div class="cosmos-section-card cosmos-entity-card">
      <div class="cosmos-entity-title-row">
        <input id="cosmos_memory_items_enabled" v-model="settings.items.enabled" type="checkbox" />
        <label for="cosmos_memory_items_enabled" class="cosmos-entity-title">
          <i class="fa-solid fa-box-open"></i>
          {{ t`物品` }}
        </label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后会在总结时记录影响剧情的重要道具，并注入到人物信息上方。` }}
      </div>

      <div class="cosmos-entity-actions">
        <button class="menu_button" type="button" @click="handle_show_items">
          {{ t`查看物品信息` }}
        </button>
      </div>
    </div>

    <!-- 对话框挂载 -->
    <CurrentInfoDialog ref="current_info_dialog" />
    <SettingChangeDialog ref="setting_change_dialog" />
    <CharacterDialog ref="character_dialog" />
    <LocationDialog ref="location_dialog" />
    <ItemDialog ref="item_dialog" />
  </div>
</template>

<script setup lang="ts">
import { regenerateCharactersFromChat } from '@/core/character-regeneration';
import { triggerUpdateStatusBar } from '@/core/status-bar';
import CharacterDialog from '@/panel/CharacterDialog.vue';
import CurrentInfoDialog from '@/panel/CurrentInfoDialog.vue';
import ItemDialog from '@/panel/ItemDialog.vue';
import LocationDialog from '@/panel/LocationDialog.vue';
import SettingChangeDialog from '@/panel/SettingChangeDialog.vue';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());

const is_regenerating_characters = ref(false);

const current_info_dialog = ref<InstanceType<typeof CurrentInfoDialog> | null>(null);
const setting_change_dialog = ref<InstanceType<typeof SettingChangeDialog> | null>(null);
const character_dialog = ref<InstanceType<typeof CharacterDialog> | null>(null);
const item_dialog = ref<InstanceType<typeof ItemDialog> | null>(null);
const location_dialog = ref<InstanceType<typeof LocationDialog> | null>(null);

const is_ai_request_disabled = computed(() => {
  if (settings.value.ai.use_tavern_api) {
    return false;
  }

  return !settings.value.ai.custom_api_url.trim() || !settings.value.ai.selected_model.trim();
});

const is_regenerate_characters_disabled = computed(() => {
  return is_regenerating_characters.value || is_ai_request_disabled.value;
});

function handle_show_current_info() {
  current_info_dialog.value?.open();
}

function handle_show_setting_changes() {
  setting_change_dialog.value?.open();
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

function handle_setting_changes_toggle() {
  triggerUpdateStatusBar();
}
</script>
