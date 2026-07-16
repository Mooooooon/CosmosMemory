<<<<<<< HEAD
export const DEFAULT_CUSTOM_API_URL = 'https://api.deepseek.com/v1';

export type AiSettings = z.infer<typeof AiSettings>;
export const AiSettings = z
  .object({
    use_tavern_api: z.boolean().default(true),
    custom_api_url: z.string().default(DEFAULT_CUSTOM_API_URL),
    custom_api_key: z.string().default(''),
    selected_model: z.string().default(''),
    available_models: z.array(z.string()).default([]),
  })
  .prefault({});

export type CompressionSettings = z.infer<typeof CompressionSettings>;
export const CompressionSettings = z
  .object({
    retained_original_assistant_messages: z.number().int().min(0).default(5),
  })
  .prefault({});

export type SummarySettings = z.infer<typeof SummarySettings>;
export const SummarySettings = z
  .object({
    send_descriptions_and_world_info: z.boolean().default(false),
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

export type Settings = z.infer<typeof Settings>;
export const Settings = z
  .object({
    ai: AiSettings,
    compression: CompressionSettings,
    summary: SummarySettings,
    characters: CharacterSettings,
    current_info: CurrentInfoSettings,
    items: ItemSettings,
    locations: LocationSettings,
    status_bar: StatusBarSettings,
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
>>>>>>> 2b4176b8715a548ab4aa9973f274370b529f0143
