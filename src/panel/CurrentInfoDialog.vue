<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前信息` }}</b>
      <div class="cosmos-memory-dialog-actions">
        <button v-if="!editing" class="menu_button" type="button" @click="handle_edit">{{ t`编辑` }}</button>
        <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
      </div>
    </div>

    <div v-if="editing" class="cosmos-memory-edit-form">
      <label class="cosmos-memory-field">
        <span>{{ t`当前时间` }}</span>
        <input v-model.trim="editing.current_time" class="text_pole" type="text" />
      </label>

      <label class="cosmos-memory-field">
        <span>{{ t`当前地点` }}</span>
        <input v-model.trim="editing.location" class="text_pole" type="text" />
      </label>

      <div v-for="(character, index) in editing.characters" :key="index" class="cosmos-memory-edit-form">
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
          <button class="menu_button" type="button" @click="editing.characters.splice(index, 1)">
            {{ t`移除该角色` }}
          </button>
        </div>
      </div>

      <div class="cosmos-memory-entity-actions">
        <button class="menu_button" type="button" @click="handle_add_character">{{ t`添加角色` }}</button>
        <button class="menu_button" type="button" @click="handle_save">{{ t`保存` }}</button>
        <button class="menu_button" type="button" @click="editing = null">{{ t`取消` }}</button>
      </div>
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <article class="cosmos-memory-summary-item">
        <p class="cosmos-memory-current-info-line">
          <b>{{ t`当前时间` }}</b>
          {{ current_info.current_time || t`尚未记录` }}
        </p>
        <p class="cosmos-memory-current-info-line">
          <b>{{ t`当前地点` }}</b>
          {{ current_info.location || t`尚未记录` }}
        </p>
      </article>

      <div v-if="character_entries.length === 0" class="cosmos-memory-empty">
        {{ t`当前聊天记录还没有角色状态。` }}
      </div>

      <article v-for="[name, character] in character_entries" :key="name" class="cosmos-memory-summary-item">
        <div class="cosmos-memory-summary-meta">
          <b>{{ name }}</b>
        </div>
        <dl class="cosmos-memory-character-fields">
          <template v-if="character.clothing">
            <dt>{{ t`角色服装` }}</dt>
            <dd>{{ character.clothing }}</dd>
          </template>
          <template v-if="character.status">
            <dt>{{ t`角色状态` }}</dt>
            <dd>{{ character.status }}</dd>
          </template>
        </dl>
      </article>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { getStoredCurrentInfo, manualSaveCurrentInfo, type CurrentInfo } from '@/core/current-info';
import { triggerUpdateStatusBar } from '@/core/status-bar';

/** 编辑表单：characters 由 Record 展平为数组便于 v-for 编辑 */
type EditingCurrentInfo = {
  current_time: string;
  location: string;
  characters: Array<{ name: string; clothing: string; status: string }>;
};

const dialog_element = ref<HTMLDialogElement | null>(null);
const current_info = ref<CurrentInfo>({ current_time: '', location: '', characters: {} });
const editing = ref<EditingCurrentInfo | null>(null);

const character_entries = computed(() => {
  return Object.entries(current_info.value.characters).sort(([left], [right]) => left.localeCompare(right));
});

function refresh() {
  try {
    current_info.value = getStoredCurrentInfo();
  } catch (error) {
    console.warn('[CosmosMemory] 读取当前信息失败', error);
    current_info.value = { current_time: '', location: '', characters: {} };
  }
}

function open() {
  refresh();
  editing.value = null;
  dialog_element.value?.showModal();
}

function close() {
  dialog_element.value?.close();
}

defineExpose({ open });

function handle_edit() {
  refresh();
  editing.value = {
    current_time: current_info.value.current_time,
    location: current_info.value.location,
    characters: Object.entries(current_info.value.characters).map(([name, character]) => ({
      name,
      clothing: character.clothing,
      status: character.status,
    })),
  };
}

function handle_add_character() {
  editing.value?.characters.push({ name: '', clothing: '', status: '' });
}

function handle_save() {
  const form = editing.value;
  if (!form) {
    return;
  }

  try {
    current_info.value = manualSaveCurrentInfo({
      current_time: form.current_time,
      location: form.location,
      characters: Object.fromEntries(
        form.characters
          .filter(character => character.name.trim())
          .map(character => [character.name.trim(), { clothing: character.clothing, status: character.status }]),
      ),
    });
    editing.value = null;
    triggerUpdateStatusBar();
    toastr.success(t`当前信息已保存。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 保存当前信息失败`);
  }
}
</script>
