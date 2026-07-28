<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前聊天总结` }}</b>
      <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
    </div>

    <div v-if="summaries.length === 0 && !rollup" class="cosmos-memory-empty">
      {{ t`当前聊天记录还没有总结。` }}
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <article v-if="rollup" class="cosmos-memory-summary-item">
        <div class="cosmos-memory-summary-meta">
          <b> {{ t`前情文章` }}（{{ t`已合并 {count} 条总结`.replace('{count}', String(rollup.sources.length)) }}） </b>
          <span>{{ format_time(rollup.updated_at) }}</span>
        </div>
        <p>{{ rollup.article }}</p>
      </article>
      <article v-for="summary in summaries" :key="summary.message_id" class="cosmos-memory-summary-item">
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
</template>

<script setup lang="ts">
import { getStoredMessageSummaries, type MessageSummary } from '@/core/summary';
import { getValidSummaryRollup, type SummaryRollup } from '@/core/summary-rollup';

const dialog_element = ref<HTMLDialogElement | null>(null);
const summaries = ref<MessageSummary[]>([]);
const rollup = ref<SummaryRollup | null>(null);

const rollup_covered_ids = computed(() => {
  return new Set(rollup.value?.sources.map(source => source.message_id) ?? []);
});

function open() {
  summaries.value = getStoredMessageSummaries();
  try {
    rollup.value = getValidSummaryRollup();
  } catch (error) {
    console.warn('[CosmosMemory] 读取前情文章失败', error);
    rollup.value = null;
  }
  dialog_element.value?.showModal();
}

function close() {
  dialog_element.value?.close();
}

defineExpose({ open });

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
