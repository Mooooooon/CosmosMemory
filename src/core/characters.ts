import {
  defineEntityStore,
  normalizeEntityKey,
  normalizeText,
  STORAGE_ROOT,
  type EntityMeta,
} from '@/core/entity-store';

const CHARACTER_STORAGE_PATH = `${STORAGE_ROOT}.characters`;
export const CHARACTER_PROMPT_ID = 'cosmos_memory_characters';
export const CHARACTER_PROMPT_DEPTH = 9999;

export type CharacterKind = 'primary' | 'secondary';
export type CharacterOperationType = 'add' | 'set' | 'delete';

export type CharacterOperation = {
  type: CharacterOperationType;
  character_type: CharacterKind;
  name: string;
  background?: string;
  appearance?: string;
  personality?: string;
  brief?: string;
};

export type PrimaryCharacter = {
  type: 'primary';
  name: string;
  background: string;
  appearance: string;
  personality: string;
  /** 最后影响该记录的摘要楼层；手动重建或旧版本数据为 undefined */
  source_message_id?: number;
  /** 最后影响该记录的摘要生成时间 */
  updated_at?: string;
};

export type SecondaryCharacter = {
  type: 'secondary';
  name: string;
  brief: string;
  /** 最后影响该记录的摘要楼层；手动重建或旧版本数据为 undefined */
  source_message_id?: number;
  /** 最后影响该记录的摘要生成时间 */
  updated_at?: string;
};

export type StoredCharacter = PrimaryCharacter | SecondaryCharacter;

type SummaryWithCharacterOperations = {
  message_id?: number;
  updated_at?: string;
  character_operations?: CharacterOperation[];
};

export const CharacterOperationResponse = z.object({
  type: z.enum(['add', 'set', 'delete']),
  character_type: z.enum(['primary', 'secondary']),
  name: z.string().trim().min(1),
  background: z.string().trim().optional().default(''),
  appearance: z.string().trim().optional().default(''),
  personality: z.string().trim().optional().default(''),
  brief: z.string().trim().optional().default(''),
});

export const CharacterOperationsResponse = z.array(CharacterOperationResponse).default([]);

const EntityMetaFields = {
  source_message_id: z.number().int().optional(),
  updated_at: z.string().optional(),
};

export const StoredCharacterResponse = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('primary'),
    name: z.string().trim().min(1),
    background: z.string().trim().default(''),
    appearance: z.string().trim().default(''),
    personality: z.string().trim().default(''),
    ...EntityMetaFields,
  }),
  z.object({
    type: z.literal('secondary'),
    name: z.string().trim().min(1),
    brief: z.string().trim().default(''),
    ...EntityMetaFields,
  }),
]);

export const StoredCharactersResponse = z.array(StoredCharacterResponse).default([]);

export function normalizeCharacterKey(name: string): string {
  return normalizeEntityKey(name);
}

function isStoredCharacter(value: unknown): value is StoredCharacter {
  return StoredCharacterResponse.safeParse(value).success;
}

function compareStoredCharacters(left: StoredCharacter, right: StoredCharacter): number {
  if (left.type !== right.type) {
    return left.type === 'primary' ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function mergeCharacterOperation(
  characters: Record<string, StoredCharacter>,
  operation: CharacterOperation,
): Record<string, StoredCharacter> {
  const name = normalizeText(operation.name);
  const key = normalizeCharacterKey(name);
  if (!key) {
    return characters;
  }

  if (operation.type === 'delete') {
    _.unset(characters, key);
    return characters;
  }

  const existing = characters[key];
  if (operation.character_type === 'primary') {
    const next: PrimaryCharacter = {
      type: 'primary',
      name: name || existing?.name || '',
      background: existing?.type === 'primary' ? existing.background : '',
      appearance: existing?.type === 'primary' ? existing.appearance : '',
      personality: existing?.type === 'primary' ? existing.personality : '',
    };
    const background = normalizeText(operation.background);
    const appearance = normalizeText(operation.appearance);
    const personality = normalizeText(operation.personality);

    if (background) {
      next.background = background;
    }
    if (appearance) {
      next.appearance = appearance;
    }
    if (personality) {
      next.personality = personality;
    }

    characters[key] = next;
    return characters;
  }

  const next: SecondaryCharacter = {
    type: 'secondary',
    name: name || existing?.name || '',
    brief: existing?.type === 'secondary' ? existing.brief : '',
  };
  const brief = normalizeText(operation.brief);
  if (brief) {
    next.brief = brief;
  }

  characters[key] = next;
  return characters;
}

const characterStore = defineEntityStore<StoredCharacter, CharacterOperation, SummaryWithCharacterOperations>({
  storagePath: CHARACTER_STORAGE_PATH,
  entityName: '人物',
  isValidEntity: isStoredCharacter,
  getEntityKey: character => normalizeCharacterKey(character.name),
  applyOperation: (record, operation) => {
    const key = normalizeCharacterKey(normalizeText(operation.name));
    mergeCharacterOperation(record, operation);
    return key ? [key] : [];
  },
  sortEntities: compareStoredCharacters,
  getSummaryOperations: summary => summary.character_operations,
  getSummaryMeta: summary => ({ source_message_id: summary.message_id, updated_at: summary.updated_at }),
});

export function getStoredCharacters(): StoredCharacter[] {
  return characterStore.getAll();
}

export function applyCharacterOperations(operations: CharacterOperation[], meta: EntityMeta = {}): StoredCharacter[] {
  return characterStore.applyOperations(operations, meta);
}

export function rebuildStoredCharactersFromSummaries(summaries: SummaryWithCharacterOperations[]): StoredCharacter[] {
  return characterStore.rebuildFromSummaries(summaries);
}

export function replaceStoredCharacters(characters: StoredCharacter[]): StoredCharacter[] {
  return characterStore.replaceAll(characters, { updated_at: new Date().toISOString() });
}

export function formatCharactersForPrompt(characters: StoredCharacter[] = getStoredCharacters()): string {
  const primary_characters = characters.filter(
    (character): character is PrimaryCharacter => character.type === 'primary',
  );
  const secondary_characters = characters.filter(
    (character): character is SecondaryCharacter => character.type === 'secondary',
  );

  if (primary_characters.length === 0 && secondary_characters.length === 0) {
    return '';
  }

  const lines = ['[CosmosMemory 人物信息]', '以下是已经记录的人物信息，优先沿用这些设定，不要重复发明同名人物。'];

  if (primary_characters.length > 0) {
    lines.push('', '主要角色：');
    for (const character of primary_characters) {
      lines.push(`- 姓名：${character.name}`);
      if (character.background) {
        lines.push(`  背景介绍：${character.background}`);
      }
      if (character.appearance) {
        lines.push(`  外貌描写：${character.appearance}`);
      }
      if (character.personality) {
        lines.push(`  性格描写：${character.personality}`);
      }
    }
  }

  if (secondary_characters.length > 0) {
    lines.push('', '次要角色：');
    for (const character of secondary_characters) {
      lines.push(`- 姓名/身份：${character.name}`);
      if (character.brief) {
        lines.push(`  简介：${character.brief}`);
      }
    }
  }

  lines.push('[/CosmosMemory 人物信息]');
  return lines.join('\n');
}
