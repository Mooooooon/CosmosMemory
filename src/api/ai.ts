import type { AiSettings } from '@/type/settings';
import { parsePrettified } from '@/util/zod';

const TEST_MESSAGE = '!ping';
const DEFAULT_CUSTOM_API_SOURCE = 'openai';
const DEEPSEEK_API_SOURCE = 'deepseek';
const SUMMARY_MAX_TOKENS = 1024;

type CustomApi = NonNullable<GenerateConfig['custom_api']>;

const SummaryResponse = z.object({
  summary: z.string().trim().min(1),
});

const SUMMARY_SYSTEM_PROMPT =
  '你是剧情摘要器。请把用户提供的内容压缩成一段连贯的故事摘要，只保留已发生的剧情事实、角色行动、状态与关系变化。输出必须是流畅的叙述段落，不要使用分类标签或清单格式，不要续写剧情，不要加入原文没有的信息。';

const SUMMARY_JSON_INSTRUCTION =
  '请总结以下剧情内容，只返回 JSON。格式：{"summary":"连贯的剧情摘要"}。不要使用 Markdown 代码块，不要返回额外解释。';

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

function parseSummaryJson(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const json_text = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return parsePrettified(SummaryResponse, JSON.parse(json_text)).summary;
}

async function summarizeMessageWithStructuredOutput(settings: AiSettings, content: string): Promise<string> {
  const custom_source = settings.use_tavern_api ? undefined : inferCustomApiSource(settings);
  console.info('[CosmosMemory] 使用结构化输出请求剧情总结', {
    custom_source,
    mode: custom_source === DEEPSEEK_API_SOURCE ? 'deepseek_json_object_via_st' : 'json_schema',
  });

  const result = await window.TavernHelper.generateRaw({
    should_silence: true,
    custom_api: buildCustomApi(settings),
    ordered_prompts: [
      {
        role: 'system',
        content: SUMMARY_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `请总结以下剧情内容：\n\n${content}`,
      },
    ],
    json_schema: {
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
    },
  });

  if (typeof result !== 'string') {
    throw new Error('总结请求返回了非文本结果。');
  }

  return parseSummaryJson(result);
}

async function summarizeMessageWithJsonPrompt(settings: AiSettings, content: string): Promise<string> {
  const result = await window.TavernHelper.generateRaw({
    should_silence: true,
    custom_api: buildCustomApi(settings),
    ordered_prompts: [
      {
        role: 'system',
        content: SUMMARY_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `${SUMMARY_JSON_INSTRUCTION}\n\n${content}`,
      },
    ],
  });

  if (typeof result !== 'string') {
    throw new Error('总结请求返回了非文本结果。');
  }

  return parseSummaryJson(result);
}

export async function summarizeMessage(settings: AiSettings, content: string): Promise<string> {
  try {
    return await summarizeMessageWithStructuredOutput(settings, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[CosmosMemory] 结构化输出总结请求失败，降级为普通 JSON 提示重试', { message });
    return summarizeMessageWithJsonPrompt(settings, content);
  }
}
