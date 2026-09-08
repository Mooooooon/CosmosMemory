import { getStoredMessageSummaries } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';

const MESSAGE_SUMMARY_CLASS = 'cosmos-memory-message-summary';

/** 只更新楼层的显示，不把摘要写入聊天正文。返回 false 时等待楼层 DOM 渲染后重试。 */
export function updateMessageSummary(message_id: number | null): boolean {
  const $existing = $(`#chat .${MESSAGE_SUMMARY_CLASS}`, window.parent.document);
  const { settings } = useSettingsStore();
  if (!settings.summary.show_in_message || message_id === null) {
    $existing.remove();
    return true;
  }

  try {
    const summary = getStoredMessageSummaries().find(summary => summary.message_id === message_id);
    if (!summary?.summary.trim()) {
      $existing.remove();
      return true;
    }

    const $message = window.TavernHelper.retrieveDisplayedMessage(message_id);
    if ($message.length === 0) {
      $existing.remove();
      return false;
    }

    // 同一楼层刷新时复用 details，保留用户手动展开的状态；其他楼层不残留总结栏。
    let $details = $message.children<HTMLDetailsElement>(`.${MESSAGE_SUMMARY_CLASS}`).first();
    $existing.not($details).remove();
    if ($details.length === 0) {
      $details = $<HTMLDetailsElement>(`<details class="${MESSAGE_SUMMARY_CLASS}">`)
        .append($('<summary>').text(t`本楼总结`))
        .append($('<div class="cosmos-memory-message-summary-content">'));
    }

    const $content = $details.children('.cosmos-memory-message-summary-content');
    if ($content.text() !== summary.summary) {
      // 摘要来自 AI，作为纯文本展示，避免执行其中的 HTML。
      $content.text(summary.summary);
    }

    const $status_bar = $message.children('.cosmos-memory-status-bar').first();
    if ($status_bar.length > 0) {
      $details.insertBefore($status_bar);
    } else {
      $message.append($details);
    }
    return true;
  } catch (error) {
    $existing.remove();
    console.error('[CosmosMemory] 显示楼层总结失败', error);
    toastr.error(t`无法显示本楼总结，请在“当前聊天总结”中查看。`, 'Cosmos Memory');
    return true;
  }
}
