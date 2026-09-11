<template>
  <div class="cosmos-settings-tab-panel">
    <!-- 总结提示词与上下文配置 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-file-lines"></i>
          {{ t`总结上下文` }}
        </span>
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
        {{
          t`开启后，总结请求会按顺序附带世界书（角色前）、玩家描述、角色描述、世界书（角色后）；世界书条目按待总结原消息使用酒馆规则激活。`
        }}
      </div>

      <div class="cosmos-memory-row flex-container">
        <input
          id="cosmos_memory_send_previous_message_original"
          v-model="settings.summary.send_previous_message_original"
          type="checkbox"
        />
        <label for="cosmos_memory_send_previous_message_original">{{ t`发送上一条 AI 原文` }}</label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后，总结请求会附带当前回复之前最近一条 AI 回复的原文；若与已有总结重合，则只发送原文。` }}
      </div>

      <div v-if="settings.summary.send_previous_message_original" class="cosmos-sub-card">
        <div class="cosmos-memory-row flex-container">
          <input
            id="cosmos_memory_include_opening_message_original"
            v-model="settings.summary.include_opening_message_original"
            type="checkbox"
          />
          <label for="cosmos_memory_include_opening_message_original">{{ t`包括开场白` }}</label>
        </div>
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

      <div v-if="settings.summary.send_summary_context" class="cosmos-sub-card">
        <label class="cosmos-memory-field">
          <span>{{ t`发送总结条数` }}</span>
          <input
            v-model.number="settings.summary.summary_context_count"
            class="text_pole"
            type="number"
            min="1"
            step="1"
            @change="normalize_summary_context_count"
          />
        </label>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input id="cosmos_memory_resummarize_on_edit" v-model="settings.summary.resummarize_on_edit" type="checkbox" />
        <label for="cosmos_memory_resummarize_on_edit">{{ t`编辑楼层后重新总结` }}</label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`开启后，当编辑已被总结的 AI 楼层时，会自动废除旧摘要并基于新内容重新请求总结。` }}
      </div>
    </div>

    <!-- 回复过滤设置 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-filter"></i>
          {{ t`回复过滤` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input id="cosmos_memory_filter_enabled" v-model="settings.filter.enabled" type="checkbox" />
        <label for="cosmos_memory_filter_enabled">{{ t`启用回复过滤` }}</label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`当 AI 回复为空、长度过短或包含报错拒答关键词时，不触发剧情总结等功能。` }}
      </div>

      <template v-if="settings.filter.enabled">
        <label class="cosmos-memory-field">
          <span>{{ t`长度统计单位` }}</span>
          <select v-model="settings.filter.length_unit" class="text_pole">
            <option value="token">{{ t`Token 数` }}</option>
            <option value="char">{{ t`字数 (字符数)` }}</option>
          </select>
        </label>

        <label class="cosmos-memory-field">
          <span>{{ settings.filter.length_unit === 'token' ? t`最小 Token 数` : t`最小字数` }}</span>
          <input
            v-model.number="settings.filter.min_length"
            class="text_pole"
            type="number"
            min="0"
            step="10"
            @change="normalize_filter_min_length"
          />
        </label>

        <div class="cosmos-memory-hint">
          {{ t`低于该数值的回复将跳过总结；设为 0 表示不限制最小长度。` }}
        </div>

        <label class="cosmos-memory-field">
          <span>{{ t`过滤关键词` }}</span>
          <textarea
            v-model="blocked_keywords_text"
            class="text_pole"
            rows="3"
            :placeholder="t`每行一个关键词，或以逗号分隔，如：I cannot`"
            @change="handle_blocked_keywords_change"
          ></textarea>
        </label>

        <div class="cosmos-memory-hint">
          {{ t`当 AI 回复包含以上任一关键词时（不区分大小写），将视为报错或拒答并跳过总结。支持换行或逗号分隔。` }}
        </div>
      </template>
    </div>

    <!-- 楼层展示设置 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-eye"></i>
          {{ t`楼层显示` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container">
        <input id="cosmos_memory_show_summary_in_message" v-model="settings.summary.show_in_message" type="checkbox" />
        <label for="cosmos_memory_show_summary_in_message">{{ t`显示楼层总结栏` }}</label>
      </div>

      <div class="cosmos-memory-hint">
        {{ t`最新 AI 回复生成总结后，在正文末尾、状态栏上方显示可展开的本楼总结。` }}
      </div>
    </div>

    <!-- 记忆维护与管理工具 -->
    <div class="cosmos-section-card">
      <div class="cosmos-section-header">
        <span class="cosmos-section-title">
          <i class="fa-solid fa-toolbox"></i>
          {{ t`记忆维护` }}
        </span>
      </div>

      <div class="cosmos-memory-row flex-container cosmos-button-group">
        <input class="menu_button" type="button" :value="t`查看已有总结`" @click="handle_show_summaries" />
        <input
          class="menu_button"
          type="button"
          :value="is_checking_memory ? t`停止检查` : t`手动检查记忆`"
          @click="handle_memory_check_button"
        />
      </div>

      <div class="cosmos-memory-hint">
        {{ t`手动检查会扫描当前聊天记录，清理悬空的旧总结，并为遗漏的 AI 楼层自动补全总结。` }}
      </div>
    </div>

    <SummaryDialog ref="summary_dialog" />
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_FILTER_MIN_LENGTH } from '@/type/settings';
import { runMemoryBacktrackCheck, stopSummarizeTasks, type MemoryBacktrackCheckResult } from '@/core/summary';
import { triggerUpdateStatusBar } from '@/core/status-bar';
import SummaryDialog from '@/panel/SummaryDialog.vue';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());

const is_checking_memory = ref(false);
const summary_dialog = ref<InstanceType<typeof SummaryDialog> | null>(null);

const blocked_keywords_text = computed({
  get() {
    return (settings.value.filter.blocked_keywords ?? []).join('\n');
  },
  set(val: string) {
    settings.value.filter.blocked_keywords = val
      .split(/[\n,，]+/)
      .map(k => k.trim())
      .filter(Boolean);
  },
});

function handle_blocked_keywords_change(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  blocked_keywords_text.value = target.value;
}

function normalize_filter_min_length() {
  const count = settings.value.filter.min_length;
  settings.value.filter.min_length = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : DEFAULT_FILTER_MIN_LENGTH;
}

function handle_show_summaries() {
  summary_dialog.value?.open();
}

function normalize_summary_context_count() {
  const count = settings.value.summary.summary_context_count;
  settings.value.summary.summary_context_count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 5;
}

function handle_memory_check_button() {
  if (is_checking_memory.value) {
    stopSummarizeTasks();
    return;
  }

  void handle_check_memory();
}

async function handle_check_memory() {
  is_checking_memory.value = true;

  try {
    const result = await runMemoryBacktrackCheck();
    if (result.removed_summaries.length > 0 || result.summarized_summaries.length > 0) {
      triggerUpdateStatusBar();
    }
    if (result.aborted) {
      toastr.warning(t`记忆检查已手动停止。`, 'Cosmos Memory');
    } else {
      toastr.success(format_memory_check_result(result), 'Cosmos Memory');
    }
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

  return t`记忆检查完成：已清理 {removed} 条悬空总结，补全 {summarized} 条缺失总结。`
    .replace('{removed}', String(removed_count))
    .replace('{summarized}', String(summarized_count));
}
</script>
