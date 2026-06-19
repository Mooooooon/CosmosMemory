const STORAGE_ROOT = 'cosmos_memory';
const TIME_STORAGE_PATH = `${STORAGE_ROOT}.time`;
const TIME_PROMPT_ID = 'cosmos_memory_time';
const TIME_PROMPT_DEPTH = 10001;

export type StoryTimeUpdate = {
  current_time: string;
  elapsed_time?: string;
  reason?: string;
};

type SummaryWithTimeUpdate = {
  time_update?: StoryTimeUpdate | null;
};

export const TimeUpdateResponse = z.object({
  current_time: z.string().trim().default(''),
  elapsed_time: z.string().trim().optional().default(''),
  reason: z.string().trim().optional().default(''),
});

let time_prompt_injected = false;

function normalizeTime(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getStoredTime(): string {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  return normalizeTime(_.get(variables, TIME_STORAGE_PATH, ''));
}

function saveStoredTime(current_time: string) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      const normalized_time = current_time.trim();
      if (normalized_time) {
        _.set(variables, TIME_STORAGE_PATH, normalized_time);
      } else {
        _.unset(variables, TIME_STORAGE_PATH);
      }
      return variables;
    },
    { type: 'chat' },
  );
}

export function applyTimeUpdate(update: StoryTimeUpdate | null | undefined): string {
  const current_time = normalizeTime(update?.current_time);
  if (!current_time) {
    return getStoredTime();
  }

  saveStoredTime(current_time);
  return current_time;
}

export function rebuildStoredTimeFromSummaries(summaries: SummaryWithTimeUpdate[]): string {
  const current_time = summaries.reduce((time, summary) => {
    return normalizeTime(summary.time_update?.current_time) || time;
  }, '');

  saveStoredTime(current_time);
  return current_time;
}

export function formatTimeForPrompt(current_time: string = getStoredTime()): string {
  const normalized_time = current_time.trim();
  if (!normalized_time) {
    return '';
  }

  return ['[CosmosMemory 时间]', `当前故事时间：${normalized_time}`, '[/CosmosMemory 时间]'].join('\n');
}

export function formatTimeForSummaryRequest(current_time: string): string {
  const normalized_time = current_time.trim();
  if (normalized_time) {
    return formatTimeForPrompt(normalized_time);
  }

  return [
    '[CosmosMemory 时间]',
    '当前故事时间：未记录，请根据本楼层剧情生成符合背景的当前时间。',
    '[/CosmosMemory 时间]',
  ].join('\n');
}

function clearChatTimePrompt() {
  if (!time_prompt_injected) {
    return;
  }

  window.TavernHelper.uninjectPrompts([TIME_PROMPT_ID]);
  time_prompt_injected = false;
}

export function clearTimePromptInjection() {
  try {
    window.TavernHelper.uninjectPrompts([TIME_PROMPT_ID]);
  } catch (error) {
    console.warn('[CosmosMemory] 清理时间信息聊天注入失败', error);
  }
  time_prompt_injected = false;
}

export function applyTimePromptInjection(enabled: boolean): boolean {
  clearChatTimePrompt();

  if (!enabled) {
    return false;
  }

  const content = formatTimeForPrompt();
  if (!content) {
    return false;
  }

  window.TavernHelper.injectPrompts(
    [
      {
        id: TIME_PROMPT_ID,
        position: 'in_chat',
        depth: TIME_PROMPT_DEPTH,
        role: 'system',
        content,
      },
    ],
    { once: true },
  );
  time_prompt_injected = true;
  return true;
}
