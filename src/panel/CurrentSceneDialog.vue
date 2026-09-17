<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前画面` }}</b>
      <div class="cosmos-memory-dialog-actions">
        <button v-if="editing_scene === null" class="menu_button" type="button" @click="handle_edit">
          {{ t`编辑` }}
        </button>
        <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
      </div>
    </div>

    <div v-if="editing_scene !== null" class="cosmos-memory-edit-form">
      <label class="cosmos-memory-field">
        <span>{{ t`画面描述` }}</span>
        <textarea
          v-model.trim="editing_scene"
          class="text_pole"
          rows="8"
          style="width: 100%; box-sizing: border-box; resize: vertical; line-height: 1.6"
        ></textarea>
      </label>

      <div class="cosmos-memory-entity-actions">
        <button class="menu_button" type="button" @click="handle_save">{{ t`保存` }}</button>
        <button class="menu_button" type="button" @click="editing_scene = null">{{ t`取消` }}</button>
      </div>
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <article v-if="scene" class="cosmos-memory-summary-item">
        <p style="white-space: pre-wrap; line-height: 1.6; font-style: italic; margin: 0">
          {{ scene }}
        </p>
      </article>
      <div v-else class="cosmos-memory-empty">
        {{ t`当前聊天记录还没有画面描述。` }}
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { getStoredCurrentScene, manualSaveCurrentScene } from '@/core/current-scene';
import { triggerUpdateStatusBar } from '@/core/status-bar';

const dialog_element = ref<HTMLDialogElement | null>(null);
const scene = ref('');
const editing_scene = ref<string | null>(null);

function open() {
  scene.value = getStoredCurrentScene();
  editing_scene.value = null;
  dialog_element.value?.showModal();
}

function show() {
  open();
}

function close() {
  editing_scene.value = null;
  dialog_element.value?.close();
}

function handle_edit() {
  editing_scene.value = scene.value;
}

function handle_save() {
  const next_scene = (editing_scene.value ?? '').trim();
  manualSaveCurrentScene(next_scene);
  scene.value = next_scene;
  editing_scene.value = null;
  triggerUpdateStatusBar();
  toastr.success(t`已更新当前画面`, 'Cosmos Memory');
}

defineExpose({ open, show, close });
</script>
