import { normalizeText, STORAGE_ROOT } from '@/core/entity-store';
import { defineFloorHistory, replayFloorTimeline } from '@/core/floor-history';

const CURRENT_SCENE_STORAGE_PATH = `${STORAGE_ROOT}.current_scene`;
const history = defineFloorHistory(`${CURRENT_SCENE_STORAGE_PATH}_manual_ops`, z.string());

type SummaryWithCurrentScene = {
  message_id?: number;
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

export function rebuildStoredCurrentSceneFromSummaries(summaries: SummaryWithCurrentScene[], max_message_id?: number) {
  let scene = '';
  replayFloorTimeline(
    summaries,
    history.active(max_message_id),
    summary => summary.message_id ?? -1,
    summary => {
      scene = normalizeText(summary.current_scene) || scene;
    },
    edit => {
      scene = edit.value;
    },
    max_message_id,
  );
  saveStoredCurrentScene(scene);
}

export function manualSaveCurrentScene(scene: string) {
  history.append(normalizeText(scene));
  saveStoredCurrentScene(scene);
}
