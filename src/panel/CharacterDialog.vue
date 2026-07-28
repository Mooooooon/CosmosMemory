<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前聊天人物信息` }}</b>
      <div class="cosmos-memory-dialog-actions">
        <button class="menu_button" type="button" @click="handle_create">{{ t`新增人物` }}</button>
        <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
      </div>
    </div>

    <div v-if="editing" class="cosmos-memory-edit-form">
      <label class="cosmos-memory-field">
        <span>{{ t`姓名` }}</span>
        <input v-model.trim="editing.name" class="text_pole" type="text" />
      </label>

      <label class="cosmos-memory-field">
        <span>{{ t`角色类型` }}</span>
        <select v-model="editing.type" class="text_pole">
          <option value="primary">{{ t`主要角色` }}</option>
          <option value="secondary">{{ t`次要角色` }}</option>
        </select>
      </label>

      <template v-if="editing.type === 'primary'">
        <label class="cosmos-memory-field">
          <span>{{ t`背景介绍` }}</span>
          <textarea v-model.trim="editing.background" class="text_pole"></textarea>
        </label>
        <label class="cosmos-memory-field">
          <span>{{ t`外貌描写` }}</span>
          <textarea v-model.trim="editing.appearance" class="text_pole"></textarea>
        </label>
        <label class="cosmos-memory-field">
          <span>{{ t`性格描写` }}</span>
          <textarea v-model.trim="editing.personality" class="text_pole"></textarea>
        </label>
      </template>

      <label v-else class="cosmos-memory-field">
        <span>{{ t`简介` }}</span>
        <textarea v-model.trim="editing.brief" class="text_pole"></textarea>
      </label>

      <div class="cosmos-memory-entity-actions">
        <button class="menu_button" type="button" :disabled="!editing.name" @click="handle_save">
          {{ t`保存` }}
        </button>
        <button class="menu_button" type="button" @click="editing = null">{{ t`取消` }}</button>
      </div>
    </div>

    <div v-if="characters.length === 0 && !editing" class="cosmos-memory-empty">
      {{ t`当前聊天记录还没有人物信息。` }}
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <section v-if="primary_characters.length > 0">
        <h4>{{ t`主要角色` }}</h4>
        <article v-for="character in primary_characters" :key="character.name" class="cosmos-memory-summary-item">
          <div class="cosmos-memory-summary-meta">
            <b>{{ character.name }}</b>
            <div class="cosmos-memory-inline-actions">
              <button class="menu_button" type="button" @click="handle_edit(character)">{{ t`编辑` }}</button>
              <button class="menu_button" type="button" @click="handle_delete(character)">{{ t`删除` }}</button>
            </div>
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
            <div class="cosmos-memory-inline-actions">
              <button class="menu_button" type="button" @click="handle_edit(character)">{{ t`编辑` }}</button>
              <button class="menu_button" type="button" @click="handle_delete(character)">{{ t`删除` }}</button>
            </div>
          </div>
          <p>{{ character.brief }}</p>
        </article>
      </section>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import {
  getStoredCharacters,
  manualDeleteCharacter,
  manualSaveCharacter,
  type PrimaryCharacter,
  type SecondaryCharacter,
  type StoredCharacter,
} from '@/core/characters';
import { triggerUpdateStatusBar } from '@/core/status-bar';

/** 编辑表单的扁平结构：主/次要字段并存，保存时按 type 取用 */
type EditingCharacter = {
  /** 编辑前的原名；新建时为空，用于改名场景删除旧记录 */
  original_name: string;
  type: 'primary' | 'secondary';
  name: string;
  background: string;
  appearance: string;
  personality: string;
  brief: string;
};

const dialog_element = ref<HTMLDialogElement | null>(null);
const characters = ref<StoredCharacter[]>([]);
const editing = ref<EditingCharacter | null>(null);

const primary_characters = computed(() =>
  characters.value.filter((character): character is PrimaryCharacter => character.type === 'primary'),
);

const secondary_characters = computed(() =>
  characters.value.filter((character): character is SecondaryCharacter => character.type === 'secondary'),
);

function open() {
  characters.value = getStoredCharacters();
  editing.value = null;
  dialog_element.value?.showModal();
}

function close() {
  dialog_element.value?.close();
}

defineExpose({ open });

function handle_create() {
  editing.value = {
    original_name: '',
    type: 'secondary',
    name: '',
    background: '',
    appearance: '',
    personality: '',
    brief: '',
  };
}

function handle_edit(character: StoredCharacter) {
  editing.value = {
    original_name: character.name,
    type: character.type,
    name: character.name,
    background: character.type === 'primary' ? character.background : '',
    appearance: character.type === 'primary' ? character.appearance : '',
    personality: character.type === 'primary' ? character.personality : '',
    brief: character.type === 'secondary' ? character.brief : '',
  };
}

function handle_save() {
  const form = editing.value;
  if (!form || !form.name) {
    return;
  }

  try {
    const character: StoredCharacter =
      form.type === 'primary'
        ? {
            type: 'primary',
            name: form.name,
            background: form.background,
            appearance: form.appearance,
            personality: form.personality,
          }
        : { type: 'secondary', name: form.name, brief: form.brief };
    characters.value = manualSaveCharacter(character, form.original_name || undefined);
    editing.value = null;
    triggerUpdateStatusBar();
    toastr.success(t`人物信息已保存。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 保存人物失败`);
  }
}

function handle_delete(character: StoredCharacter) {
  if (!confirm(t`确定要删除人物「{name}」吗？`.replace('{name}', character.name))) {
    return;
  }

  try {
    characters.value = manualDeleteCharacter(character.name, character.type);
    triggerUpdateStatusBar();
    toastr.success(t`人物已删除。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 删除人物失败`);
  }
}
</script>
