<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前聊天物品信息` }}</b>
      <div class="cosmos-memory-dialog-actions">
        <button class="menu_button" type="button" @click="handle_create">{{ t`新增物品` }}</button>
        <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
      </div>
    </div>

    <div v-if="editing" class="cosmos-memory-edit-form">
      <label class="cosmos-memory-field">
        <span>{{ t`物品名` }}</span>
        <input v-model.trim="editing.name" class="text_pole" type="text" />
      </label>

      <label class="cosmos-memory-field">
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

    <div v-if="items.length === 0 && !editing" class="cosmos-memory-empty">
      {{ t`当前聊天记录还没有物品信息。` }}
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <article v-for="item in items" :key="item.name" class="cosmos-memory-summary-item">
        <div class="cosmos-memory-summary-meta">
          <b>{{ item.name }}</b>
          <div class="cosmos-memory-inline-actions">
            <button class="menu_button" type="button" @click="handle_edit(item)">{{ t`编辑` }}</button>
            <button class="menu_button" type="button" @click="handle_delete(item)">{{ t`删除` }}</button>
          </div>
        </div>
        <p>{{ item.brief }}</p>
      </article>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { getStoredItems, manualDeleteItem, manualSaveItem, type StoredItem } from '@/core/items';
import { triggerUpdateStatusBar } from '@/core/status-bar';

type EditingItem = {
  /** 编辑前的原名；新建时为空，用于改名场景删除旧记录 */
  original_name: string;
  name: string;
  brief: string;
};

const dialog_element = ref<HTMLDialogElement | null>(null);
const items = ref<StoredItem[]>([]);
const editing = ref<EditingItem | null>(null);

function open() {
  items.value = getStoredItems();
  editing.value = null;
  dialog_element.value?.showModal();
}

function close() {
  dialog_element.value?.close();
}

defineExpose({ open });

function handle_create() {
  editing.value = { original_name: '', name: '', brief: '' };
}

function handle_edit(item: StoredItem) {
  editing.value = { original_name: item.name, name: item.name, brief: item.brief };
}

function handle_save() {
  const form = editing.value;
  if (!form || !form.name) {
    return;
  }

  try {
    items.value = manualSaveItem({ name: form.name, brief: form.brief }, form.original_name || undefined);
    editing.value = null;
    triggerUpdateStatusBar();
    toastr.success(t`物品信息已保存。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 保存物品失败`);
  }
}

function handle_delete(item: StoredItem) {
  if (!confirm(t`确定要删除物品「{name}」吗？`.replace('{name}', item.name))) {
    return;
  }

  try {
    items.value = manualDeleteItem(item.name);
    triggerUpdateStatusBar();
    toastr.success(t`物品已删除。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 删除物品失败`);
  }
}
</script>
