<template>
  <div class="cosmos-settings-tab-panel">
    <!-- 一级压缩：历史楼层隐藏压缩 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-file-zipper"></i>
          {{ t`历史楼层压缩` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input
          id="cosmos_memory_compression_enabled"
          v-model="settings.compression.enabled"
          type="checkbox"
          @change="handle_compression_toggle"
        />
        <label for="cosmos_memory_compression_enabled">{{ t`启用压缩` }}</label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`当 AI 回复数量超过该值时，旧回复会被隐藏，并在生成时用已保存的摘要替代。` }}
      </div>

      <div v-if="settings.compression.enabled" class="cosmos-sub-card">
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
          {{ t`保留最近 N 条 AI 回复不隐藏，更早的历史楼层将被折叠并用逐楼总结注入。` }}
        </div>
      </div>
    </div>

    <!-- 二级压缩：二次总结分段 (Rollup) -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-layer-group"></i>
          {{ t`二次总结分段` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input id="cosmos_memory_summary_rollup_enabled" v-model="settings.summary_rollup.enabled" type="checkbox" />
        <label for="cosmos_memory_summary_rollup_enabled">{{ t`启用二次压缩` }}</label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后，每当未合并的旧总结达到一个完整分段时，会生成独立的前情分段；旧分段不会被后续二次总结反复改写。` }}
      </div>

      <div v-if="settings.summary_rollup.enabled" class="cosmos-sub-card">
        <label class="cosmos-memory-field">
          <span>{{ t`每段总结条数` }}</span>
          <input
            v-model.number="settings.summary_rollup.trigger_summary_count"
            class="text_pole"
            type="number"
            min="2"
            step="1"
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
            @change="normalize_rollup_retained_count"
          />
        </label>

        <div class="cosmos-memory-hint">
          {{ t`最近的总结不参与合并；更早的总结按设置条数依次分段，不足一个完整分段时继续保留逐楼摘要。` }}
        </div>
      </div>

      <div class="cosmos-memory-row flex-container cosmos-button-group">
        <input
          class="menu_button"
          type="button"
          :value="is_rolling_up ? t`二次总结中...` : t`立即二次总结`"
          :disabled="is_rollup_request_running || is_ai_request_disabled"
          @click="handle_run_rollup"
        />
        <input
          class="menu_button"
          type="button"
          :value="is_regenerating_rollups ? t`重新生成二次总结中...` : t`重新生成二次总结`"
          :disabled="is_rollup_request_running || is_ai_request_disabled"
          @click="handle_regenerate_rollups"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { applySummaryCompressionForNextGeneration } from '@/core/compression';
import { regenerateSummaryRollups, runSummaryRollup } from '@/core/summary-rollup';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());

const is_rolling_up = ref(false);
const is_regenerating_rollups = ref(false);

const is_rollup_request_running = computed(() => is_rolling_up.value || is_regenerating_rollups.value);

const is_ai_request_disabled = computed(() => {
  if (settings.value.ai.use_tavern_api) {
    return false;
  }

  return !settings.value.ai.custom_api_url.trim() || !settings.value.ai.selected_model.trim();
});

function handle_compression_toggle() {
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

async function handle_run_rollup() {
  is_rolling_up.value = true;

  try {
    const result = await runSummaryRollup();
    if (result.generated_segment_count > 0) {
      toastr.success(
        t`二次总结完成，新增 {segments} 个分段，合并 {count} 条总结。`
          .replace('{segments}', String(result.generated_segment_count))
          .replace('{count}', String(result.generated_source_count)),
        'Cosmos Memory',
      );
    } else {
      toastr.info(t`待合并总结还没有达到一个完整分段。`, 'Cosmos Memory');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 二次总结失败`);
  } finally {
    is_rolling_up.value = false;
  }
}

async function handle_regenerate_rollups() {
  is_regenerating_rollups.value = true;

  try {
    const result = await regenerateSummaryRollups();
    if (result.generated_segment_count > 0) {
      toastr.success(
        t`二次总结重新生成完成，共 {segments} 个分段，覆盖 {count} 条总结。`
          .replace('{segments}', String(result.generated_segment_count))
          .replace('{count}', String(result.generated_source_count)),
        'Cosmos Memory',
      );
    } else {
      toastr.info(t`当前总结数量还不能生成完整分段，已恢复为逐楼摘要。`, 'Cosmos Memory');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 重新生成二次总结失败`);
  } finally {
    is_regenerating_rollups.value = false;
  }
}
</script>
