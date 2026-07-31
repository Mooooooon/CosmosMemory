<<<<<<< HEAD
export const DEFAULT_CUSTOM_API_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** 自定义端点的 API 源选项；auto 表示按端点/模型名自动推断（仅识别 deepseek，其余按 openai 处理） */
export const CUSTOM_API_SOURCE_OPTIONS = [
  'auto',
  'openai',
  'deepseek',
  'claude',
  'openrouter',
  'makersuite',
  'mistralai',
  'groq',
] as const;
export type CustomApiSourceOption = (typeof CUSTOM_API_SOURCE_OPTIONS)[number];

export type AiSettings = z.infer<typeof AiSettings>;
export const AiSettings = z
  .object({
    use_tavern_api: z.boolean().default(true),
    custom_api_url: z.string().default(DEFAULT_CUSTOM_API_URL),
    custom_api_key: z.string().default(''),
    custom_api_source: z.enum(CUSTOM_API_SOURCE_OPTIONS).default('auto'),
    selected_model: z.string().default(''),
    available_models: z.array(z.string()).default([]),
    max_output_tokens: z.number().int().min(1).default(DEFAULT_MAX_OUTPUT_TOKENS),
  })
  .prefault({});

export type CompressionSettings = z.infer<typeof CompressionSettings>;
export const CompressionSettings = z
  .object({
    enabled: z.boolean().default(true),
    retained_original_assistant_messages: z.number().int().min(0).default(5),
  })
  .prefault({});

export type SummaryRollupSettings = z.infer<typeof SummaryRollupSettings>;
export const SummaryRollupSettings = z
  .object({
    enabled: z.boolean().default(false),
    /** 未合并的旧摘要达到该条数时，触发二次总结并入前情文章 */
    trigger_summary_count: z.number().int().min(2).default(30),
    /** 最近 N 条摘要不参与合并，保留逐楼细节 */
    retained_recent_summary_count: z.number().int().min(0).default(10),
  })
  .prefault({});

export type SummarySettings = z.infer<typeof SummarySettings>;
export const SummarySettings = z
  .object({
    send_descriptions_and_world_info: z.boolean().default(false),
    send_previous_message_original: z.boolean().default(false),
    include_opening_message_original: z.boolean().default(false),
    send_summary_context: z.boolean().default(false),
    summary_context_count: z.number().int().min(1).default(5),
  })
  .prefault({});

export type CharacterSettings = z.infer<typeof CharacterSettings>;
export const CharacterSettings = z
  .object({
    enabled: z.boolean().default(false),
  })
  .prefault({});

export type CurrentInfoSettings = z.infer<typeof CurrentInfoSettings>;
export const CurrentInfoSettings = z
  .object({
    enabled: z.boolean().default(false),
  })
  .prefault({});

export type SettingChangeSettings = z.infer<typeof SettingChangeSettings>;
export const SettingChangeSettings = z
  .object({
    enabled: z.boolean().default(false),
  })
  .prefault({});

export type ItemSettings = z.infer<typeof ItemSettings>;
export const ItemSettings = z
  .object({
    enabled: z.boolean().default(false),
  })
  .prefault({});

export type LocationSettings = z.infer<typeof LocationSettings>;
export const LocationSettings = z
  .object({
    enabled: z.boolean().default(false),
  })
  .prefault({});

export type StatusBarSettings = z.infer<typeof StatusBarSettings>;
export const StatusBarSettings = z
  .object({
    enabled: z.boolean().default(true),
  })
  .prefault({});

export const DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
export const DEFAULT_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';
/** 向量召回注入深度：低于运行时记忆注入（9999-10002），高于全部聊天正文 */
export const DEFAULT_VECTOR_RECALL_INJECTION_DEPTH = 9998;
export const DEFAULT_VECTOR_RECALL_MAX_CHARS = 8000;

export type VectorRecallSettings = z.infer<typeof VectorRecallSettings>;
export const VectorRecallSettings = z
  .object({
    enabled: z.boolean().default(false),
    /** SiliconFlow API Key，仅用于前端直连 embeddings 接口，禁止输出到日志 */
    api_key: z.string().default(''),
    model: z.string().default(DEFAULT_EMBEDDING_MODEL),
    available_models: z.array(z.string()).default([]),
    /** 构造查询文本使用的最近消息条数（用户与 AI 消息均计入） */
    query_recent_message_count: z.number().int().min(1).default(3),
    /** 每次生成最多召回的历史片段条数 */
    top_k: z.number().int().min(1).default(5),
    /** 相似度阈值，低于该值的检索结果不注入 */
    score_threshold: z.number().min(0).max(1).default(0.35),
    /** 最近 N 条 AI 楼层不参与召回，原文大概率仍在上下文中 */
    protect_recent_assistant_count: z.number().int().min(0).default(10),
    /** 仅召回当前处于隐藏状态的楼层，避免与上下文中的原文重复 */
    only_recall_hidden: z.boolean().default(true),
    injection_depth: z.number().int().min(0).default(DEFAULT_VECTOR_RECALL_INJECTION_DEPTH),
    /** 单楼层入库前的截断字符数，hash 按截断后文本计算以保证增量同步幂等 */
    max_chars_per_message: z.number().int().min(200).default(DEFAULT_VECTOR_RECALL_MAX_CHARS),
    /** 对向量检索候选做 rerank 精排（与 embedding 共用 API Key） */
    rerank_enabled: z.boolean().default(false),
    rerank_model: z.string().default(DEFAULT_RERANK_MODEL),
    rerank_available_models: z.array(z.string()).default([]),
    /** rerank 相关度阈值，低于该分数的候选不注入 */
    rerank_score_threshold: z.number().min(0).max(1).default(0.3),
  })
  .prefault({});

export type Settings = z.infer<typeof Settings>;
export const Settings = z
  .object({
    ai: AiSettings,
    compression: CompressionSettings,
    summary: SummarySettings,
    summary_rollup: SummaryRollupSettings,
    characters: CharacterSettings,
    current_info: CurrentInfoSettings,
    setting_changes: SettingChangeSettings,
    items: ItemSettings,
    locations: LocationSettings,
    status_bar: StatusBarSettings,
    vector_recall: VectorRecallSettings,
  })
  .prefault({});

export const setting_field = 'cosmos_memory';
=======
export type Settings = z.infer<typeof Settings>;
export const Settings = z
  .object({
    button_selected: z.boolean().default(false),
  })
  .prefault({});

export const setting_field = 'tavern_extension_example';
>>>>>>> cc8bc4cededdbc9368b632c8b27765a709111ca2
