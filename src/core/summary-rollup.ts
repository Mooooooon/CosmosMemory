/**
 * 摘要二次压缩（分段前情）：
 * - 每个分段只基于一批逐楼摘要生成，后续分段不会再次改写旧分段；
 * - 逐楼摘要始终原样保留，分段只负责在提示词注入时替代其覆盖的逐楼摘要；
 * - 每段记录来源摘要的 updated_at。来源被编辑、删除或回滚后，只作废受影响的分段；
 * - 自动任务只生成完整分段，不足一段的摘要继续以逐楼摘要形式注入。
 */
import { rollupSummariesToArticle } from '@/api/ai';
import { STORAGE_ROOT } from '@/core/entity-store';
import { getStoredMessageSummaries, type MessageSummary } from '@/core/summary';
import { useSettingsStore } from '@/store/settings';
import { getCurrentChatId } from '@sillytavern/script';

const ROLLUP_STORAGE_PATH = `${STORAGE_ROOT}.summary_rollup`;

export type SummaryRollupSource = {
  message_id: number;
  /** 来源摘要生成时间；与现存摘要不一致说明该分段已失效 */
  updated_at: string;
};

export type SummaryRollupSegment = {
  article: string;
  sources: SummaryRollupSource[];
  updated_at: string;
};

type StoredSummaryRollups = {
  segments: SummaryRollupSegment[];
  updated_at: string;
};

export type SummaryRollupRunResult = {
  segments: SummaryRollupSegment[];
  generated_segment_count: number;
  generated_source_count: number;
};

type RollupTask = {
  promise: Promise<SummaryRollupRunResult>;
  generation_id: string;
};

let running_task: RollupTask | null = null;
let is_task_cancelled = false;

function parseRollupSource(value: unknown): SummaryRollupSource | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as SummaryRollupSource).message_id !== 'number' ||
    typeof (value as SummaryRollupSource).updated_at !== 'string'
  ) {
    return null;
  }

  return value as SummaryRollupSource;
}

function parseRollupSegment(value: unknown): SummaryRollupSegment | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as SummaryRollupSegment).article !== 'string' ||
    !(value as SummaryRollupSegment).article.trim() ||
    !Array.isArray((value as SummaryRollupSegment).sources) ||
    typeof (value as SummaryRollupSegment).updated_at !== 'string'
  ) {
    return null;
  }

  const sources = (value as SummaryRollupSegment).sources
    .map(parseRollupSource)
    .filter((source): source is SummaryRollupSource => source !== null)
    .sort((left, right) => left.message_id - right.message_id);
  if (sources.length === 0) {
    return null;
  }

  return { ...(value as SummaryRollupSegment), sources };
}

function readStoredRollups(): SummaryRollupSegment[] {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const stored = _.get(variables, ROLLUP_STORAGE_PATH) as StoredSummaryRollups | undefined;
  if (typeof stored !== 'object' || stored === null || !Array.isArray(stored.segments)) {
    // 旧版单篇文章不再参与注入；逐楼摘要仍完整保留，可通过“重新生成二次总结”重建分段。
    return [];
  }

  return stored.segments
    .map(parseRollupSegment)
    .filter((segment): segment is SummaryRollupSegment => segment !== null)
    .sort((left, right) => left.sources[0]!.message_id - right.sources[0]!.message_id);
}

function saveRollups(segments: SummaryRollupSegment[]) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      if (segments.length > 0) {
        const stored: StoredSummaryRollups = {
          segments,
          updated_at: new Date().toISOString(),
        };
        _.set(variables, ROLLUP_STORAGE_PATH, stored);
      } else {
        _.unset(variables, ROLLUP_STORAGE_PATH);
      }
      return variables;
    },
    { type: 'chat' },
  );
}

/**
 * 读取当前有效的全部前情分段。单个分段来源失效时只移除该段，其他分段继续使用。
 */
export function getValidSummaryRollups(): SummaryRollupSegment[] {
  const segments = readStoredRollups();
  if (segments.length === 0) {
    return [];
  }

  const { settings } = useSettingsStore();
  const canonical_batches = getCanonicalBatches(
    settings.summary_rollup.retained_recent_summary_count,
    settings.summary_rollup.trigger_summary_count,
  );
  const valid_segments = segments.filter(segment =>
    canonical_batches.some(batch => doesSegmentMatchBatch(segment, batch)),
  );

  if (valid_segments.length !== segments.length) {
    const valid_segment_set = new Set(valid_segments);
    console.info('[CosmosMemory] 部分前情分段的来源摘要已变更，作废受影响分段', {
      invalid_source_message_ids: segments
        .filter(segment => !valid_segment_set.has(segment))
        .flatMap(segment => segment.sources.map(source => source.message_id)),
    });
    saveRollups(valid_segments);
  }

  return valid_segments;
}

function safeGetCurrentChatId(): string | null {
  try {
    return getCurrentChatId() || null;
  } catch (error) {
    console.warn('[CosmosMemory] 获取当前聊天 ID 失败', error);
    return null;
  }
}

function getMergeableSummaries(retained_recent_summary_count: number): MessageSummary[] {
  const summaries = getStoredMessageSummaries();
  return retained_recent_summary_count > 0 ? summaries.slice(0, -retained_recent_summary_count) : summaries;
}

function splitIntoCompleteSegments(summaries: MessageSummary[], segment_size: number): MessageSummary[][] {
  const complete_count = Math.floor(summaries.length / segment_size) * segment_size;
  const batches: MessageSummary[][] = [];
  for (let index = 0; index < complete_count; index += segment_size) {
    batches.push(summaries.slice(index, index + segment_size));
  }
  return batches;
}

function getCanonicalBatches(retained_recent_summary_count: number, segment_size: number): MessageSummary[][] {
  return splitIntoCompleteSegments(getMergeableSummaries(retained_recent_summary_count), segment_size);
}

function doesSegmentMatchBatch(segment: SummaryRollupSegment, batch: MessageSummary[]): boolean {
  return (
    segment.sources.length === batch.length &&
    segment.sources.every(
      (source, index) =>
        source.message_id === batch[index]!.message_id && source.updated_at === batch[index]!.updated_at,
    )
  );
}

function getPendingRollupBatches(
  retained_recent_summary_count: number,
  segment_size: number,
): {
  segments: SummaryRollupSegment[];
  batches: MessageSummary[][];
} {
  const segments = getValidSummaryRollups();
  const canonical_batches = getCanonicalBatches(retained_recent_summary_count, segment_size);
  return {
    segments,
    batches: canonical_batches.filter(batch => !segments.some(segment => doesSegmentMatchBatch(segment, batch))),
  };
}

function wasTaskCancelled(generation_id: string): boolean {
  return is_task_cancelled || running_task?.generation_id !== generation_id;
}

function assertTaskCanSave(chat_id: string | null, batch: MessageSummary[], generation_id: string) {
  if (wasTaskCancelled(generation_id)) {
    throw new Error(t`二次总结任务已取消。`);
  }
  if (safeGetCurrentChatId() !== chat_id) {
    throw new Error(t`二次总结完成时聊天已切换，结果未保存。`);
  }

  const summaries_by_id = new Map(getStoredMessageSummaries().map(summary => [summary.message_id, summary]));
  const has_changed_source = batch.some(
    summary => summaries_by_id.get(summary.message_id)?.updated_at !== summary.updated_at,
  );
  if (has_changed_source) {
    throw new Error(t`二次总结期间来源摘要发生变化，结果未保存，请重试。`);
  }
}

async function generateSegment(
  batch: MessageSummary[],
  generation_id: string,
  chat_id: string | null,
): Promise<SummaryRollupSegment> {
  console.info('[CosmosMemory] 开始生成前情分段', {
    source_message_ids: batch.map(summary => summary.message_id),
  });

  const { settings } = useSettingsStore();
  const article = await rollupSummariesToArticle(
    settings.ai,
    batch.map(summary => ({ message_id: summary.message_id, summary: summary.summary })),
    {
      generation_id,
      should_cancel: () => wasTaskCancelled(generation_id),
    },
  );
  assertTaskCanSave(chat_id, batch, generation_id);

  return {
    article,
    sources: batch.map(summary => ({ message_id: summary.message_id, updated_at: summary.updated_at })),
    updated_at: new Date().toISOString(),
  };
}

async function rollupCore(generation_id: string, regenerate: boolean): Promise<SummaryRollupRunResult> {
  const chat_id = safeGetCurrentChatId();
  const { settings } = useSettingsStore();
  const segment_size = settings.summary_rollup.trigger_summary_count;
  const retained_count = settings.summary_rollup.retained_recent_summary_count;
  const existing_segments = regenerate ? [] : getValidSummaryRollups();
  const batches = regenerate
    ? getCanonicalBatches(retained_count, segment_size)
    : getPendingRollupBatches(retained_count, segment_size).batches;

  if (batches.length === 0) {
    if (regenerate) {
      saveRollups([]);
    }
    console.info('[CosmosMemory] 没有达到完整分段大小的待合并摘要，跳过二次总结', {
      mergeable_summary_count: getMergeableSummaries(retained_count).length,
      segment_size,
    });
    return {
      segments: existing_segments,
      generated_segment_count: 0,
      generated_source_count: 0,
    };
  }

  const generated_segments: SummaryRollupSegment[] = [];
  for (const batch of batches) {
    generated_segments.push(await generateSegment(batch, generation_id, chat_id));
  }

  // 较早分段生成后，后续请求期间其来源仍可能被编辑；保存前统一复核整轮全部来源。
  assertTaskCanSave(chat_id, batches.flat(), generation_id);

  // 重新生成采用原子替换：全部分段成功后才覆盖旧数据；增量生成同样一次性追加本轮完整结果。
  const segments = [...existing_segments, ...generated_segments].sort(
    (left, right) => left.sources[0]!.message_id - right.sources[0]!.message_id,
  );
  saveRollups(segments);
  console.info('[CosmosMemory] 分段式二次总结完成', {
    regenerate,
    generated_segment_count: generated_segments.length,
    generated_source_count: generated_segments.reduce((count, segment) => count + segment.sources.length, 0),
    ranges: generated_segments.map(segment => [segment.sources[0]!.message_id, segment.sources.at(-1)!.message_id]),
  });

  return {
    segments,
    generated_segment_count: generated_segments.length,
    generated_source_count: generated_segments.reduce((count, segment) => count + segment.sources.length, 0),
  };
}

function runRollupTask(regenerate: boolean): Promise<SummaryRollupRunResult> {
  if (running_task) {
    console.info('[CosmosMemory] 复用正在进行的二次总结任务');
    return running_task.promise;
  }

  is_task_cancelled = false;
  const generation_id = `cosmos-memory-summary-rollup-${Date.now()}`;
  const promise = rollupCore(generation_id, regenerate).finally(() => {
    running_task = null;
  });
  running_task = { promise, generation_id };
  return promise;
}

/** 按当前分段大小生成全部达到完整分段的待合并摘要 */
export function runSummaryRollup(): Promise<SummaryRollupRunResult> {
  return runRollupTask(false);
}

/** 丢弃现有分段表示，并按当前设置从现存逐楼摘要完整重建 */
export function regenerateSummaryRollups(): Promise<SummaryRollupRunResult> {
  return runRollupTask(true);
}

/** 待合并摘要达到一个完整分段时自动执行；失败仅告警，不打断主流程 */
export function triggerSummaryRollupIfNeeded() {
  const { settings } = useSettingsStore();
  if (!settings.summary_rollup.enabled || running_task) {
    return;
  }

  const { batches } = getPendingRollupBatches(
    settings.summary_rollup.retained_recent_summary_count,
    settings.summary_rollup.trigger_summary_count,
  );
  if (batches.length === 0) {
    return;
  }

  console.info('[CosmosMemory] 待合并摘要达到完整分段大小，自动触发二次总结', {
    pending_segment_count: batches.length,
    segment_size: settings.summary_rollup.trigger_summary_count,
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
