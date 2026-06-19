import { summarizeReceivedMessage } from '@/core/summary';
import { event_types, eventSource } from '@sillytavern/script';

const SUMMARIZABLE_MESSAGE_TYPES = new Set([
  'normal',
  'regenerate',
  'swipe',
  'append',
  'appendFinal',
  'continue',
  'first_message',
]);

const summarizing_message_ids = new Set<number>();

let is_summary_listener_registered = false;

function handleMessageReceived(message_id: number, type: string) {
  console.info('[CosmosMemory] 收到 MESSAGE_RECEIVED 事件', { message_id, type });

  if (!SUMMARIZABLE_MESSAGE_TYPES.has(type)) {
    console.info('[CosmosMemory] 跳过不可总结的消息类型', { message_id, type });
    return;
  }

  if (summarizing_message_ids.has(message_id)) {
    console.info('[CosmosMemory] 跳过正在总结中的楼层', { message_id });
    return;
  }

  summarizing_message_ids.add(message_id);
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
      });
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CosmosMemory] 剧情总结失败', error);
      toastr.error(message, 'Cosmos Memory 剧情总结失败');
    })
    .finally(() => {
      summarizing_message_ids.delete(message_id);
    });
}

export function registerSummaryEvents() {
  if (is_summary_listener_registered) {
    console.info('[CosmosMemory] 剧情总结监听已注册，跳过重复注册');
    return;
  }

  console.info('[CosmosMemory] 注册 MESSAGE_RECEIVED 剧情总结监听');
  eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  is_summary_listener_registered = true;
}
