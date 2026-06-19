import type { AiSettings } from '@/type/settings';
import {
  CharacterOperationsResponse,
  StoredCharactersResponse,
  formatCharactersForPrompt,
  type CharacterOperation,
  type StoredCharacter,
} from '@/core/characters';
import { parsePrettified } from '@/util/zod';

const TEST_MESSAGE = '!ping';
const DEFAULT_CUSTOM_API_SOURCE = 'openai';
const DEEPSEEK_API_SOURCE = 'deepseek';
const SUMMARY_MAX_TOKENS = 2048;

type CustomApi = NonNullable<GenerateConfig['custom_api']>;

const SummaryResponse = z.object({
  summary: z.string().trim().min(1),
});

const SummaryWithCharactersResponse = z.object({
  summary: z.string().trim().min(1),
  characters: CharacterOperationsResponse,
});

const CharacterExtractionResponse = z.object({
  characters: StoredCharactersResponse,
});

export type SummaryGenerationResult = {
  summary: string;
  characters: CharacterOperation[];
};

export type SummaryGenerationOptions = {
  characters_enabled?: boolean;
  stored_characters?: StoredCharacter[];
};

const SUMMARY_SYSTEM_PROMPT =
  '你是剧情摘要器。请把用户提供的内容压缩成一段连贯的故事摘要，只保留已发生的剧情事实、角色行动、状态与关系变化。输出必须是流畅的叙述段落，不要使用分类标签或清单格式，不要续写剧情，不要加入原文没有的信息。';

const SUMMARY_JSON_INSTRUCTION =
  '请总结以下剧情内容，只返回 JSON。格式：{"summary":"连贯的剧情摘要"}。不要使用 Markdown 代码块，不要返回额外解释。';

const CHARACTER_EXTRACTION_INSTRUCTION =
  '同时提取本楼层明确新增、更新或删除的人物信息，返回 characters 数组。主要角色是剧情中有明确戏份的角色，需要保存姓名、背景介绍、外貌描写、性格描写；次要角色是会多次出现但不重要的 NPC，例如酒馆老板、公会看板娘，只需要保存姓名或身份和简介。一次性路人、杂兵、临时敌人不要记录。只返回本楼层带来的变化，不要重复返回没有变化的已有人物。';

const CHARACTER_JSON_INSTRUCTION =
  '请总结以下剧情内容，只返回 JSON。格式：{"summary":"连贯的剧情摘要","characters":[{"type":"add|set|delete","character_type":"primary|secondary","name":"姓名或身份","background":"主要角色背景介绍，没有则为空字符串","appearance":"主要角色外貌描写，没有则为空字符串","personality":"主要角色性格描写，没有则为空字符串","brief":"次要角色简介，没有则为空字符串"}]}。不要使用 Markdown 代码块，不要返回额外解释。';

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

  if (!options.characters_enabled) {
    return {
      summary: parsePrettified(SummaryResponse, parsed).summary,
      characters: [],
    };
  }

  const result = parsePrettified(SummaryWithCharactersResponse, parsed);
  return {
    summary: result.summary,
    characters: result.characters,
  };
}

function buildSummaryContent(content: string, options: SummaryGenerationOptions): string {
  if (!options.characters_enabled) {
    return content;
  }

  const characters = formatCharactersForPrompt(options.stored_characters ?? []);
  if (!characters) {
    return content;
  }

  return `${characters}\n\n[本楼层回复]\n${content}`;
}

function buildSummarySystemPrompt(options: SummaryGenerationOptions): string {
  if (!options.characters_enabled) {
    return SUMMARY_SYSTEM_PROMPT;
  }

  return `${SUMMARY_SYSTEM_PROMPT}\n${CHARACTER_EXTRACTION_INSTRUCTION}`;
}

function buildStructuredSummarySchema(options: SummaryGenerationOptions): JsonSchema {
  if (!options.characters_enabled) {
    return {
      name: 'cosmos_memory_message_summary',
      description: '单条剧情回复摘要',
      strict: true,
      value: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: '压缩后的剧情摘要',
          },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    };
  }

  return {
    name: 'cosmos_memory_message_summary_with_characters',
    description: '单条剧情回复摘要和人物信息变更',
    strict: true,
    value: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: '压缩后的剧情摘要',
        },
        characters: {
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
        },
      },
      required: ['summary', 'characters'],
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
        content: `${options.characters_enabled ? CHARACTER_JSON_INSTRUCTION : SUMMARY_JSON_INSTRUCTION}\n\n${buildSummaryContent(
          content,
          options,
        )}`,
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

async function extractCharactersWithStructuredOutput(settings: AiSettings, content: string): Promise<StoredCharacter[]> {
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

export async function extractCharactersFromChatContent(settings: AiSettings, content: string): Promise<StoredCharacter[]> {
  try {
    return await extractCharactersWithStructuredOutput(settings, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[CosmosMemory] 结构化输出人物信息重新生成失败，降级为普通 JSON 提示重试', { message });
    return extractCharactersWithJsonPrompt(settings, content);
  }
}
