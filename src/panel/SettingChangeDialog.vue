<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前聊天设定变更` }}</b>
      <div class="cosmos-memory-dialog-actions">
        <button class="menu_button" type="button" @click="handle_create">{{ t`新增记录` }}</button>
        <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
      </div>
    </div>

    <div class="cosmos-memory-hint">
      {{ t`每条记录一个与原始人设不同的当前事实，例如“林秋已经升学到高中二年级”。` }}
    </div>

    <div v-if="editing" class="cosmos-memory-edit-form">
      <label class="cosmos-memory-field">
        <span>{{ t`变更内容` }}</span>
        <textarea
          v-model="editing.content"
          class="text_pole"
          :maxlength="SETTING_CHANGE_MAX_LENGTH"
          :placeholder="t`例如：林秋已经突破至筑基期。`"
        ></textarea>
      </label>
      <div class="cosmos-memory-text-count">{{ editing.content.length }} / {{ SETTING_CHANGE_MAX_LENGTH }}</div>

      <div class="cosmos-memory-entity-actions">
        <button class="menu_button" type="button" :disabled="!editing.content.trim()" @click="handle_save">
          {{ t`保存` }}
        </button>
        <button class="menu_button" type="button" @click="editing = null">{{ t`取消` }}</button>
      </div>
    </div>

    <div v-if="changes.length === 0 && !editing" class="cosmos-memory-empty">
      {{ t`当前聊天记录还没有设定变更。` }}
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <article v-for="change in changes" :key="change.id" class="cosmos-memory-summary-item">
        <div class="cosmos-memory-summary-meta">
          <p class="cosmos-memory-setting-change-content">{{ change.content }}</p>
          <div class="cosmos-memory-inline-actions">
            <button class="menu_button" type="button" @click="handle_edit(change)">{{ t`编辑` }}</button>
            <button class="menu_button" type="button" @click="handle_delete(change)">{{ t`删除` }}</button>
          </div>
        </div>
      </article>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import {
  addSettingChange,
  deleteSettingChange,
  getSettingChanges,
  SETTING_CHANGE_MAX_LENGTH,
  updateSettingChange,
  type SettingChange,
} from '@/core/setting-changes';
import { triggerUpdateStatusBar } from '@/core/status-bar';

type EditingSettingChange = {
  id: string | null;
  content: string;
};

const dialog_element = ref<HTMLDialogElement | null>(null);
const changes = ref<SettingChange[]>([]);
const editing = ref<EditingSettingChange | null>(null);

function open() {
  changes.value = getSettingChanges();
  editing.value = null;
  dialog_element.value?.showModal();
}

function close() {
  dialog_element.value?.close();
}

defineExpose({ open });

function handle_create() {
  editing.value = { id: null, content: '' };
}

function handle_edit(change: SettingChange) {
  editing.value = { id: change.id, content: change.content };
}

function handle_save() {
  const form = editing.value;
  const content = form?.content.trim() ?? '';
  if (!form || !content) {
    return;
  }

  try {
    changes.value = form.id ? updateSettingChange(form.id, content) : addSettingChange(content);
    editing.value = null;
    triggerUpdateStatusBar();
    toastr.success(t`设定变更已保存。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 保存设定变更失败`);
  }
}

function handle_delete(change: SettingChange) {
  if (!confirm(t`确定要删除这条设定变更吗？`)) {
    return;
  }

  try {
    changes.value = deleteSettingChange(change.id);
    triggerUpdateStatusBar();
    toastr.success(t`设定变更已删除。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 删除设定变更失败`);
  }
}
</script>
