const STORAGE_ROOT = 'cosmos_memory';
const CHARACTER_STORAGE_PATH = `${STORAGE_ROOT}.characters`;
const CHARACTER_PROMPT_ID = 'cosmos_memory_characters';
const CHARACTER_PROMPT_DEPTH = 9999;

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
};

export type SecondaryCharacter = {
  type: 'secondary';
  name: string;
  brief: string;
};

export type StoredCharacter = PrimaryCharacter | SecondaryCharacter;

type SummaryWithCharacterOperations = {
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

export const StoredCharacterResponse = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('primary'),
    name: z.string().trim().min(1),
    background: z.string().trim().default(''),
    appearance: z.string().trim().default(''),
    personality: z.string().trim().default(''),
  }),
  z.object({
    type: z.literal('secondary'),
    name: z.string().trim().min(1),
    brief: z.string().trim().default(''),
  }),
]);

export const StoredCharactersResponse = z.array(StoredCharacterResponse).default([]);

let character_prompt_injected = false;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCharacterKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isStoredCharacter(value: unknown): value is StoredCharacter {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const character = value as Partial<StoredCharacter>;
  if (character.type === 'primary') {
    return (
      typeof character.name === 'string' &&
      typeof character.background === 'string' &&
      typeof character.appearance === 'string' &&
      typeof character.personality === 'string'
    );
  }

  return character.type === 'secondary' && typeof character.name === 'string' && typeof character.brief === 'string';
}

function getStoredCharacterRecord(): Record<string, StoredCharacter> {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const characters = _.get(variables, CHARACTER_STORAGE_PATH, {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(characters).filter((entry): entry is [string, StoredCharacter] => {
      const [key, character] = entry;
      return Boolean(key) && isStoredCharacter(character);
    }),
  );
}

export function getStoredCharacters(): StoredCharacter[] {
  return Object.values(getStoredCharacterRecord()).sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'primary' ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
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

export function applyCharacterOperations(operations: CharacterOperation[]): StoredCharacter[] {
  const characters = getStoredCharacterRecord();
  for (const operation of operations) {
    mergeCharacterOperation(characters, operation);
  }

  saveCharacterRecord(characters);
  return getStoredCharacters();
}

export function rebuildStoredCharactersFromSummaries(summaries: SummaryWithCharacterOperations[]): StoredCharacter[] {
  const characters: Record<string, StoredCharacter> = {};
  for (const summary of summaries) {
    for (const operation of summary.character_operations ?? []) {
      mergeCharacterOperation(characters, operation);
    }
  }

  saveCharacterRecord(characters);
  return Object.values(characters).sort((left, right) => left.name.localeCompare(right.name));
}

function saveCharacterRecord(characters: Record<string, StoredCharacter>) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      _.set(variables, CHARACTER_STORAGE_PATH, characters);
      return variables;
    },
    { type: 'chat' },
  );
}

export function replaceStoredCharacters(characters: StoredCharacter[]): StoredCharacter[] {
  const next: Record<string, StoredCharacter> = {};
  for (const character of characters) {
    const key = normalizeCharacterKey(character.name);
    if (key) {
      next[key] = character;
    }
  }

  saveCharacterRecord(next);
  return getStoredCharacters();
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

function clearChatCharacterPrompt() {
  if (!character_prompt_injected) {
    return;
  }

  window.TavernHelper.uninjectPrompts([CHARACTER_PROMPT_ID]);
  character_prompt_injected = false;
}

export function clearCharacterPromptInjection() {
  try {
    window.TavernHelper.uninjectPrompts([CHARACTER_PROMPT_ID]);
  } catch (error) {
    console.warn('[CosmosMemory] 清理人物信息聊天注入失败', error);
  }
  character_prompt_injected = false;
}

export function applyCharacterPromptInjection(enabled: boolean): boolean {
  clearChatCharacterPrompt();

  if (!enabled) {
    return false;
  }

  const content = formatCharactersForPrompt();
  if (!content) {
    return false;
  }

  window.TavernHelper.injectPrompts(
    [
      {
        id: CHARACTER_PROMPT_ID,
        position: 'in_chat',
        depth: CHARACTER_PROMPT_DEPTH,
        role: 'system',
        content,
      },
    ],
    { once: true },
  );
  character_prompt_injected = true;
  return true;
}
