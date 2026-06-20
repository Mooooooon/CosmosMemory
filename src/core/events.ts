import { applyCharacterPromptInjection } from '@/core/characters';
import { applySummaryCompressionForNextGeneration } from '@/core/compression';
import { applyItemPromptInjection } from '@/core/items';
import { applyLocationPromptInjection } from '@/core/locations';
import {
  pruneMessageSummariesAfterMessage,
  summarizeMissingAssistantMessages,
  summarizeReceivedMessage,
} from '@/core/summary';
import { applyCurrentInfoPromptInjection } from '@/core/current-info';
import { useSettingsStore } from '@/store/settings';
import { event_types, eventSource } from '@sillytavern/script';
import { initStatusBar, triggerUpdateStatusBar } from '@/core/status-bar';

const SUMMARIZABLE_MESSAGE_TYPES = new Set([
  'normal',
  'regenerate',
  'swipe',
  'append',
  'appendFinal',
  'continue',
  'first_message',
]);

const SKIPPED_COMPRESSION_GENERATION_TYPES = new Set(['quiet']);

let is_summary_listener_registered = false;

function handleMessageReceived(message_id: number, type: string) {
  console.info('[CosmosMemory] 收到 MESSAGE_RECEIVED 事件', { message_id, type });

  if (!SUMMARIZABLE_MESSAGE_TYPES.has(type)) {
    console.info('[CosmosMemory] 跳过不可总结的消息类型', { message_id, type });
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
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CosmosMemory] 剧情总结失败', error);
      toastr.error(message, 'Cosmos Memory 剧情总结失败');
    });
}

async function handleMessageSent(message_id: number) {
  try {
    console.info('[CosmosMemory] 收到 MESSAGE_SENT 事件，发送前清理悬空总结并检查缺失总结', { message_id });
    const removed_summaries = pruneMessageSummariesAfterMessage(message_id);
    if (removed_summaries.length > 0) {
      console.info('[CosmosMemory] 发送前已清理悬空总结', {
        trigger_message_id: message_id,
        removed_message_ids: removed_summaries.map(summary => summary.message_id),
      });
    }

    const summaries = await summarizeMissingAssistantMessages();
    if (summaries.length > 0) {
      console.info('[CosmosMemory] 发送前已补全缺失总结', {
        trigger_message_id: message_id,
        summarized_message_ids: summaries.map(summary => summary.message_id),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CosmosMemory] 发送前补全剧情总结失败', error);
    toastr.error(message, 'Cosmos Memory 发送前补全总结失败');
    throw error;
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
    await applySummaryCompressionForNextGeneration();
    applyCurrentInfoPromptInjection(settings.current_info.enabled);
    applyLocationPromptInjection(settings.locations.enabled);
    applyItemPromptInjection(settings.items.enabled);
    applyCharacterPromptInjection(settings.characters.enabled);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CosmosMemory] 生成前应用记忆注入失败', error);
    toastr.error(message, 'Cosmos Memory 生成前记忆注入失败');
    throw error;
  }
}

export function registerSummaryEvents() {
  if (is_summary_listener_registered) {
    console.info('[CosmosMemory] 剧情总结监听已注册，跳过重复注册');
    return;
  }

  console.info('[CosmosMemory] 注册 MESSAGE_RECEIVED / MESSAGE_SENT / GENERATION_AFTER_COMMANDS 剧情总结监听');
  eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  eventSource.on(event_types.MESSAGE_SENT, handleMessageSent);
  eventSource.on(event_types.GENERATION_AFTER_COMMANDS, handleGenerationAfterCommands);
  initStatusBar();
  is_summary_listener_registered = true;
}
