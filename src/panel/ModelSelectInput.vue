<template>
  <div ref="container_ref" class="cosmos-combobox-container">
    <div class="cosmos-combobox-input-wrapper">
      <input
        ref="input_ref"
        :value="modelValue"
        class="text_pole cosmos-combobox-input"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        @focus="handle_focus"
        @input="handle_input"
        @keydown.esc="handle_esc"
      />
      <button
        type="button"
        class="cosmos-combobox-toggle"
        :disabled="disabled"
        tabindex="-1"
        :title="is_open ? t`收起列表` : t`展开列表`"
        @click.stop="toggle_dropdown"
      >
        <i class="fa-solid" :class="is_open ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
      </button>
    </div>

    <div v-if="is_open" class="cosmos-combobox-dropdown" @pointerdown.stop>
      <!-- 无任何候选模型 -->
      <div v-if="options.length === 0" class="cosmos-combobox-empty">
        {{ t`暂无模型列表，可先点击获取或直接手动输入` }}
      </div>

      <!-- 搜索有匹配与非匹配结果：匹配靠前显示，其他也正常显示 -->
      <template v-else-if="matched_options.matching.length > 0 && matched_options.others.length > 0">
        <div class="cosmos-combobox-group-title">{{ t`匹配模型` }} ({{ matched_options.matching.length }})</div>
        <div
          v-for="model in matched_options.matching"
          :key="model"
          class="cosmos-combobox-option"
          :class="{ 'is-selected': model === modelValue }"
          @click="select_option(model)"
        >
          <span class="cosmos-combobox-option-name">{{ model }}</span>
          <i v-if="model === modelValue" class="fa-solid fa-check cosmos-combobox-option-check"></i>
        </div>

        <div class="cosmos-combobox-divider"></div>

        <div class="cosmos-combobox-group-title">{{ t`其他模型` }} ({{ matched_options.others.length }})</div>
        <div
          v-for="model in matched_options.others"
          :key="model"
          class="cosmos-combobox-option"
          :class="{ 'is-selected': model === modelValue }"
          @click="select_option(model)"
        >
          <span class="cosmos-combobox-option-name">{{ model }}</span>
          <i v-if="model === modelValue" class="fa-solid fa-check cosmos-combobox-option-check"></i>
        </div>
      </template>

      <!-- 全量显示（全部匹配或无匹配内容时） -->
      <template v-else>
        <div class="cosmos-combobox-group-title">
          {{ matched_options.matching.length > 0 ? t`匹配模型` : t`全部模型` }} ({{ options.length }})
        </div>
        <div
          v-for="model in all_display_options"
          :key="model"
          class="cosmos-combobox-option"
          :class="{ 'is-selected': model === modelValue }"
          @click="select_option(model)"
        >
          <span class="cosmos-combobox-option-name">{{ model }}</span>
          <i v-if="model === modelValue" class="fa-solid fa-check cosmos-combobox-option-check"></i>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: string[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  {
    placeholder: '',
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
}>();

const is_open = ref(false);
const container_ref = ref<HTMLElement | null>(null);
const input_ref = ref<HTMLInputElement | null>(null);

const matched_options = computed(() => {
  const query = (props.modelValue ?? '').trim().toLowerCase();
  if (!query) {
    return {
      matching: [] as string[],
      others: props.options,
    };
  }

  const matching: string[] = [];
  const others: string[] = [];

  for (const opt of props.options) {
    if (opt.toLowerCase().includes(query)) {
      matching.push(opt);
    } else {
      others.push(opt);
    }
  }

  // 精准匹配与前缀匹配置顶
  matching.sort((a, b) => {
    const a_lower = a.toLowerCase();
    const b_lower = b.toLowerCase();
    const a_exact = a_lower === query;
    const b_exact = b_lower === query;
    if (a_exact && !b_exact) return -1;
    if (!a_exact && b_exact) return 1;

    const a_starts = a_lower.startsWith(query);
    const b_starts = b_lower.startsWith(query);
    if (a_starts && !b_starts) return -1;
    if (!a_starts && b_starts) return 1;

    return a.localeCompare(b);
  });

  return { matching, others };
});

const all_display_options = computed(() => {
  if (matched_options.value.matching.length > 0) {
    return matched_options.value.matching;
  }
  return props.options;
});

function handle_input(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  emit('update:modelValue', val);
  emit('change', val);
  is_open.value = true;
}

function handle_focus() {
  is_open.value = true;
}

function handle_esc() {
  is_open.value = false;
}

function toggle_dropdown() {
  if (props.disabled) return;
  is_open.value = !is_open.value;
  if (is_open.value) {
    input_ref.value?.focus();
  }
}

function select_option(model: string) {
  emit('update:modelValue', model);
  emit('change', model);
  is_open.value = false;
}

function handle_pointer_down_outside(event: PointerEvent) {
  if (!container_ref.value) return;
  if (!container_ref.value.contains(event.target as Node)) {
    is_open.value = false;
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handle_pointer_down_outside);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handle_pointer_down_outside);
});
</script>

<style scoped>
.cosmos-combobox-container {
  position: relative;
  width: 100%;
}

.cosmos-combobox-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.cosmos-combobox-input {
  width: 100%;
  padding-right: 32px !important;
  box-sizing: border-box;
}

.cosmos-combobox-toggle {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--SmartThemeBodyColor);
  opacity: 0.65;
  cursor: pointer;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85em;
  transition: opacity 0.2s ease;
}

.cosmos-combobox-toggle:hover:not(:disabled) {
  opacity: 1;
}

.cosmos-combobox-toggle:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.cosmos-combobox-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1050;
  background-color: rgba(26, 28, 35, 0.96);
  backdrop-filter: blur(16px);
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
}

.cosmos-combobox-group-title {
  padding: 6px 10px 4px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--SmartThemeBodyColor);
  opacity: 0.55;
  letter-spacing: 0.5px;
}

.cosmos-combobox-divider {
  height: 1px;
  background: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  margin: 4px 0;
}

.cosmos-combobox-option {
  padding: 7px 10px;
  font-size: 0.88em;
  color: var(--SmartThemeBodyColor);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  transition: background 0.15s ease;
  word-break: break-all;
}

.cosmos-combobox-option:hover {
  background: rgba(255, 255, 255, 0.12);
}

.cosmos-combobox-option.is-selected {
  background: rgba(255, 255, 255, 0.08);
  font-weight: 600;
}

.cosmos-combobox-option-name {
  flex: 1;
}

.cosmos-combobox-option-check {
  opacity: 0.85;
  font-size: 0.85em;
  flex-shrink: 0;
  color: var(--SmartThemeBodyColor);
}

.cosmos-combobox-empty {
  padding: 12px 10px;
  font-size: 0.85em;
  opacity: 0.6;
  text-align: center;
  font-style: italic;
}
</style>
