import { CHARACTER_PROMPT_DEPTH, CHARACTER_PROMPT_ID, formatCharactersForPrompt } from '@/core/characters';
import { CURRENT_INFO_PROMPT_DEPTH, CURRENT_INFO_PROMPT_ID, formatCurrentInfoForPrompt } from '@/core/current-info';
import { formatItemsForPrompt, ITEM_PROMPT_DEPTH, ITEM_PROMPT_ID } from '@/core/items';
import { formatLocationsForPrompt, LOCATION_PROMPT_DEPTH, LOCATION_PROMPT_ID } from '@/core/locations';
import {
  formatSettingChangesForPrompt,
  SETTING_CHANGE_PROMPT_DEPTH,
  SETTING_CHANGE_PROMPT_ID,
} from '@/core/setting-changes';
import type { Settings } from '@/type/settings';

let uninject_runtime_memory: (() => void) | undefined;

type RuntimeMemoryPromptInfo = {
  id: string;
  enabled: boolean;
  depth: number;
  content: string;
};

function buildRuntimeMemoryPromptInfos(settings: Settings): RuntimeMemoryPromptInfo[] {
  return [
    {
      id: SETTING_CHANGE_PROMPT_ID,
      enabled: settings.setting_changes.enabled,
      depth: SETTING_CHANGE_PROMPT_DEPTH,
      content: settings.setting_changes.enabled ? formatSettingChangesForPrompt() : '',
    },
    {
      id: CURRENT_INFO_PROMPT_ID,
      enabled: settings.current_info.enabled,
      depth: CURRENT_INFO_PROMPT_DEPTH,
      content: settings.current_info.enabled ? formatCurrentInfoForPrompt() : '',
    },
    {
      id: LOCATION_PROMPT_ID,
      enabled: settings.locations.enabled,
      depth: LOCATION_PROMPT_DEPTH,
      content: settings.locations.enabled ? formatLocationsForPrompt() : '',
    },
    {
      id: ITEM_PROMPT_ID,
      enabled: settings.items.enabled,
      depth: ITEM_PROMPT_DEPTH,
      content: settings.items.enabled ? formatItemsForPrompt() : '',
    },
    {
      id: CHARACTER_PROMPT_ID,
      enabled: settings.characters.enabled,
      depth: CHARACTER_PROMPT_DEPTH,
      content: settings.characters.enabled ? formatCharactersForPrompt() : '',
    },
  ];
}

export function clearRuntimeMemoryPrompts() {
  uninject_runtime_memory?.();
  uninject_runtime_memory = undefined;
}

export function applyRuntimeMemoryPromptInjection(settings: Settings, signal: AbortSignal): string[] {
  if (signal.aborted) return [];
  clearRuntimeMemoryPrompts();

  const prompt_infos = buildRuntimeMemoryPromptInfos(settings);
  const prompts = prompt_infos
    .filter(info => info.enabled && info.content)
    .map(info => ({
      id: info.id,
      position: 'in_chat' as const,
      depth: info.depth,
      role: 'system' as const,
      content: info.content,
      filter: () => !signal.aborted,
    }));

  if (prompts.length === 0) {
    console.info('[CosmosMemory] 生成前没有可注入的运行时记忆', {
      runtime_memory: prompt_infos.map(info => ({
        id: info.id,
        enabled: info.enabled,
        has_content: Boolean(info.content),
      })),
    });
    return [];
  }

  uninject_runtime_memory = window.TavernHelper.injectPrompts(prompts, { once: true }).uninject;
  console.info('[CosmosMemory] 生成前已注入运行时记忆', {
    injected_prompt_ids: prompts.map(prompt => prompt.id),
    skipped_prompt_ids: prompt_infos.filter(info => !info.enabled || !info.content).map(info => info.id),
  });
  return prompts.map(prompt => prompt.id);
}
