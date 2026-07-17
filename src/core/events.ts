import { applySummaryCompressionForNextGeneration } from '@/core/compression';
import {
  cancelSummarizationForChatChange,
  getStoredMessageSummaries,
  invalidateAndResummarizeMessage,
  runMemoryBacktrackCheck,
  summarizeReceivedMessage,
  wasSummarizeTaskCancelled,
} from '@/core/summary';
import { useSettingsStore } from '@/store/settings';
import { event_types, eventSource } from '@sillytavern/script';
import { initStatusBar, triggerUpdateStatusBar } from '@/core/status-bar';
import { applyRuntimeMemoryPromptInjection } from '@/core/runtime-memory';

const SUMMARIZABLE_MESSAGE_TYPES = new Set(['normal', 'regenerate', 'swipe', 'append', 'appendFinal', 'continue']);

const SKIPPED_COMPRESSION_GENERATION_TYPES = new Set(['quiet']);

let is_summary_listener_registered = false;

function handleMessageReceived(message_id: number, type: string) {
  console.info('[CosmosMemory] 收到 MESSAGE_RECEIVED 事件', { message_id, type });

  if (!SUMMARIZABLE_MESSAGE_TYPES.has(type)) {
    console.info('[CosmosMemory] 跳过不可总结的消息类型', { message_id, type });
    return;
  }

  if (!window.TavernHelper) {
    console.warn('[CosmosMemory] TavernHelper 尚未初始化，跳过本次楼层总结', { message_id, type });
    return;
  }

  if (type === 'normal' && getStoredMessageSummaries().some(summary => summary.message_id === message_id)) {
    console.info('[CosmosMemory] 普通回复楼层已有总结，跳过重复请求', { message_id, type });
    return;
  }

  console.info('[CosmosMemory] 开始处理楼层总结', { message_id, type });
  void summarizeReceivedMessage(message_id)
    .then(summary => {
      if (!summary) {
        console.info('[CosmosMemory] 楼层没有生成总结，可能不是 assistant 消息或过滤后为空', { message_id });
        return;
      }

      console.info('[CosmosMemory] 楼层总结完成', {
        message_id: summary.message_id,
        summary_length: summary.summary.length,
        character_operation_count: summary.character_operations?.length ?? 0,
        item_operation_count: summary.item_operations?.length ?? 0,
        location_operation_count: summary.location_operations?.length ?? 0,
        current_info_updated: Boolean(
          summary.current_info_update?.current_time ||
          summary.current_info_update?.location ||
          Object.keys(summary.current_info_update?.characters ?? {}).length > 0,
        ),
      });
      triggerUpdateStatusBar();
    })
    .catch(error => {
      if (wasSummarizeTaskCancelled(message_id)) {
        console.info('[CosmosMemory] 楼层总结任务已被取消，跳过失败提示', { message_id });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CosmosMemory] 剧情总结失败', error);
      toastr.error(message, 'Cosmos Memory 剧情总结失败');
    });
}

function handleMessageEdited(message_id: number) {
  console.info('[CosmosMemory] 收到 MESSAGE_EDITED 事件', { message_id });

  if (!window.TavernHelper) {
    console.warn('[CosmosMemory] TavernHelper 尚未初始化，跳过本次编辑失效处理', { message_id });
    return;
  }

  void invalidateAndResummarizeMessage(message_id)
    .then(summary => {
      if (summary) {
        triggerUpdateStatusBar();
      }
    })
    .catch(error => {
      if (wasSummarizeTaskCancelled(message_id)) {
        console.info('[CosmosMemory] 编辑后的重新总结已被取消', { message_id });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CosmosMemory] 编辑楼层后重新总结失败', error);
      toastr.error(message, 'Cosmos Memory 剧情总结失败');
    });
}

async function handleMessageSent(message_id: number) {
  try {
    console.info('[CosmosMemory] 收到 MESSAGE_SENT 事件，发送前执行回溯检查', { message_id });
    const result = await runMemoryBacktrackCheck({ max_message_id: message_id });
    if (result.removed_summaries.length > 0) {
      console.info('[CosmosMemory] 发送前已清理悬空总结', {
        trigger_message_id: message_id,
        removed_message_ids: result.removed_summaries.map(summary => summary.message_id),
      });
    }

    if (result.summarized_summaries.length > 0) {
      console.info('[CosmosMemory] 发送前已补全缺失总结', {
        trigger_message_id: message_id,
        summarized_message_ids: result.summarized_summaries.map(summary => summary.message_id),
      });
    }
  } catch (error) {
    // 回溯检查失败不应阻断用户的发送流程，仅提示并继续
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CosmosMemory] 发送前回溯检查失败', error);
    toastr.error(message, 'Cosmos Memory 发送前回溯检查失败');
  }
}

async function handleGenerationAfterCommands(
  type: string,
  option: {
    quiet_prompt?: string;
  },
  dry_run: boolean,
) {
  if (dry_run || SKIPPED_COMPRESSION_GENERATION_TYPES.has(type) || option.quiet_prompt) {
    return;
  }

  try {
    const { settings } = useSettingsStore();
    await applySummaryCompressionForNextGeneration(settings.compression.enabled);
    applyRuntimeMemoryPromptInjection(settings);
  } catch (error) {
    // 记忆注入是优化项，失败时不应中断本次生成，仅提示并继续
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CosmosMemory] 生成前应用记忆注入失败', error);
    toastr.error(message, 'Cosmos Memory 生成前记忆注入失败');
  }
}

export function registerSummaryEvents() {
  if (is_summary_listener_registered) {
    console.info('[CosmosMemory] 剧情总结监听已注册，跳过重复注册');
    return;
  }

  console.info(
    '[CosmosMemory] 注册 MESSAGE_RECEIVED / MESSAGE_EDITED / MESSAGE_SENT / GENERATION_AFTER_COMMANDS / CHAT_CHANGED 剧情总结监听',
  );
  eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  eventSource.on(event_types.MESSAGE_EDITED, handleMessageEdited);
  eventSource.on(event_types.MESSAGE_SENT, handleMessageSent);
  eventSource.on(event_types.GENERATION_AFTER_COMMANDS, handleGenerationAfterCommands);
  eventSource.on(event_types.CHAT_CHANGED, cancelSummarizationForChatChange);
  initStatusBar();
  is_summary_listener_registered = true;
}
