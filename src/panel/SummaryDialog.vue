<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前聊天总结 共{count}条`.replace('{count}', String(summaries.length)) }}</b>
      <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
    </div>

    <div v-if="summaries.length === 0 && rollups.length === 0" class="cosmos-memory-empty">
      {{ t`当前聊天记录还没有总结。` }}
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <article v-for="(rollup, index) in rollups" :key="rollup.updated_at" class="cosmos-memory-summary-item">
        <div class="cosmos-memory-summary-meta">
          <b>
            {{ t`前情分段` }} {{ index + 1 }} · {{ format_rollup_range(rollup) }}（{{
              t`已合并 {count} 条总结`.replace('{count}', String(rollup.sources.length))
            }}）
          </b>
          <span>{{ format_time(rollup.updated_at) }}</span>
        </div>
        <p>{{ rollup.article }}</p>
      </article>
      <article v-for="(summary, index) in summaries" :key="summary.message_id" class="cosmos-memory-summary-item">
        <div class="cosmos-memory-summary-meta">
          <b>
            {{ t`楼层` }} #{{ summary.message_id }} No.{{ index + 1 }}
            <template v-if="rollup_covered_ids.has(summary.message_id)">
              （{{ t`已由二次总结分段替代注入` }}）
            </template>
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
import { getValidSummaryRollups, type SummaryRollupSegment } from '@/core/summary-rollup';

const dialog_element = ref<HTMLDialogElement | null>(null);
const summaries = ref<MessageSummary[]>([]);
const rollups = ref<SummaryRollupSegment[]>([]);

const rollup_covered_ids = computed(() => {
  return new Set(rollups.value.flatMap(rollup => rollup.sources.map(source => source.message_id)));
});

function open() {
  summaries.value = getStoredMessageSummaries();
  try {
    rollups.value = getValidSummaryRollups();
  } catch (error) {
    console.warn('[CosmosMemory] 读取前情分段失败', error);
    rollups.value = [];
  }
  dialog_element.value?.showModal();
}

function close() {
  dialog_element.value?.close();
}

defineExpose({ open });

function format_rollup_range(rollup: SummaryRollupSegment): string {
  return `#${rollup.sources[0]!.message_id}–#${rollup.sources.at(-1)!.message_id}`;
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
</script>
