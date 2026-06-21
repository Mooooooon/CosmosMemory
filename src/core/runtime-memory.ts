import { CHARACTER_PROMPT_DEPTH, CHARACTER_PROMPT_ID, formatCharactersForPrompt } from '@/core/characters';
import { CURRENT_INFO_PROMPT_DEPTH, CURRENT_INFO_PROMPT_ID, formatCurrentInfoForPrompt } from '@/core/current-info';
import { formatItemsForPrompt, ITEM_PROMPT_DEPTH, ITEM_PROMPT_ID } from '@/core/items';
import { formatLocationsForPrompt, LOCATION_PROMPT_DEPTH, LOCATION_PROMPT_ID } from '@/core/locations';
import type { Settings } from '@/type/settings';

const RUNTIME_MEMORY_PROMPT_IDS = [CURRENT_INFO_PROMPT_ID, LOCATION_PROMPT_ID, ITEM_PROMPT_ID, CHARACTER_PROMPT_ID];

type RuntimeMemoryPromptInfo = {
  id: string;
  enabled: boolean;
  depth: number;
  content: string;
};

function buildRuntimeMemoryPromptInfos(settings: Settings): RuntimeMemoryPromptInfo[] {
  return [
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

export function applyRuntimeMemoryPromptInjection(settings: Settings): string[] {
  window.TavernHelper.uninjectPrompts(RUNTIME_MEMORY_PROMPT_IDS);

  const prompt_infos = buildRuntimeMemoryPromptInfos(settings);
  const prompts = prompt_infos
    .filter(info => info.enabled && info.content)
    .map(info => ({
      id: info.id,
      position: 'in_chat' as const,
      depth: info.depth,
      role: 'system' as const,
      content: info.content,
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

  window.TavernHelper.injectPrompts(prompts, { once: true });
  console.info('[CosmosMemory] 生成前已注入运行时记忆', {
    injected_prompt_ids: prompts.map(prompt => prompt.id),
    skipped_prompt_ids: prompt_infos.filter(info => !info.enabled || !info.content).map(info => info.id),
  });
  return prompts.map(prompt => prompt.id);
}
