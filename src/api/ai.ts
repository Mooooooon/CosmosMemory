import type { AiSettings } from '@/type/settings';
import {
  CharacterOperationsResponse,
  StoredCharactersResponse,
  formatCharactersForPrompt,
  type CharacterOperation,
  type StoredCharacter,
} from '@/core/characters';
import { ItemOperationsResponse, formatItemsForPrompt, type ItemOperation, type StoredItem } from '@/core/items';
import {
  CurrentInfoUpdateResponse,
  formatCurrentInfoForSummaryRequest,
  type CurrentInfo,
  type CurrentInfoUpdate,
} from '@/core/current-info';
import {
  LocationOperationsResponse,
  formatLocationsForPrompt,
  type LocationOperation,
  type StoredLocationWorld,
} from '@/core/locations';
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
  location_operations: LocationOperationsResponse.optional().default([]),
  current_info_update: CurrentInfoUpdateResponse.nullable().optional(),
});

const CharacterExtractionResponse = z.object({
  characters: StoredCharactersResponse,
});

export type SummaryGenerationResult = {
  summary: string;
  characters: CharacterOperation[];
  item_operations: ItemOperation[];
  location_operations: LocationOperation[];
  current_info_update?: CurrentInfoUpdate | null;
};

export type SummaryGenerationOptions = {
  characters_enabled?: boolean;
  stored_characters?: StoredCharacter[];
  items_enabled?: boolean;
  stored_items?: StoredItem[];
  locations_enabled?: boolean;
  stored_locations?: StoredLocationWorld[];
  current_info_enabled?: boolean;
  current_info?: CurrentInfo;
};

const SUMMARY_SYSTEM_PROMPT = [
  '你是 AI RPG 剧情摘要器。请把用户提供的内容压缩成一段连贯的故事摘要。',
  '',
  '必须保留的信息：推动主线或支线的关键事件和转折、角色之间关系的变化（结盟、反目、产生情感等）、角色获得或失去的重要能力/身份/物品、战斗或冲突的结果、角色做出的重要选择和承诺、伏笔和悬念、场景转换。',
  '',
  '可以省略的信息：气氛渲染和环境描写的细节、日常闲聊和无实质推进的寒暄、重复出现的战斗动作描写、纯粹的心理独白（除非揭示了重要决心或秘密）、已经被后续剧情覆盖的过渡内容。',
  '',
  '输出必须是流畅的叙述段落，不要使用分类标签或清单格式，不要续写剧情，不要加入原文没有的信息。',
].join('\n');

const SUMMARY_JSON_INSTRUCTION =
  '请总结以下剧情内容，只返回 JSON。格式：{"summary":"连贯的剧情摘要"}。不要使用 Markdown 代码块，不要返回额外解释。';

const CHARACTER_EXTRACTION_INSTRUCTION = [
  '同时提取本楼层明确新增、更新或删除的人物信息，返回 characters 数组。',
  '',
  '主要角色判定：与主角有持续互动的角色——同伴、对手、恋人、导师、重要敌人等。主要角色的档案必须尽可能完整：',
  '- background：身份地位、种族民族、职业或阶级、家庭关系、重要经历和动机，尽量用2-3句话概括。',
  '- appearance：身高体型、发色发型、瞳色肤色、面部特征、标志性穿着或配饰、显著伤痕或纹身等体貌特征，要求具体可视化，不要用“漂亮”“帅气”等模糊形容。',
  '- personality：核心性格特质、说话方式或口癖、行为习惯、价值观、明显的情感倾向，用具体描述代替笼统标签。',
  '',
  '次要角色判定：会多次出现但不推动主线的 NPC，如酒馆老板、公会看板娘、商店店主、村民头领等。只需保存姓名或身份称呼和一句话简介。',
  '',
  '不应记录的人物：一次性路人、无名杂兵、临时遭遇的野兽/怪物（除非是有名字的BOSS）、背景描写中提到但未实际出场的人物、仅在对话中被提及但未登场的角色。',
  '',
  '只返回本楼层带来的变化。当已有人物获得了新的重要信息（如揭露了过去、外貌有新描写、展现了新的性格面）时，用 set 操作补充更新对应字段，将新信息与已有信息合并成完整描述，不要只返回增量片段。不要重复返回没有变化的已有人物。',
].join('\n');

const ITEM_EXTRACTION_INSTRUCTION = [
  '同时提取本楼层明确新增、更新或删除的重要物品信息，返回 item_operations 数组。',
  '',
  '应该记录的物品：武器和防具（含名字和特殊属性）、魔法道具和消耗品、任务关键物品（钥匙、信件、地图、契约）、有剧情意义的礼物或信物、货币大额变动（如获得大量金币、失去全部财产）。',
  '',
  '不应记录的物品：随手可得的普通消耗品（普通食物、水、火把等）、无名称无特殊属性的杂物、纯描写用的环境物品（桌上的杯子、路边的石头）、已经使用完毕且不再有后续影响的一次性物品。',
  '',
  '物品被使用、损坏、交出、消耗或状态改变时要及时用 set 更新简介；物品彻底失去剧情意义或不再持有时可用 delete 删除。只返回本楼层带来的变化，不要重复返回没有变化的已有物品。',
].join('\n');

const LOCATION_EXTRACTION_INSTRUCTION = [
  '同时提取本楼层明确新增、更新或删除的可重复使用地点信息，返回 location_operations 数组。地点结构固定为世界/大陆级-国家/地区级-城市/城镇级-场景/建筑级-房间/具体地点级；顶部可以有多个世界/大陆。',
  '',
  '应该记录的地点：角色的住所或据点、反复前往的场所（酒馆、公会、学校、教堂、市场）、任务目的地、有重要事件发生过的地点、地下城/迷宫的已探索区域。',
  '',
  '不应记录的地点：路途中一闪而过的荒野或森林（除非是反复前往的）、纯过场描写的走廊或小路、没有任何互动的背景地点、已经被摧毁且不再有剧情价值的废墟。',
  '',
  '每级地点的简介应包含该地点的功能、氛围、归属、重要设施和已发生的关键事实。只返回本楼层带来的变化，不要重复返回没有变化的已有地点。',
].join('\n');

const CURRENT_INFO_EXTRACTION_INSTRUCTION = [
  '同时维护当前信息，返回 current_info_update。当前信息包括：时间、地点、角色列表。角色列表必须用角色名作为 key，value 记录角色服装和角色状态；角色状态应包含当前动作、姿势、身体状况（受伤、疲劳等）和情绪状态。',
  '',
  '时间格式要求（必须严格遵守）：',
  '- 时间必须精确到分钟，禁止使用"剧情开始后不久""不知多久之后""傍晚时分"等模糊描述。',
  '- 现实背景剧情：使用完整公历格式，例如"2026年6月20日 21:16"或"2026-06-20 21:16"。',
  '- 架空/奇幻/科幻背景：使用符合世界观的历法格式，必须包含年份、月份、日期和时刻，例如"银历3年 霜月·月望日 申时二刻（约21:16）"或"星盟历452年 第7月 第20日 第三更（约21:00）"。若世界观没有明确历法，可用通用格式如"第X年 X月X日 XX时XX分"，但同样必须具体到分钟量级。',
  '- elapsed_time（消耗时间）同样须具体，例如"约15分钟""3小时20分""半天（约6小时）"，禁止使用"一会儿""不知多久"。',
  '',
  '若已有当前信息为空，请根据本楼层剧情内容生成符合背景的当前信息；若已有当前信息不为空，请根据本楼层结束后的状态更新，并在 elapsed_time 中记录本楼层消耗的时间。若本楼层时间没有明确变化，则保持 current_time 原值，elapsed_time 填"约0分钟"。',
  '',
  '只记录当前场景中实际在场的角色；已经离场的角色应从列表中移除。',
].join('\n');

const CURRENT_INFO_JSON_FIELD_INSTRUCTION =
  '"current_info_update":{"current_time":"本楼层结束后的当前故事时间，必须精确到分钟；现实背景如\\"2026年6月20日 21:16\\"，架空背景如\\"银历3年 霜月·月望日 申时二刻（约21:16）\\"","location":"本楼层结束后的当前地点","characters":{"角色名":{"clothing":"角色当前服装，没有则为空字符串","status":"角色当前状态，包含动作、姿势等，没有则为空字符串"}},"elapsed_time":"本楼层消耗的剧情时间，必须具体，如\\"约15分钟\\"或\\"3小时20分\\"，没有变化则填\\"约0分钟\\"","reason":"更新当前信息的依据，没有则为空字符串"}';

const FULL_CHARACTER_EXTRACTION_SYSTEM_PROMPT = [
  '你是剧情人物档案整理器。请阅读用户提供的所有 AI 回复原文，整理剧情中需要长期记忆的人物信息。',
  '',
  '主要角色是与主角有持续互动的角色——同伴、对手、恋人、导师、重要敌人等。主要角色的档案必须尽可能完整：background 应包含身份地位、种族、职业、家庭关系和重要经历；appearance 应包含身高体型、发色发型、瞳色肤色、面部特征、标志性穿着等具体可视化描写；personality 应包含核心性格特质、说话方式、行为习惯和价值观。',
  '',
  '次要角色是会多次出现但不推动主线的 NPC，只需保存姓名或身份称呼和一句话简介。',
  '',
  '不要记录一次性路人、无名杂兵、临时敌人、仅在对话中被提及但未实际登场的角色。不要续写剧情，不要加入原文没有的信息。从原文的具体描写中提取信息，不要用“漂亮”“帅气”等模糊形容代替原文的具体描述。',
].join('\n');

const FULL_CHARACTER_JSON_INSTRUCTION =
  '请从以下剧情记录中整理所有需要保存的人物，只返回 JSON。格式：{"characters":[{"type":"primary|secondary","name":"姓名或身份","background":"主要角色背景：身份地位、种族、职业、家庭关系、重要经历，没有则为空字符串","appearance":"主要角色外貌：身高体型、发色发型、瞳色肤色、面部特征、标志性穿着，没有则为空字符串","personality":"主要角色性格：核心特质、说话方式、行为习惯、价值观，没有则为空字符串","brief":"次要角色简介，没有则为空字符串"}]}。不要使用 Markdown 代码块，不要返回额外解释。';

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
      location_operations: [],
    };
  }

  const result = parsePrettified(SummaryWithMemoryResponse, parsed);
  return {
    summary: result.summary,
    characters: options.characters_enabled ? result.characters : [],
    item_operations: options.items_enabled ? result.item_operations : [],
    location_operations: options.locations_enabled ? result.location_operations : [],
    current_info_update: options.current_info_enabled ? (result.current_info_update ?? null) : null,
  };
}

function hasMemoryExtraction(options: SummaryGenerationOptions): boolean {
  return (
    options.characters_enabled === true ||
    options.items_enabled === true ||
    options.locations_enabled === true ||
    options.current_info_enabled === true
  );
}

function buildSummaryContent(content: string, options: SummaryGenerationOptions): string {
  if (!hasMemoryExtraction(options)) {
    return content;
  }

  const memory_sections = [
    options.current_info_enabled ? formatCurrentInfoForSummaryRequest(options.current_info) : '',
    options.locations_enabled ? formatLocationsForPrompt(options.stored_locations ?? []) : '',
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

  if (options.locations_enabled) {
    instructions.push(LOCATION_EXTRACTION_INSTRUCTION);
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
  if (options.locations_enabled) {
    fields.push(
      '"location_operations":[{"type":"add|set|delete","world":"世界或大陆名","world_brief":"世界/大陆简介，没有则为空字符串","country":"国家或地区名，没有则为空字符串","country_brief":"国家简介，没有则为空字符串","city":"城市或城镇名，没有则为空字符串","city_brief":"城市简介，没有则为空字符串","scene":"场景或建筑名，没有则为空字符串","scene_brief":"场景简介，没有则为空字符串","room":"房间或具体地点名，没有则为空字符串","room_brief":"房间简介，没有则为空字符串"}]',
    );
  }
  if (options.characters_enabled) {
    fields.push(
      '"characters":[{"type":"add|set|delete","character_type":"primary|secondary","name":"姓名或身份","background":"主要角色背景：身份地位、种族、职业、家庭关系、重要经历，没有则为空字符串","appearance":"主要角色外貌：身高体型、发色发型、瞳色肤色、面部特征、标志性穿着，没有则为空字符串","personality":"主要角色性格：核心特质、说话方式、行为习惯、价值观，没有则为空字符串","brief":"次要角色简介，没有则为空字符串"}]',
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
          description:
            '本楼层结束后的当前故事时间，必须精确到分钟。现实背景使用公历格式，例如"2026年6月20日 21:16"；架空背景使用符合世界观的历法，例如"银历3年 霜月·月望日 申时二刻（约21:16）"。禁止使用"不久""傍晚时分"等模糊描述。',
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
          description:
            '本楼层消耗的剧情时间，必须具体，例如"约15分钟""3小时20分""半天（约6小时）"。禁止使用"一会儿""不知多久"等模糊描述。若本楼层没有时间流逝，填"约0分钟"。',
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

  if (options.locations_enabled) {
    properties.location_operations = {
      type: 'array',
      description: '本楼层带来的可重复使用地点信息变更；没有变化时返回空数组',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['add', 'set', 'delete'],
            description: '地点操作类型',
          },
          world: {
            type: 'string',
            description: '世界/大陆名；地点记录的顶层名称',
          },
          world_brief: {
            type: 'string',
            description: '世界/大陆简介；无变化或不适用时返回空字符串',
          },
          country: {
            type: 'string',
            description: '国家/地区名；没有则返回空字符串',
          },
          country_brief: {
            type: 'string',
            description: '国家/地区简介；无变化或不适用时返回空字符串',
          },
          city: {
            type: 'string',
            description: '城市/城镇名；没有明确城市时返回空字符串',
          },
          city_brief: {
            type: 'string',
            description: '城市/城镇简介；无变化或不适用时返回空字符串',
          },
          scene: {
            type: 'string',
            description: '场景/建筑名，例如学校、酒馆、公会、角色的家；没有则返回空字符串',
          },
          scene_brief: {
            type: 'string',
            description: '场景/建筑简介；无变化或不适用时返回空字符串',
          },
          room: {
            type: 'string',
            description: '房间/具体地点名；没有明确房间时返回空字符串',
          },
          room_brief: {
            type: 'string',
            description: '房间/具体地点简介；无变化或不适用时返回空字符串',
          },
        },
        required: [
          'type',
          'world',
          'world_brief',
          'country',
          'country_brief',
          'city',
          'city_brief',
          'scene',
          'scene_brief',
          'room',
          'room_brief',
        ],
        additionalProperties: false,
      },
    };
    required.push('location_operations');
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
            description: '主要角色背景介绍：身份地位、种族、职业、家庭关系、重要经历；不适用或无变化时返回空字符串',
          },
          appearance: {
            type: 'string',
            description:
              '主要角色外貌描写：身高体型、发色发型、瞳色肤色、面部特征、标志性穿着等具体可视化特征；不适用或无变化时返回空字符串',
          },
          personality: {
            type: 'string',
            description:
              '主要角色性格描写：核心性格特质、说话方式或口癖、行为习惯、价值观；不适用或无变化时返回空字符串',
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
                description: '主要角色背景介绍：身份地位、种族、职业、家庭关系、重要经历；不适用或无资料时返回空字符串',
              },
              appearance: {
                type: 'string',
                description:
                  '主要角色外貌描写：身高体型、发色发型、瞳色肤色、面部特征、标志性穿着等具体可视化特征；不适用或无资料时返回空字符串',
              },
              personality: {
                type: 'string',
                description:
                  '主要角色性格描写：核心性格特质、说话方式或口癖、行为习惯、价值观；不适用或无资料时返回空字符串',
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
    locations_enabled: options.locations_enabled === true,
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
