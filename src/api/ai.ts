import type { AiSettings } from '@/type/settings';
import {
  CharacterOperationsResponse,
  StoredCharactersResponse,
  formatCharactersForPrompt,
  type CharacterOperation,
  type StoredCharacter,
} from '@/core/characters';
<<<<<<< HEAD
import {
  ItemOperationsResponse,
  formatItemsForPrompt,
  type ItemOperation,
  type StoredItem,
} from '@/core/items';
import {
  CurrentInfoUpdateResponse,
  formatCurrentInfoForSummaryRequest,
  type CurrentInfo,
  type CurrentInfoUpdate,
} from '@/core/current-info';
=======
import { ItemOperationsResponse, formatItemsForPrompt, type ItemOperation, type StoredItem } from '@/core/items';
import { TimeUpdateResponse, formatTimeForSummaryRequest, type StoryTimeUpdate } from '@/core/time';
>>>>>>> 6af34619e83032277ab8967ad9f92ba7845110a9
import { parsePrettified } from '@/util/zod';

const TEST_MESSAGE = '!ping';
const DEFAULT_CUSTOM_API_SOURCE = 'openai';
const DEEPSEEK_API_SOURCE = 'deepseek';
const SUMMARY_MAX_TOKENS = 2048;

type CustomApi = NonNullable<GenerateConfig['custom_api']>;

const SummaryResponse = z.object({
  summary: z.string().trim().min(1),
});

const SummaryWithMemoryResponse = z.object({
  summary: z.string().trim().min(1),
  characters: CharacterOperationsResponse.optional().default([]),
  item_operations: ItemOperationsResponse.optional().default([]),
  current_info_update: CurrentInfoUpdateResponse.nullable().optional(),
});

const CharacterExtractionResponse = z.object({
  characters: StoredCharactersResponse,
});

export type SummaryGenerationResult = {
  summary: string;
  characters: CharacterOperation[];
  item_operations: ItemOperation[];
  current_info_update?: CurrentInfoUpdate | null;
};

export type SummaryGenerationOptions = {
  characters_enabled?: boolean;
  stored_characters?: StoredCharacter[];
  items_enabled?: boolean;
  stored_items?: StoredItem[];
  current_info_enabled?: boolean;
  current_info?: CurrentInfo;
};

const SUMMARY_SYSTEM_PROMPT =
  '你是剧情摘要器。请把用户提供的内容压缩成一段连贯的故事摘要，只保留已发生的剧情事实、角色行动、状态与关系变化。输出必须是流畅的叙述段落，不要使用分类标签或清单格式，不要续写剧情，不要加入原文没有的信息。';

const SUMMARY_JSON_INSTRUCTION =
  '请总结以下剧情内容，只返回 JSON。格式：{"summary":"连贯的剧情摘要"}。不要使用 Markdown 代码块，不要返回额外解释。';

const CHARACTER_EXTRACTION_INSTRUCTION =
  '同时提取本楼层明确新增、更新或删除的人物信息，返回 characters 数组。主要角色是剧情中有明确戏份的角色，需要保存姓名、背景介绍、外貌描写、性格描写；次要角色是会多次出现但不重要的 NPC，例如酒馆老板、公会看板娘，只需要保存姓名或身份和简介。一次性路人、杂兵、临时敌人不要记录。只返回本楼层带来的变化，不要重复返回没有变化的已有人物。';

const ITEM_EXTRACTION_INSTRUCTION =
  '同时提取本楼层明确新增、更新或删除的重要物品信息，返回 item_operations 数组。只记录会影响剧情的重要道具，例如武器、装备、礼物、信物、钥匙、契约、任务物品等；不要记录普通食物、零钱、临时杂物、随手可得且不影响剧情的物品。物品被使用、损坏、交出、消耗或状态改变时要及时用 set 更新简介；物品彻底失去剧情意义或不再持有时可用 delete 删除。只返回本楼层带来的变化，不要重复返回没有变化的已有物品。';

const CURRENT_INFO_EXTRACTION_INSTRUCTION =
  '同时维护当前信息，返回 current_info_update。当前信息包括：时间、地点、角色列表。角色列表必须用角色名作为 key，value 记录角色服装和角色状态；角色状态应包含动作、姿势、所在状态等当前场景信息。若已有当前信息为空，请根据本楼层剧情内容生成符合背景的当前信息；若已有当前信息不为空，请根据本楼层结束后的状态更新。若本楼层没有明确变化，则保持原值。不要使用现实时间，除非剧情本身就是现实背景。';

const CURRENT_INFO_JSON_FIELD_INSTRUCTION =
  '"current_info_update":{"current_time":"本楼层结束后的当前故事时间","location":"本楼层结束后的当前地点","characters":{"角色名":{"clothing":"角色当前服装，没有则为空字符串","status":"角色当前状态，包含动作、姿势等，没有则为空字符串"}},"elapsed_time":"本楼层消耗的剧情时间，没有则为空字符串","reason":"更新当前信息的依据，没有则为空字符串"}';

const FULL_CHARACTER_EXTRACTION_SYSTEM_PROMPT =
  '你是剧情人物档案整理器。请阅读用户提供的所有 AI 回复原文，整理剧情中需要长期记忆的人物信息。只记录有明确戏份的主要角色，以及会多次出现但不重要的次要 NPC，例如酒馆老板、公会看板娘。一次性路人、杂兵、临时敌人不要记录。不要续写剧情，不要加入原文没有的信息。';

const FULL_CHARACTER_JSON_INSTRUCTION =
  '请从以下剧情记录中整理所有需要保存的人物，只返回 JSON。格式：{"characters":[{"type":"primary|secondary","name":"姓名或身份","background":"主要角色背景介绍，没有则为空字符串","appearance":"主要角色外貌描写，没有则为空字符串","personality":"主要角色性格描写，没有则为空字符串","brief":"次要角色简介，没有则为空字符串"}]}。不要使用 Markdown 代码块，不要返回额外解释。';

function inferCustomApiSource(settings: AiSettings): string {
  const target = `${settings.custom_api_url} ${settings.selected_model}`.toLowerCase();
  if (target.includes('deepseek')) {
    return DEEPSEEK_API_SOURCE;
  }

  return DEFAULT_CUSTOM_API_SOURCE;
}

function buildCustomApi(settings: AiSettings): CustomApi | undefined {
  if (settings.use_tavern_api) {
    return undefined;
  }

  const apiurl = settings.custom_api_url.trim();
  if (!apiurl) {
    throw new Error('请先填写自定义端点。');
  }

  const key = settings.custom_api_key.trim();
  const model = settings.selected_model.trim();
  if (!model) {
    throw new Error('请选择模型。');
  }

  return {
    apiurl,
    key: key || undefined,
    model: model || undefined,
    source: inferCustomApiSource(settings),
    max_tokens: SUMMARY_MAX_TOKENS,
  };
}

export async function fetchCustomModelNames(settings: AiSettings): Promise<string[]> {
  const apiurl = settings.custom_api_url.trim();
  if (!apiurl) {
    throw new Error('请先填写自定义端点。');
  }

  const models = await window.TavernHelper.getModelList({
    apiurl,
    key: settings.custom_api_key.trim() || undefined,
  });

  return [...new Set(models)].filter(Boolean).sort((left, right) => left.localeCompare(right));
}

export async function sendPing(settings: AiSettings): Promise<string> {
  const result = await window.TavernHelper.generateRaw({
    should_silence: true,
    custom_api: buildCustomApi(settings),
    ordered_prompts: [{ role: 'user', content: TEST_MESSAGE }],
  });

  if (typeof result !== 'string') {
    return result.content;
  }

  return result;
}

function parseSummaryJson(raw: string, options: SummaryGenerationOptions = {}): SummaryGenerationResult {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const json_text = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = JSON.parse(json_text);

  if (!hasMemoryExtraction(options)) {
    return {
      summary: parsePrettified(SummaryResponse, parsed).summary,
      characters: [],
      item_operations: [],
    };
  }

  const result = parsePrettified(SummaryWithMemoryResponse, parsed);
  return {
    summary: result.summary,
    characters: options.characters_enabled ? result.characters : [],
    item_operations: options.items_enabled ? result.item_operations : [],
    current_info_update: options.current_info_enabled ? (result.current_info_update ?? null) : null,
  };
}

function hasMemoryExtraction(options: SummaryGenerationOptions): boolean {
  return (
    options.characters_enabled === true || options.items_enabled === true || options.current_info_enabled === true
  );
}

function buildSummaryContent(content: string, options: SummaryGenerationOptions): string {
  if (!hasMemoryExtraction(options)) {
    return content;
  }

  const memory_sections = [
    options.current_info_enabled ? formatCurrentInfoForSummaryRequest(options.current_info) : '',
    options.items_enabled ? formatItemsForPrompt(options.stored_items ?? []) : '',
    options.characters_enabled ? formatCharactersForPrompt(options.stored_characters ?? []) : '',
  ].filter(Boolean);

  if (memory_sections.length === 0) {
    return content;
  }

  return `${memory_sections.join('\n\n')}\n\n[本楼层回复]\n${content}`;
}

function buildSummarySystemPrompt(options: SummaryGenerationOptions): string {
  const instructions = [SUMMARY_SYSTEM_PROMPT];

  if (options.current_info_enabled) {
    instructions.push(CURRENT_INFO_EXTRACTION_INSTRUCTION);
  }

  if (options.items_enabled) {
    instructions.push(ITEM_EXTRACTION_INSTRUCTION);
  }

  if (options.characters_enabled) {
    instructions.push(CHARACTER_EXTRACTION_INSTRUCTION);
  }

  return instructions.join('\n');
}

function buildSummaryJsonInstruction(options: SummaryGenerationOptions): string {
  if (!hasMemoryExtraction(options)) {
    return SUMMARY_JSON_INSTRUCTION;
  }

  const fields = ['"summary":"连贯的剧情摘要"'];
  if (options.current_info_enabled) {
    fields.push(CURRENT_INFO_JSON_FIELD_INSTRUCTION);
  }
  if (options.items_enabled) {
    fields.push(
      '"item_operations":[{"type":"add|set|delete","name":"物品名","brief":"物品简介或当前状态，没有则为空字符串"}]',
    );
  }
  if (options.characters_enabled) {
    fields.push(
      '"characters":[{"type":"add|set|delete","character_type":"primary|secondary","name":"姓名或身份","background":"主要角色背景介绍，没有则为空字符串","appearance":"主要角色外貌描写，没有则为空字符串","personality":"主要角色性格描写，没有则为空字符串","brief":"次要角色简介，没有则为空字符串"}]',
    );
  }

  return `请总结以下剧情内容，只返回 JSON。格式：{${fields.join(',')}}。不要使用 Markdown 代码块，不要返回额外解释。`;
}

function buildStructuredSummarySchema(options: SummaryGenerationOptions): JsonSchema {
  const properties: Record<string, unknown> = {
    summary: {
      type: 'string',
      description: '压缩后的剧情摘要',
    },
  };
  const required = ['summary'];

  if (options.current_info_enabled) {
    properties.current_info_update = {
      type: 'object',
      description: '本楼层结束后的当前信息；没有变化时保持原值',
      properties: {
        current_time: {
          type: 'string',
          description: '本楼层结束后的当前故事时间',
        },
        location: {
          type: 'string',
          description: '本楼层结束后的当前地点；无法判断则保持原值或返回空字符串',
        },
        characters: {
          type: 'object',
          description: '本楼层结束后的当前角色列表；key 为角色名',
          additionalProperties: {
            type: 'object',
            properties: {
              clothing: {
                type: 'string',
                description: '角色当前服装；无法判断则为空字符串',
              },
              status: {
                type: 'string',
                description: '角色当前状态，包含动作、姿势等；无法判断则为空字符串',
              },
            },
            required: ['clothing', 'status'],
            additionalProperties: false,
          },
        },
        elapsed_time: {
          type: 'string',
          description: '本楼层消耗的剧情时间；没有则为空字符串',
        },
        reason: {
          type: 'string',
          description: '更新当前信息的依据；没有则为空字符串',
        },
      },
      required: ['current_time', 'location', 'characters', 'elapsed_time', 'reason'],
      additionalProperties: false,
    };
    required.push('current_info_update');
  }

  if (options.items_enabled) {
    properties.item_operations = {
      type: 'array',
      description: '本楼层带来的重要物品信息变更；没有变化时返回空数组',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['add', 'set', 'delete'],
            description: '物品操作类型',
          },
          name: {
            type: 'string',
            description: '物品名',
          },
          brief: {
            type: 'string',
            description: '物品简介或当前状态；不适用或无变化时返回空字符串',
          },
        },
        required: ['type', 'name', 'brief'],
        additionalProperties: false,
      },
    };
    required.push('item_operations');
  }

  if (options.characters_enabled) {
    properties.characters = {
      type: 'array',
      description: '本楼层带来的人物信息变更；没有变化时返回空数组',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['add', 'set', 'delete'],
            description: '人物操作类型',
          },
          character_type: {
            type: 'string',
            enum: ['primary', 'secondary'],
            description: '人物重要程度',
          },
          name: {
            type: 'string',
            description: '角色全名，或次要角色的稳定身份称呼',
          },
          background: {
            type: 'string',
            description: '主要角色背景介绍；不适用或无变化时返回空字符串',
          },
          appearance: {
            type: 'string',
            description: '主要角色外貌描写；不适用或无变化时返回空字符串',
          },
          personality: {
            type: 'string',
            description: '主要角色性格描写；不适用或无变化时返回空字符串',
          },
          brief: {
            type: 'string',
            description: '次要角色简介；不适用或无变化时返回空字符串',
          },
        },
        required: ['type', 'character_type', 'name', 'background', 'appearance', 'personality', 'brief'],
        additionalProperties: false,
      },
    };
    required.push('characters');
  }

  return {
    name: hasMemoryExtraction(options) ? 'cosmos_memory_message_summary_with_memory' : 'cosmos_memory_message_summary',
    description: hasMemoryExtraction(options) ? '单条剧情回复摘要和记忆变更' : '单条剧情回复摘要',
    strict: true,
    value: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

function buildFullCharacterExtractionSchema(): JsonSchema {
  return {
    name: 'cosmos_memory_full_characters',
    description: '当前聊天中的完整人物信息表',
    strict: true,
    value: {
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          description: '需要长期保存的人物信息',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['primary', 'secondary'],
                description: '人物重要程度',
              },
              name: {
                type: 'string',
                description: '主要角色全名，或次要角色的稳定身份称呼',
              },
              background: {
                type: 'string',
                description: '主要角色背景介绍；不适用或无资料时返回空字符串',
              },
              appearance: {
                type: 'string',
                description: '主要角色外貌描写；不适用或无资料时返回空字符串',
              },
              personality: {
                type: 'string',
                description: '主要角色性格描写；不适用或无资料时返回空字符串',
              },
              brief: {
                type: 'string',
                description: '次要角色简介；不适用或无资料时返回空字符串',
              },
            },
            required: ['type', 'name', 'background', 'appearance', 'personality', 'brief'],
            additionalProperties: false,
          },
        },
      },
      required: ['characters'],
      additionalProperties: false,
    },
  };
}

function parseFullCharacterExtractionJson(raw: string): StoredCharacter[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const json_text = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return parsePrettified(CharacterExtractionResponse, JSON.parse(json_text)).characters;
}

async function summarizeMessageWithStructuredOutput(
  settings: AiSettings,
  content: string,
  options: SummaryGenerationOptions = {},
): Promise<SummaryGenerationResult> {
  const custom_source = settings.use_tavern_api ? undefined : inferCustomApiSource(settings);
  console.info('[CosmosMemory] 使用结构化输出请求剧情总结', {
    custom_source,
    mode: custom_source === DEEPSEEK_API_SOURCE ? 'deepseek_json_object_via_st' : 'json_schema',
    characters_enabled: options.characters_enabled === true,
    items_enabled: options.items_enabled === true,
    current_info_enabled: options.current_info_enabled === true,
  });

  const result = await window.TavernHelper.generateRaw({
    should_silence: true,
    custom_api: buildCustomApi(settings),
    ordered_prompts: [
      {
        role: 'system',
        content: buildSummarySystemPrompt(options),
      },
      {
        role: 'user',
        content: `请总结以下剧情内容：\n\n${buildSummaryContent(content, options)}`,
      },
    ],
    json_schema: buildStructuredSummarySchema(options),
  });

  if (typeof result !== 'string') {
    throw new Error('总结请求返回了非文本结果。');
  }

  return parseSummaryJson(result, options);
}

async function summarizeMessageWithJsonPrompt(
  settings: AiSettings,
  content: string,
  options: SummaryGenerationOptions = {},
): Promise<SummaryGenerationResult> {
  const result = await window.TavernHelper.generateRaw({
    should_silence: true,
    custom_api: buildCustomApi(settings),
    ordered_prompts: [
      {
        role: 'system',
        content: buildSummarySystemPrompt(options),
      },
      {
        role: 'user',
        content: `${buildSummaryJsonInstruction(options)}\n\n${buildSummaryContent(content, options)}`,
      },
    ],
  });

  if (typeof result !== 'string') {
    throw new Error('总结请求返回了非文本结果。');
  }

  return parseSummaryJson(result, options);
}

export async function summarizeMessage(
  settings: AiSettings,
  content: string,
  options: SummaryGenerationOptions = {},
): Promise<SummaryGenerationResult> {
  try {
    return await summarizeMessageWithStructuredOutput(settings, content, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[CosmosMemory] 结构化输出总结请求失败，降级为普通 JSON 提示重试', { message });
    return summarizeMessageWithJsonPrompt(settings, content, options);
  }
}

async function extractCharactersWithStructuredOutput(
  settings: AiSettings,
  content: string,
): Promise<StoredCharacter[]> {
  const result = await window.TavernHelper.generateRaw({
    should_silence: true,
    custom_api: buildCustomApi(settings),
    ordered_prompts: [
      {
        role: 'system',
        content: FULL_CHARACTER_EXTRACTION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `${FULL_CHARACTER_JSON_INSTRUCTION}\n\n${content}`,
      },
    ],
    json_schema: buildFullCharacterExtractionSchema(),
  });

  if (typeof result !== 'string') {
    throw new Error('人物信息重新生成返回了非文本结果。');
  }

  return parseFullCharacterExtractionJson(result);
}

async function extractCharactersWithJsonPrompt(settings: AiSettings, content: string): Promise<StoredCharacter[]> {
  const result = await window.TavernHelper.generateRaw({
    should_silence: true,
    custom_api: buildCustomApi(settings),
    ordered_prompts: [
      {
        role: 'system',
        content: FULL_CHARACTER_EXTRACTION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `${FULL_CHARACTER_JSON_INSTRUCTION}\n\n${content}`,
      },
    ],
  });

  if (typeof result !== 'string') {
    throw new Error('人物信息重新生成返回了非文本结果。');
  }

  return parseFullCharacterExtractionJson(result);
}

export async function extractCharactersFromChatContent(
  settings: AiSettings,
  content: string,
): Promise<StoredCharacter[]> {
  try {
    return await extractCharactersWithStructuredOutput(settings, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[CosmosMemory] 结构化输出人物信息重新生成失败，降级为普通 JSON 提示重试', { message });
    return extractCharactersWithJsonPrompt(settings, content);
  }
}
