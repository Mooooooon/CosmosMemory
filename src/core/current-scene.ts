import { normalizeText, STORAGE_ROOT } from '@/core/entity-store';

const CURRENT_SCENE_STORAGE_PATH = `${STORAGE_ROOT}.current_scene`;

type SummaryWithCurrentScene = {
  current_scene?: string | null;
};

export function getStoredCurrentScene(): string {
  if (!window.TavernHelper) {
    return '';
  }
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  return normalizeText(_.get(variables, CURRENT_SCENE_STORAGE_PATH, ''));
}

export function saveStoredCurrentScene(scene: string) {
  if (!window.TavernHelper) {
    return;
  }
  window.TavernHelper.updateVariablesWith(
    variables => {
      const normalized = normalizeText(scene);
      if (normalized) {
        _.set(variables, CURRENT_SCENE_STORAGE_PATH, normalized);
      } else {
        _.unset(variables, CURRENT_SCENE_STORAGE_PATH);
      }
      return variables;
    },
    { type: 'chat' },
  );
}

export function rebuildStoredCurrentSceneFromSummaries(summaries: SummaryWithCurrentScene[]) {
  // 从后往前遍历，寻找最新的非空当前画面
  for (let i = summaries.length - 1; i >= 0; i--) {
    const scene = normalizeText(summaries[i]?.current_scene);
    if (scene) {
      saveStoredCurrentScene(scene);
      return;
    }
  }
  saveStoredCurrentScene('');
}

export function manualSaveCurrentScene(scene: string) {
  saveStoredCurrentScene(scene);
}
