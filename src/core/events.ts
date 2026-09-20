import { applySummaryCompressionForNextGeneration } from '@/core/compression';
import {
  cancelSummarizationForChatChange,
  getAssistantMessage,
  getRegexedAiContent,
  getStoredMessageSummaries,
  invalidateAndResummarizeMessage,
  OPENING_MESSAGE_ID,
  resummarizeMessageForActiveSwipe,
  rollbackSummariesFromMessage,
  runMemoryBacktrackCheck,
  summarizeReceivedMessage,
  wasSummarizeTaskCancelled,
} from '@/core/summary';
import { useSettingsStore } from '@/store/settings';
import { stopSummaryRollupTask, triggerSummaryRollupIfNeeded } from '@/core/summary-rollup';
import { event_types, eventSource } from '@sillytavern/script';
import { initStatusBar, triggerUpdateStatusBar } from '@/core/status-bar';
import { applyRuntimeMemoryPromptInjection } from '@/core/runtime-memory';
import { migrateStoredLocationsIfNeeded } from '@/core/locations';
import { isCosmosMemoryMessage } from '@/core/message-flags';
import {
  cancelPendingAutoRetry,
  evaluateMessageFilter,
  isGenerationActive,
  markGenerationStoppedByUser,
  resetFilterRetryCount,
  setGenerationActive,
  setupGlobalErrorInterceptors,
  triggerFilterAutoRetry,
} from '@/core/filter';
import {
  applyVectorRecallForNextGeneration,
  cancelVectorSyncForChatChange,
  triggerVectorSyncDebounced,
} from '@/core/vector-recall';

const SUMMARIZABLE_MESSAGE_TYPES = new Set(['normal', 'regenerate', 'swipe', 'append', 'appendFinal', 'continue']);

const SKIPPED_COMPRESSION_GENERATION_TYPES = new Set(['quiet']);

let is_summary_listener_registered = false;

async function handleMessageReceived(message_id: number, type: string) {
  console.info('[CosmosMemory] 收到 MESSAGE_RECEIVED 事件', { message_id, type });

  if (!SUMMARIZABLE_MESSAGE_TYPES.has(type)) {
    console.info('[CosmosMemory] 跳过不可总结的消息类型', { message_id, type });
    return;
  }

  if (!window.TavernHelper) {
    console.warn('[CosmosMemory] TavernHelper 尚未初始化，跳过本次楼层总结', { message_id, type });
    return;
  }

  // 向量同步与总结互不依赖，收到新回复后即触发防抖同步
  triggerVectorSyncDebounced();

  const message = getAssistantMessage(message_id);
  if (!message || isCosmosMemoryMessage(message) || message_id === OPENING_MESSAGE_ID) {
    return;
  }

  const source = getRegexedAiContent(message);
  const { settings } = useSettingsStore();
  const filter_result = await evaluateMessageFilter(source, settings.filter);

  if (filter_result.filtered) {
    console.info('[CosmosMemory] 楼层内容被过滤规则拦截，跳过AI总结等功能', {
      message_id,
      reason: filter_result.reason,
      count: filter_result.count,
      unit: filter_result.unit,
    });
    triggerFilterAutoRetry(message_id, filter_result.reason);
    return;
  }

  // 收到合格回复后，重置连续过滤重试计数并标记生成结束
  resetFilterRetryCount();
  setGenerationActive(false);

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
        setting_change_operation_count: summary.setting_change_operations?.length ?? 0,
        current_info_updated: Boolean(
          summary.current_info_update?.current_time ||
          summary.current_info_update?.location ||
          Object.keys(summary.current_info_update?.characters ?? {}).length > 0,
        ),
      });
      triggerUpdateStatusBar();
      // 新摘要落库后检查未合并数量，达到阈值则自动二次总结
      triggerSummaryRollupIfNeeded();
    })
    .catch(error => {
      if (wasSummarizeTaskCancelled(message_id)) {
        console.info('[CosmosMemory] 楼层总结任务已被取消，跳过失败提示', { message_id });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CosmosMemory] 剧情总结失败', error);
      toastr.error(message, t`Cosmos Memory 剧情总结失败`);
    });
}

function handleMessageEdited(message_id: number) {
  console.info('[CosmosMemory] 收到 MESSAGE_EDITED 事件', { message_id });

  if (!window.TavernHelper) {
    console.warn('[CosmosMemory] TavernHelper 尚未初始化，跳过本次编辑失效处理', { message_id });
    return;
  }

  // 编辑楼层后触发防抖同步：增量 diff 会自动删除旧文本向量并写入新文本向量
  triggerVectorSyncDebounced();

  const { settings } = useSettingsStore();
  if (!settings.summary.resummarize_on_edit) {
    console.info('[CosmosMemory] 编辑楼层后重新总结已关闭，跳过重新总结', { message_id });
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
      toastr.error(message, t`Cosmos Memory 剧情总结失败`);
    });
}

/** swipe 切换后重新总结的防抖时长：快速来回切换分支时只对最终停留的分支重新总结 */
const SWIPE_RESUMMARIZE_DEBOUNCE_MS = 500;
const swipe_resummarize_timers = new Map<number, ReturnType<typeof setTimeout>>();

function cancelPendingSwipeResummarize() {
  for (const timer of swipe_resummarize_timers.values()) {
    clearTimeout(timer);
  }
  swipe_resummarize_timers.clear();
}

function handleMessageSwiped(message_id: number) {
  console.info('[CosmosMemory] 收到 MESSAGE_SWIPED 事件', { message_id });

  if (!window.TavernHelper) {
    return;
  }

  // 生成新分支会先触发本事件（空白楼层）再走 MESSAGE_RECEIVED 路径，此处不重复处理；
  // 生成过程中的流式楼层同样跳过
  if (isGenerationActive() || message_id === OPENING_MESSAGE_ID) {
    return;
  }

  // 分支内容已变化，触发防抖向量同步
  triggerVectorSyncDebounced();

  const existing_timer = swipe_resummarize_timers.get(message_id);
  if (existing_timer) {
    clearTimeout(existing_timer);
  }

  const timer = setTimeout(() => {
    swipe_resummarize_timers.delete(message_id);
    // 防抖等待期间可能已开始生成新分支（重 roll），此时交由生成结束后的 MESSAGE_RECEIVED 路径处理
    if (isGenerationActive()) {
      return;
    }
    void resummarizeMessageForActiveSwipe(message_id)
      .then(summary => {
        if (!summary) {
          return;
        }
        // 多数情况为从缓存瞬时还原（不调 AI）；仅当前分支从未总结过时才会真正重新生成
        console.info('[CosmosMemory] 切换 swipe 分支后已将摘要收敛到当前分支', { message_id });
        triggerUpdateStatusBar();
        triggerSummaryRollupIfNeeded();
      })
      .catch(error => {
        if (wasSummarizeTaskCancelled(message_id)) {
          console.info('[CosmosMemory] 切换 swipe 分支后的重新总结已被取消', { message_id });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error('[CosmosMemory] 切换 swipe 分支后处理失败', error);
        toastr.error(message, t`Cosmos Memory 剧情总结失败`);
      });
  }, SWIPE_RESUMMARIZE_DEBOUNCE_MS);

  swipe_resummarize_timers.set(message_id, timer);
}

function handleMessageDeleted(new_chat_length: number) {
  console.info('[CosmosMemory] 收到 MESSAGE_DELETED 事件', { new_chat_length });

  if (!window.TavernHelper) {
    console.warn('[CosmosMemory] TavernHelper 尚未初始化，跳过本次删除回滚处理', { new_chat_length });
    return;
  }

  // 重新生成会先删除旧楼层、再于同楼层写入新内容（此时 MESSAGE_RECEIVED 的 type 为 normal）：
  // 提前回滚被删楼层的摘要，随后的 MESSAGE_RECEIVED 才不会被「已有总结」守卫跳过
  rollbackSummariesFromMessage(new_chat_length);

  // 删除楼层后触发防抖同步：增量 diff 会清理已不存在楼层的向量
  triggerVectorSyncDebounced();
}

async function handleMessageSent(message_id: number) {
  // 用户发送新消息，重置可能存在的过滤连续重试计数
  resetFilterRetryCount();

  // 发送前的回溯检查会按当前激活分支重建摘要，待执行的 swipe 重新总结已无必要，清理以免重复
  cancelPendingSwipeResummarize();

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

    // 补全或清理后未合并摘要数量可能已达阈值，检查是否需要自动二次总结
    triggerSummaryRollupIfNeeded();
  } catch (error) {
    // 回溯检查失败不应阻断用户的发送流程，仅提示并继续
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CosmosMemory] 发送前回溯检查失败', error);
    toastr.error(message, t`Cosmos Memory 发送前回溯检查失败`);
  }
}

const REGENERATION_GENERATION_TYPES = new Set(['regenerate', 'swipe']);

async function handleGenerationAfterCommands(
  type: string,
  option: {
    depth?: number;
    quiet_prompt?: string;
  },
  dry_run: boolean,
) {
  if (dry_run || SKIPPED_COMPRESSION_GENERATION_TYPES.has(type) || option?.quiet_prompt) {
    return;
  }

  let excluded_message_id: number | undefined;

  // 重 roll 或生成新 swipe 时，提前回滚被重新生成的楼层及之后的记忆与摘要，
  // 避免上一条被废弃回复的剧情事实和提取出来的状态污染本次生成的上下文
  if (REGENERATION_GENERATION_TYPES.has(type) && window.TavernHelper) {
    const last_message_id = window.TavernHelper.getLastMessageId();
    const target_message_id =
      typeof option?.depth === 'number' && option.depth > 0
        ? Math.max(0, last_message_id - option.depth)
        : last_message_id;

    if (target_message_id >= 0) {
      console.info('[CosmosMemory] 检测到重roll/重新生成分支，生成前提前回滚目标楼层记忆', {
        type,
        target_message_id,
        option_depth: option?.depth,
      });
      // 仅回滚 canonical，保留其它分支缓存：重 roll 出的新分支若之后切回旧分支，旧分支摘要仍可复用
      rollbackSummariesFromMessage(target_message_id, { purge_swipe_cache: false });
      triggerUpdateStatusBar();
      excluded_message_id = target_message_id;
    }
  }

  setGenerationActive(true, type);

  try {
    const { settings } = useSettingsStore();
    await applySummaryCompressionForNextGeneration(settings.compression.enabled);
    applyRuntimeMemoryPromptInjection(settings);
  } catch (error) {
    // 记忆注入是优化项，失败时不应中断本次生成，仅提示并继续
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CosmosMemory] 生成前应用记忆注入失败', error);
    toastr.error(message, t`Cosmos Memory 生成前记忆注入失败`);
  }

  try {
    // 必须在压缩流程之后执行：此时楼层 is_hidden 已是本次生成的最终状态，
    // 被压缩隐藏的楼层恰好可被召回原文，与摘要形成互补
    await applyVectorRecallForNextGeneration({ excluded_message_id });
  } catch (error) {
    // 向量召回同为优化项，失败仅记录日志，绝不阻断生成
    console.error('[CosmosMemory] 生成前向量召回失败', error);
  }
}

function handleGenerationStarted(type?: string) {
  setGenerationActive(true, type);
}

function handleGenerationEnded() {
  setGenerationActive(false);
}

function handleGenerationStopped() {
  markGenerationStoppedByUser();
}

export function registerSummaryEvents() {
  if (is_summary_listener_registered) {
    console.info('[CosmosMemory] 剧情总结监听已注册，跳过重复注册');
    return;
  }

  console.info(
    '[CosmosMemory] 注册 MESSAGE_RECEIVED / MESSAGE_EDITED / MESSAGE_DELETED / MESSAGE_SENT / GENERATION_AFTER_COMMANDS / CHAT_CHANGED 剧情总结监听',
  );
  eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  eventSource.on(event_types.MESSAGE_EDITED, handleMessageEdited);
  eventSource.on(event_types.MESSAGE_DELETED, handleMessageDeleted);
  eventSource.on(event_types.MESSAGE_SENT, handleMessageSent);
  if (event_types.MESSAGE_SWIPED) {
    eventSource.on(event_types.MESSAGE_SWIPED, handleMessageSwiped);
  }
  eventSource.on(event_types.GENERATION_AFTER_COMMANDS, handleGenerationAfterCommands);
  if (event_types.GENERATION_STARTED) {
    eventSource.on(event_types.GENERATION_STARTED, handleGenerationStarted);
  }
  if (event_types.GENERATION_ENDED) {
    eventSource.on(event_types.GENERATION_ENDED, handleGenerationEnded);
  }
  if (event_types.GENERATION_STOPPED) {
    eventSource.on(event_types.GENERATION_STOPPED, handleGenerationStopped);
  }
  eventSource.on(event_types.CHAT_CHANGED, cancelSummarizationForChatChange);
  eventSource.on(event_types.CHAT_CHANGED, stopSummaryRollupTask);
  eventSource.on(event_types.CHAT_CHANGED, handleChatChangedForVectorSync);
  eventSource.on(event_types.CHAT_CHANGED, migrateLocationStorageForCurrentChat);
  eventSource.on(event_types.CHAT_CHANGED, cancelPendingAutoRetry);
  eventSource.on(event_types.CHAT_CHANGED, resetFilterRetryCount);
  eventSource.on(event_types.CHAT_CHANGED, cancelPendingSwipeResummarize);
  initStatusBar();
  migrateLocationStorageForCurrentChat();
  setupGlobalErrorInterceptors();
  is_summary_listener_registered = true;
}

function handleChatChangedForVectorSync() {
  // 取消上一个聊天的待执行同步并重置告警标志，再为新聊天补一次索引
  cancelVectorSyncForChatChange();
  triggerVectorSyncDebounced();
}

function migrateLocationStorageForCurrentChat() {
  if (!window.TavernHelper) {
    return;
  }

  try {
    if (migrateStoredLocationsIfNeeded(getStoredMessageSummaries())) {
      console.info('[CosmosMemory] 地点存储已升级，已从摘要操作补回缺失的中间层地点');
      triggerUpdateStatusBar();
    }
  } catch (error) {
    console.warn('[CosmosMemory] 升级地点存储失败，将在下次进入聊天时重试', error);
  }
}
