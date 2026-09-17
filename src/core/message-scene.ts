import { getStoredCurrentScene } from '@/core/current-scene';
import { getStoredMessageSummaries } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';

export const MESSAGE_SCENE_CLASS = 'cosmos-memory-message-scene';

/**
 * 更新楼层的“当前画面”显示，排版在本楼总结与当前信息（状态栏）之间。
 * 返回 false 时等待楼层 DOM 渲染后重试。
 */
export function updateMessageScene(message_id: number | null): boolean {
  if (!window.TavernHelper) {
    return false;
  }

  const $existing = $(`#chat .${MESSAGE_SCENE_CLASS}`, window.parent.document);
  const { settings } = useSettingsStore();

  if (!settings.current_scene.enabled || message_id === null) {
    $existing.remove();
    return true;
  }

  try {
    const summary = getStoredMessageSummaries().find(s => s.message_id === message_id);
    const scene_text = (summary?.current_scene || getStoredCurrentScene() || '').trim();
    if (!scene_text) {
      $existing.remove();
      return true;
    }

    const $message = window.TavernHelper.retrieveDisplayedMessage(message_id);
    if ($message.length === 0) {
      $existing.remove();
      return false;
    }

    let $details = $message.children<HTMLDetailsElement>(`.${MESSAGE_SCENE_CLASS}`).first();
    $existing.not($details).remove();
    if ($details.length === 0) {
      $details = $<HTMLDetailsElement>(`<details class="${MESSAGE_SCENE_CLASS}">`)
        .append($('<summary>').text(t`当前画面`))
        .append($('<div class="cosmos-memory-message-scene-content">'));

      if (settings.current_scene.default_expanded) {
        $details.prop('open', true);
      }
    }

    const $content = $details.children('.cosmos-memory-message-scene-content');
    if ($content.text() !== scene_text) {
      // 画面描述来自 AI，作为纯文本展示，避免执行其中的 HTML。
      $content.text(scene_text);
    }

    // 严格控制插入位置：排在本楼总结之后、状态栏之前
    const $summary = $message.children('.cosmos-memory-message-summary').first();
    const $status_bar = $message.children('.cosmos-memory-status-bar').first();

    if ($summary.length > 0) {
      $summary.after($details);
    } else if ($status_bar.length > 0) {
      $details.insertBefore($status_bar);
    } else {
      $message.append($details);
    }

    return true;
  } catch (error) {
    $existing.remove();
    console.error('[CosmosMemory] 显示楼层当前画面失败', error);
    toastr.error(t`无法显示当前画面，请在“剧情要素”中查看。`, 'Cosmos Memory');
    return true;
  }
}
