import {
  getMessageSummaryStatus,
  getStoredMessageSummaries,
  OPENING_MESSAGE_ID,
  summarizeReceivedMessage,
} from '@/core/summary';
import { isCosmosMemoryMessage } from '@/core/message-flags';
import { triggerSummaryRollupIfNeeded } from '@/core/summary-rollup';
import { useSettingsStore } from '@/store/settings';
import { isOpeningMessageCompressionEnabled } from '@/type/settings';

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
    const status = getMessageSummaryStatus(message_id);
    const missing_summary = !summary?.summary.trim();
    if (!status && missing_summary) {
      const message = window.TavernHelper.getChatMessages(message_id, { include_swipes: false })[0];
      if (
        !message ||
        message.role !== 'assistant' ||
        !message.message.trim() ||
        isCosmosMemoryMessage(message) ||
        (message_id === OPENING_MESSAGE_ID && !isOpeningMessageCompressionEnabled(settings))
      ) {
        $existing.remove();
        return true;
      }
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

    const state = status?.state ?? (missing_summary ? 'missing' : 'complete');
    const state_changed = $details.attr('data-state') !== state;
    $details.attr('data-state', state);
    $details
      .children('summary')
      .text(
        status?.state === 'summarizing'
          ? t`正在总结…`
          : status?.state === 'failed'
            ? t`总结失败`
            : missing_summary
              ? t`尚未生成本楼总结`
              : t`本楼总结`,
      );
    const $content = $details.children('.cosmos-memory-message-summary-content');
    $content.empty();
    if (status?.state === 'summarizing') {
      $content.append($('<div role="status">').text(t`正在总结…`));
    } else if (status?.state === 'failed' || missing_summary) {
      if (state_changed) $details.prop('open', true);
      if (status?.state === 'failed' && status.error.trim()) {
        $content.append($('<div role="alert">').text(status.error));
      }
      const $retry = $('<button type="button" class="menu_button cosmos-memory-summary-retry">').text(t`重试总结`);
      $retry.on('click', () => {
        if ($retry.prop('disabled') || getMessageSummaryStatus(message_id) !== status) return;
        $retry.prop('disabled', true);
        void summarizeReceivedMessage(message_id)
          .then(result => {
            if (result) triggerSummaryRollupIfNeeded();
          })
          .catch(error => {
            if (getMessageSummaryStatus(message_id)?.state !== 'failed') return;
            console.error('[CosmosMemory] 重试楼层总结失败', error);
            toastr.error(error instanceof Error ? error.message : String(error), t`Cosmos Memory 剧情总结失败`);
          });
        updateMessageSummary(message_id);
      });
      $content.append($retry);
    } else {
      // 摘要来自 AI，作为纯文本展示，避免执行其中的 HTML。
      $content.text(summary?.summary ?? '');
    }

    const $scene = $message.children('.cosmos-memory-message-scene').first();
    const $status_bar = $message.children('.cosmos-memory-status-bar').first();
    if ($scene.length > 0) {
      $details.insertBefore($scene);
    } else if ($status_bar.length > 0) {
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
