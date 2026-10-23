<template>
  <div>
    <div class="cosmos-memory-hint">
      {{ t`自定义源使用 OpenAI 兼容接口。以下配置支持 YAML / JSON，仅影响本插件的生成请求。` }}
    </div>

    <label class="cosmos-memory-field">
      <span>{{ t`追加请求体` }}</span>
      <textarea
        v-model="settings.ai.custom_include_body"
        class="text_pole"
        rows="5"
        spellcheck="false"
        :placeholder="t`例如：enable_thinking: false（仅适用于支持该参数的接口）`"
      ></textarea>
    </label>
    <div class="cosmos-memory-hint">
      {{ t`填写对象，按根字段覆盖默认请求参数；嵌套对象整体替换。关闭思考的参数请以服务商文档为准。` }}
    </div>

    <label class="cosmos-memory-field">
      <span>{{ t`排除请求体字段` }}</span>
      <textarea
        v-model="settings.ai.custom_exclude_body"
        class="text_pole"
        rows="3"
        spellcheck="false"
        :placeholder="'- frequency_penalty\n- presence_penalty'"
      ></textarea>
    </label>
    <div class="cosmos-memory-hint">
      {{ t`填写字符串数组，在追加参数后删除指定根字段；留空表示不排除。` }}
    </div>

    <details>
      <summary>{{ t`追加请求头（展开编辑）` }}</summary>
      <label class="cosmos-memory-field">
        <span>{{ t`追加请求头` }}</span>
        <textarea
          v-model="settings.ai.custom_include_headers"
          class="text_pole"
          rows="3"
          spellcheck="false"
          autocomplete="off"
          placeholder="X-Custom-Header: custom-value"
        ></textarea>
      </label>
      <div class="cosmos-memory-hint">
        {{ t`填写字符串值对象；同名请求头会被覆盖。敏感值将随插件设置保存，请勿分享。` }}
      </div>
    </details>

    <div v-if="validation_error" class="cosmos-memory-test-result cosmos-memory-test-result--error" role="alert">
      {{ validation_error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseCustomApiParameters } from '@/api/custom-parameters';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());
const validation_error = computed(() => {
  try {
    parseCustomApiParameters(settings.value.ai);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});
</script>
