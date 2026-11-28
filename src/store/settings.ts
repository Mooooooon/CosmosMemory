import { setting_field, Settings } from '@/type/settings';
import { validateInplace } from '@/util/zod';
import { saveSettingsDebounced } from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';

<<<<<<< HEAD
function loadSettings(): Settings {
  try {
    return validateInplace(Settings, _.get(extension_settings, setting_field));
  } catch (error) {
    // 设置数据损坏或来自不兼容的旧版本时，回退为默认设置，避免整个插件初始化失败
    console.error('[CosmosMemory] 插件设置校验失败，已回退为默认设置', error);
    toastr.warning(t`Cosmos Memory 设置数据异常，已重置为默认设置。`);
    const defaults = Settings.parse({});
    _.set(extension_settings, setting_field, klona(defaults));
    saveSettingsDebounced();
    return defaults;
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref(loadSettings());
  let run_controller = new AbortController();
  let memory_generation_controller = new AbortController();

  watch(
    () => settings.value.enabled,
    enabled => {
      if (enabled) {
        run_controller = new AbortController();
      } else {
        run_controller.abort();
      }
    },
    { immediate: true, flush: 'sync' },
  );

  watch(
    () => settings.value.enabled && !settings.value.summary_paused,
    can_generate => {
      if (can_generate) {
        memory_generation_controller = new AbortController();
      } else {
        memory_generation_controller.abort();
      }
    },
    { immediate: true, flush: 'sync' },
  );
=======
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref(validateInplace(Settings, _.get(extension_settings, setting_field)));
>>>>>>> db6542a4a9b520a2709f92e2f339bf1134a9efc2

  watch(
    settings,
    new_settings => {
      _.set(extension_settings, setting_field, klona(new_settings)); // 用 klona 克隆对象从而去除 proxy 层
      saveSettingsDebounced();
    },
    { deep: true },
  );
  return {
    settings,
<<<<<<< HEAD
    getRunSignal: () => run_controller.signal,
    getMemoryGenerationSignal: () => memory_generation_controller.signal,
=======
>>>>>>> db6542a4a9b520a2709f92e2f339bf1134a9efc2
  };
});
