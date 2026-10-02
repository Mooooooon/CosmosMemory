<template>
  <div class="cosmos-section-card cosmos-entity-card">
    <div class="cosmos-entity-title"><i class="fa-solid fa-wand-magic-sparkles"></i> {{ t`向模型提出修改要求` }}</div>
    <div class="cosmos-memory-hint">
      {{ t`使用基础设置中的模型修改当前聊天记忆。先预览再应用；时间格式、持续跟踪要求会作为后续总结规则保存。` }}
    </div>
    <label class="cosmos-memory-field">
      <span>{{ t`修改要求` }}</span>
      <textarea
        v-model="request"
        class="text_pole"
        rows="3"
        :disabled="is_editing_memory"
        :placeholder="t`例如：时间改为 YYYY-MM-DD HH:mm；持续记录林秋的修为变化；增加或删除某某地点。`"
      />
    </label>
    <div class="cosmos-entity-actions">
      <button class="menu_button" type="button" :disabled="is_disabled" @click="generate">
        {{ is_editing_memory ? t`正在生成修改...` : t`生成修改预览` }}
      </button>
      <button v-if="is_editing_memory" class="menu_button" type="button" @click="stopMemoryEdit">{{ t`停止` }}</button>
    </div>
    <div v-if="memory_edit_preview" class="cosmos-memory-edit-preview">
      <b>{{ t`修改预览` }}</b>
      <div class="cosmos-memory-hint">{{ t`绑定楼层` }} #{{ memory_edit_preview.binding.message_id }}</div>
      <p>{{ memory_edit_preview.result.explanation }}</p>
      <div v-for="group in preview_groups" :key="group.label">
        <b>{{ group.label }}</b>
        <pre>{{ group.content }}</pre>
      </div>
      <div class="cosmos-memory-hint">
        {{
          t`所有修改均绑定当前楼层及分支，回溯时一起撤销，切回原分支时恢复。对应剧情要素需启用才会用于后续总结和注入。`
        }}
      </div>
      <div class="cosmos-entity-actions">
        <button class="menu_button" type="button" :disabled="!has_changes" @click="apply">{{ t`应用修改` }}</button>
        <button class="menu_button" type="button" @click="memory_edit_preview = null">{{ t`放弃修改` }}</button>
      </div>
    </div>
    <details v-if="instructions.length" class="cosmos-memory-edit-preview">
      <summary>{{ t`当前聊天的记忆整理规则` }}</summary>
      <ul>
        <li v-for="instruction in instructions" :key="instruction.key">{{ instruction.content }}</li>
      </ul>
      <div class="cosmos-memory-hint">{{ t`可向模型提出“取消某条规则”或“清空记忆整理规则”。` }}</div>
    </details>
  </div>
</template>

<script setup lang="ts">
import {
  applyMemoryEditPreview,
  generateMemoryEdit,
  is_editing_memory,
  memory_edit_preview,
  memory_edit_revision,
  stopMemoryEdit,
} from '@/core/memory-edit';
import { getMemoryInstructions, type MemoryInstruction } from '@/core/memory-instructions';
import { floor_history_revision } from '@/core/floor-history';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());
const request = ref('');
const instructions = ref<MemoryInstruction[]>([]);
watch(memory_edit_revision, () => {
  request.value = '';
  refreshInstructions();
});
onMounted(refreshInstructions);
watch(floor_history_revision, refreshInstructions);

function refreshInstructions() {
  if (!window.TavernHelper) return;
  try {
    instructions.value = getMemoryInstructions();
  } catch {
    instructions.value = [];
    console.error('[CosmosMemory] 读取记忆整理规则失败');
    toastr.error(t`当前聊天的记忆整理规则格式异常。`);
  }
}

const is_disabled = computed(
  () =>
    is_editing_memory.value ||
    !request.value.trim() ||
    (!settings.value.ai.use_tavern_api &&
      (!settings.value.ai.custom_api_url.trim() || !settings.value.ai.selected_model.trim())),
);

const preview_groups = computed(() => {
  const result = memory_edit_preview.value?.result;
  if (!result) return [];
  const operation_labels = { add: t`增加`, set: t`更新`, delete: t`删除` };
  const fields: Record<string, string> = {
    background: t`背景介绍`,
    appearance: t`外貌描写`,
    personality: t`性格描写`,
    brief: t`简介`,
    world_brief: t`世界/大陆`,
    country_brief: t`国家/地区`,
    city_brief: t`城市/城镇`,
    scene_brief: t`场景/建筑`,
    room_brief: t`房间/具体地点`,
    content: t`内容`,
  };
  function formatOperation(operation: { type: 'add' | 'set' | 'delete' }, name: string): string {
    const descriptions = Object.entries(operation)
      .filter(([key, value]) => fields[key] && value)
      .map(([key, value]) => `  ${fields[key]}：${value}`);
    return [`${operation_labels[operation.type]}：${name}`, ...descriptions].join('\n');
  }
  const current_info = result.current_info;
  return [
    {
      label: t`人物`,
      content: result.character_operations.map(operation => formatOperation(operation, operation.name)).join('\n\n'),
    },
    {
      label: t`物品`,
      content: result.item_operations.map(operation => formatOperation(operation, operation.name)).join('\n\n'),
    },
    {
      label: t`地点`,
      content: result.location_operations
        .map(operation =>
          formatOperation(
            operation,
            [operation.world, operation.country, operation.city, operation.scene, operation.room]
              .filter(Boolean)
              .join(' / '),
          ),
        )
        .join('\n\n'),
    },
    {
      label: t`设定变更`,
      content: result.setting_change_operations
        .map(operation => formatOperation(operation, operation.key))
        .join('\n\n'),
    },
    {
      label: t`当前信息`,
      content:
        current_info === null
          ? ''
          : [
              `${t`当前时间`}：${current_info.current_time || t`尚未记录`}`,
              `${t`当前地点`}：${current_info.location || t`尚未记录`}`,
              `${t`角色列表`}：`,
              ...Object.entries(current_info.characters).map(
                ([name, info]) => `${name}\n  ${t`角色服装`}：${info.clothing}\n  ${t`角色状态`}：${info.status}`,
              ),
            ].join('\n'),
    },
    {
      label: t`当前聊天的记忆整理规则`,
      content:
        result.instructions === null
          ? ''
          : result.instructions.map(instruction => instruction.content).join('\n') || t`清空记忆整理规则`,
    },
  ].filter(group => group.content);
});
const has_changes = computed(() => preview_groups.value.length > 0);

async function generate() {
  if (is_disabled.value) return;
  try {
    if (await generateMemoryEdit(request.value, settings.value)) toastr.success(t`修改预览已生成，请检查后应用。`);
    else toastr.info(t`记忆修改已取消。`);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Cosmos Memory');
  }
}

function apply() {
  try {
    applyMemoryEditPreview();
    toastr.success(t`记忆修改已应用。`);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), 'Cosmos Memory');
  }
}
</script>

<style scoped>
.cosmos-memory-edit-preview {
  margin-top: 12px;
}
.cosmos-memory-edit-preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow-y: auto;
  font-size: 0.85em;
}
textarea {
  width: 100%;
  resize: vertical;
}
</style>
