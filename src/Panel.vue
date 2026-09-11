<template>
  <div class="cosmos-memory-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ t`Cosmos Memory` }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <!-- 导航菜单栏 (Tabs Header) -->
        <div class="cosmos-settings-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="cosmos-settings-tab"
            :class="{ active: active_tab === tab.id }"
            @click="active_tab = tab.id"
          >
            <i :class="tab.icon"></i>
            <span>{{ tab.name }}</span>
          </button>
        </div>

        <!-- 1. 基础设置 (Settings Tab) -->
        <SettingsTab v-show="active_tab === 'settings'" />

        <!-- 2. 剧情总结 (Summary Tab) -->
        <SummaryTab v-show="active_tab === 'summary'" />

        <!-- 3. 记忆压缩 (Compression Tab) -->
        <CompressionTab v-show="active_tab === 'compression'" />

        <!-- 4. 剧情要素 (Entities Tab) -->
        <EntitiesTab v-show="active_tab === 'entities'" />

        <!-- 5. 向量召回 (Vector Recall Tab) -->
        <VectorRecallTab v-show="active_tab === 'vector_recall'" />

        <hr class="sysHR" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import CompressionTab from '@/panel/CompressionTab.vue';
import EntitiesTab from '@/panel/EntitiesTab.vue';
import SettingsTab from '@/panel/SettingsTab.vue';
import SummaryTab from '@/panel/SummaryTab.vue';
import VectorRecallTab from '@/panel/VectorRecallTab.vue';

const active_tab = ref('settings');

const tabs = computed(() => [
  { id: 'settings', name: t`基础设置`, icon: 'fa-solid fa-gear' },
  { id: 'summary', name: t`剧情总结`, icon: 'fa-solid fa-file-pen' },
  { id: 'compression', name: t`记忆压缩`, icon: 'fa-solid fa-file-zipper' },
  { id: 'entities', name: t`剧情要素`, icon: 'fa-solid fa-users-rectangle' },
  { id: 'vector_recall', name: t`向量召回`, icon: 'fa-solid fa-brain' },
]);
</script>

<style scoped>
/* 扩展设置面板 Tab 样式 */
.cosmos-settings-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  padding-bottom: 10px;
}

.cosmos-settings-tab {
  flex: 1 1 calc(20% - 6px);
  min-width: 68px;
  padding: 8px 6px;
  font-size: 0.88em;
  font-weight: 500;
  text-align: center;
  color: var(--SmartThemeBodyColor);
  background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  user-select: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
}

.cosmos-settings-tab:hover {
  background: color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);
  border-color: var(--SmartThemeQuoteColor);
  transform: translateY(-1px);
}

.cosmos-settings-tab:active {
  transform: translateY(0);
}

.cosmos-settings-tab.active {
  background: color-mix(in srgb, var(--SmartThemeBodyColor) 12%, var(--SmartThemeBlurTintColor));
  border-color: var(--SmartThemeQuoteColor);
  font-weight: 700;
  box-shadow:
    0 4px 10px var(--SmartThemeShadowColor),
    inset 0 1px 0 color-mix(in srgb, var(--SmartThemeBodyColor) 15%, transparent);
  text-shadow: 0 0 8px color-mix(in srgb, var(--SmartThemeQuoteColor) 30%, transparent);
}

:deep(.cosmos-settings-tab-panel) {
  animation: cosmos-panel-fade-in 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes cosmos-panel-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
