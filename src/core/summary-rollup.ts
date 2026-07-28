/**
 * 摘要二次压缩（前情文章）：
 * - 当未合并的旧摘要累计到设定条数时，把它们（连同已有前情文章）二次总结成一篇连贯文章；
 * - 逐楼摘要仍原样保留（实体重放与回滚依赖它们），前情文章只是提示词注入层的合并表示；
 * - 文章记录覆盖楼层及其来源摘要的 updated_at，读取时校验：任一来源摘要被编辑、
 *   删除或回滚后校验失败，文章自动作废，下次触发时基于现存摘要重新生成。
 */
import { rollupSummariesToArticle } from '@/api/ai';
import { STORAGE_ROOT } from '@/core/entity-store';
import { getStoredMessageSummaries, type MessageSummary } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';
import { getCurrentChatId } from '@sillytavern/script';

const ROLLUP_STORAGE_PATH = `${STORAGE_ROOT}.summary_rollup`;

export type SummaryRollupSource = {
  message_id: number;
  /** 来源摘要生成时间；与现存摘要不一致说明摘要已被覆盖，文章作废 */
  updated_at: string;
};

export type SummaryRollup = {
  article: string;
  sources: SummaryRollupSource[];
  updated_at: string;
};

type RollupTask = {
  promise: Promise<SummaryRollup | null>;
  generation_id: string;
};

let running_task: RollupTask | null = null;
let is_task_cancelled = false;

function readStoredRollup(): SummaryRollup | null {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const rollup = _.get(variables, ROLLUP_STORAGE_PATH) as SummaryRollup | undefined;
  if (
    typeof rollup !== 'object' ||
    rollup === null ||
    typeof rollup.article !== 'string' ||
    !rollup.article.trim() ||
    !Array.isArray(rollup.sources)
  ) {
    return null;
  }

  const sources = rollup.sources.filter(
    (source): source is SummaryRollupSource =>
      typeof source === 'object' &&
      source !== null &&
      typeof source.message_id === 'number' &&
      typeof source.updated_at === 'string',
  );
  if (sources.length === 0) {
    return null;
  }

  return { ...rollup, sources };
}

function saveRollup(rollup: SummaryRollup | null) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      if (rollup) {
        _.set(variables, ROLLUP_STORAGE_PATH, rollup);
      } else {
        _.unset(variables, ROLLUP_STORAGE_PATH);
      }
      return variables;
    },
    { type: 'chat' },
  );
}

/**
 * 读取当前有效的前情文章：校验每条来源摘要仍然存在且未被覆盖（updated_at 一致）。
 * 校验失败说明部分剧情已被删楼/编辑/回滚改写，文章内容不再可信，立即作废。
 */
export function getValidSummaryRollup(): SummaryRollup | null {
  const rollup = readStoredRollup();
  if (!rollup) {
    return null;
  }

  const summaries_by_id = new Map(getStoredMessageSummaries().map(summary => [summary.message_id, summary]));
  const is_valid = rollup.sources.every(source => {
    const summary = summaries_by_id.get(source.message_id);
    return summary !== undefined && summary.updated_at === source.updated_at;
  });

  if (!is_valid) {
    console.info('[CosmosMemory] 前情文章的来源摘要已变更，作废旧文章', {
      source_message_ids: rollup.sources.map(source => source.message_id),
    });
    saveRollup(null);
    return null;
  }

  return rollup;
}

function safeGetCurrentChatId(): string | null {
  try {
    return getCurrentChatId() || null;
  } catch (error) {
    console.warn('[CosmosMemory] 获取当前聊天 ID 失败', error);
    return null;
  }
}

/**
 * 计算本次合并的输入：已有文章之外、且不在保留窗口内的摘要。
 * 摘要按楼层升序排列，保留窗口取最近 retained 条。
 */
function getPendingRollupSummaries(retained_recent_summary_count: number): {
  rollup: SummaryRollup | null;
  pending: MessageSummary[];
} {
  const rollup = getValidSummaryRollup();
  const covered_ids = new Set(rollup?.sources.map(source => source.message_id) ?? []);
  const summaries = getStoredMessageSummaries();
  const mergeable = retained_recent_summary_count > 0 ? summaries.slice(0, -retained_recent_summary_count) : summaries;
  return {
    rollup,
    pending: mergeable.filter(summary => !covered_ids.has(summary.message_id)),
  };
}

async function rollupCore(generation_id: string): Promise<SummaryRollup | null> {
  const chat_id = safeGetCurrentChatId();
  const { settings } = useSettingsStore();
  const { rollup, pending } = getPendingRollupSummaries(settings.summary_rollup.retained_recent_summary_count);

  if (pending.length === 0) {
    console.info('[CosmosMemory] 没有待合并的摘要，跳过二次总结');
    return rollup;
  }

  console.info('[CosmosMemory] 开始二次总结', {
    pending_message_ids: pending.map(summary => summary.message_id),
    has_previous_article: rollup !== null,
  });

  const article = await rollupSummariesToArticle(
    settings.ai,
    pending.map(summary => ({ message_id: summary.message_id, summary: summary.summary })),
    {
      previous_article: rollup?.article,
      generation_id,
      should_cancel: () => is_task_cancelled,
    },
  );

  if (is_task_cancelled) {
    console.info('[CosmosMemory] 二次总结任务已被取消，丢弃结果');
    return null;
  }

  // 异步请求期间用户可能切换了聊天：写入会污染新聊天的变量，直接丢弃结果
  if (safeGetCurrentChatId() !== chat_id) {
    console.warn('[CosmosMemory] 二次总结完成时聊天已切换，丢弃结果', { chat_id });
    return null;
  }

  // 请求期间摘要可能又发生了变化（删楼/编辑/新增）：以完成时刻的现存摘要重新校验来源，
  // 已失效的来源不写入，避免文章覆盖标记与实际摘要脱节
  const summaries_by_id = new Map(getStoredMessageSummaries().map(summary => [summary.message_id, summary]));
  const sources = [
    ...(rollup?.sources ?? []),
    ...pending.map(summary => ({ message_id: summary.message_id, updated_at: summary.updated_at })),
  ]
    .filter(source => summaries_by_id.get(source.message_id)?.updated_at === source.updated_at)
    .sort((left, right) => left.message_id - right.message_id);
  if (sources.length === 0) {
    console.warn('[CosmosMemory] 二次总结完成时来源摘要已全部失效，丢弃结果');
    return null;
  }

  const new_rollup: SummaryRollup = {
    article,
    sources,
    updated_at: new Date().toISOString(),
  };
  saveRollup(new_rollup);
  console.info('[CosmosMemory] 二次总结完成', {
    article_length: article.length,
    covered_message_ids: sources.map(source => source.message_id),
  });
  return new_rollup;
}

/** 执行一次二次总结（手动触发按钮使用；无待合并摘要时返回现有文章） */
export function runSummaryRollup(): Promise<SummaryRollup | null> {
  if (running_task) {
    console.info('[CosmosMemory] 复用正在进行的二次总结任务');
    return running_task.promise;
  }

  is_task_cancelled = false;
  const generation_id = `cosmos-memory-summary-rollup-${Date.now()}`;
  const promise = rollupCore(generation_id).finally(() => {
    running_task = null;
  });
  running_task = { promise, generation_id };
  return promise;
}

/** 达到触发条数时自动执行二次总结；失败仅告警，不打断主流程 */
export function triggerSummaryRollupIfNeeded() {
  const { settings } = useSettingsStore();
  if (!settings.summary_rollup.enabled || running_task) {
    return;
  }

  const { pending } = getPendingRollupSummaries(settings.summary_rollup.retained_recent_summary_count);
  if (pending.length < settings.summary_rollup.trigger_summary_count) {
    return;
  }

  console.info('[CosmosMemory] 未合并摘要达到阈值，自动触发二次总结', {
    pending_count: pending.length,
    trigger_summary_count: settings.summary_rollup.trigger_summary_count,
  });
  void runSummaryRollup().catch(error => {
    console.error('[CosmosMemory] 自动二次总结失败', error);
    const message = error instanceof Error ? error.message : String(error);
    toastr.warning(message, t`Cosmos Memory 二次总结失败`);
  });
}

/** 停止进行中的二次总结请求（聊天切换 / 手动停止时调用） */
export function stopSummaryRollupTask() {
  if (!running_task) {
    return;
  }

  is_task_cancelled = true;
  try {
    window.TavernHelper.stopGenerationById(running_task.generation_id);
  } catch (error) {
    console.warn('[CosmosMemory] 停止二次总结请求失败', error);
  }
  running_task = null;
}
