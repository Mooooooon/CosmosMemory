import { normalizeText, STORAGE_ROOT } from '@/core/entity-store';

const CURRENT_INFO_STORAGE_PATH = `${STORAGE_ROOT}.current_info`;
export const CURRENT_INFO_PROMPT_ID = 'cosmos_memory_current_info';
export const CURRENT_INFO_PROMPT_DEPTH = 10002;

export type CurrentCharacterInfo = {
  clothing: string;
  status: string;
};

export type CurrentInfo = {
  current_time: string;
  location: string;
  characters: Record<string, CurrentCharacterInfo>;
};

export type CurrentInfoUpdate = CurrentInfo & {
  elapsed_time?: string;
  reason?: string;
};

type SummaryWithCurrentInfoUpdate = {
  current_info_update?: CurrentInfoUpdate | null;
};

const CurrentCharacterInfoResponse = z.object({
  clothing: z.string().trim().default(''),
  status: z.string().trim().default(''),
});

export const CurrentInfoUpdateResponse = z.object({
  current_time: z.string().trim().default(''),
  location: z.string().trim().default(''),
  characters: z.record(z.string(), CurrentCharacterInfoResponse).default({}),
  elapsed_time: z.string().trim().optional().default(''),
  reason: z.string().trim().optional().default(''),
});

function normalizeCurrentCharacters(value: unknown): Record<string, CurrentCharacterInfo> {
  if (!_.isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([name, character]) => {
        if (!_.isPlainObject(character)) {
          return null;
        }

        const info = character as Partial<CurrentCharacterInfo>;
        const normalized_name = name.trim();
        const normalized_character = {
          clothing: normalizeText(info.clothing),
          status: normalizeText(info.status),
        };

        if (!normalized_name || (!normalized_character.clothing && !normalized_character.status)) {
          return null;
        }

        return [normalized_name, normalized_character] as const;
      })
      .filter((entry): entry is readonly [string, CurrentCharacterInfo] => entry !== null),
  );
}

function normalizeCurrentInfo(value: unknown): CurrentInfo {
  if (!_.isPlainObject(value)) {
    return {
      current_time: normalizeText(value),
      location: '',
      characters: {},
    };
  }

  const info = value as Partial<CurrentInfo>;
  return {
    current_time: normalizeText(info.current_time),
    location: normalizeText(info.location),
    characters: normalizeCurrentCharacters(info.characters),
  };
}

export function getStoredCurrentInfo(): CurrentInfo {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  return normalizeCurrentInfo(_.get(variables, CURRENT_INFO_STORAGE_PATH, {}));
}

function saveStoredCurrentInfo(current_info: CurrentInfo) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      const normalized_info = normalizeCurrentInfo(current_info);
      if (
        normalized_info.current_time ||
        normalized_info.location ||
        Object.keys(normalized_info.characters).length > 0
      ) {
        _.set(variables, CURRENT_INFO_STORAGE_PATH, normalized_info);
      } else {
        _.unset(variables, CURRENT_INFO_STORAGE_PATH);
      }
      return variables;
    },
    { type: 'chat' },
  );
}

export function applyCurrentInfoUpdate(update: CurrentInfoUpdate | null | undefined): CurrentInfo {
  const stored_info = getStoredCurrentInfo();
  const normalized_update = normalizeCurrentInfo(update);
  const next_info = {
    current_time: normalized_update.current_time || stored_info.current_time,
    location: normalized_update.location || stored_info.location,
    characters:
      Object.keys(normalized_update.characters).length > 0 ? normalized_update.characters : stored_info.characters,
  };

  saveStoredCurrentInfo(next_info);
  return next_info;
}

export function rebuildStoredCurrentInfoFromSummaries(summaries: SummaryWithCurrentInfoUpdate[]): CurrentInfo {
  const current_info = summaries.reduce<CurrentInfo>((info, summary) => {
    const next_info = normalizeCurrentInfo(summary.current_info_update);
    return {
      current_time: next_info.current_time || info.current_time,
      location: next_info.location || info.location,
      characters: Object.keys(next_info.characters).length > 0 ? next_info.characters : info.characters,
    };
  }, normalizeCurrentInfo(''));

  saveStoredCurrentInfo(current_info);
  return current_info;
}

export function formatCurrentInfoForPrompt(current_info: CurrentInfo = getStoredCurrentInfo()): string {
  const normalized_info = normalizeCurrentInfo(current_info);
  if (
    !normalized_info.current_time &&
    !normalized_info.location &&
    Object.keys(normalized_info.characters).length === 0
  ) {
    return '';
  }

  const lines = ['[CosmosMemory 当前信息]'];
  if (normalized_info.current_time) {
    lines.push(`时间：${normalized_info.current_time}`);
  }
  if (normalized_info.location) {
    lines.push(`地点：${normalized_info.location}`);
  }
  if (Object.keys(normalized_info.characters).length > 0) {
    lines.push('角色列表：');
    for (const [name, character] of Object.entries(normalized_info.characters)) {
      lines.push(`- ${name}`);
      if (character.clothing) {
        lines.push(`  服装：${character.clothing}`);
      }
      if (character.status) {
        lines.push(`  状态：${character.status}`);
      }
    }
  }
  lines.push('[/CosmosMemory 当前信息]');

  return lines.join('\n');
}

export function formatCurrentInfoForSummaryRequest(current_info: CurrentInfo | undefined): string {
  const normalized_info = normalizeCurrentInfo(current_info);
  const content = formatCurrentInfoForPrompt(normalized_info);
  if (content) {
    return content;
  }

  return [
    '[CosmosMemory 当前信息]',
    '当前信息尚未记录，请根据本楼层剧情生成符合背景的时间、地点和当前出场角色状态。',
    '[/CosmosMemory 当前信息]',
  ].join('\n');
}

