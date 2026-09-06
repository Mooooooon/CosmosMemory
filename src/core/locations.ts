import {
  defineEntityStore,
  normalizeEntityKey,
  normalizeText,
  STORAGE_ROOT,
  type EntityMeta,
} from '@/core/entity-store';

const LOCATION_STORAGE_PATH = `${STORAGE_ROOT}.locations`;
const LOCATION_STORAGE_VERSION_PATH = `${STORAGE_ROOT}.locations_storage_version`;
const LOCATION_STORAGE_VERSION = 2;
/**
 * 存储模型是固定五级树，但现实设定不一定包含每一级（例如架空城市可能没有国家）。
 * 缺失的中间层使用仅供内部寻址的虚拟节点承接；节点 name 保持为空，展示和注入时跳过该层。
 */
const IMPLICIT_LOCATION_KEY = '__cosmos_memory_implicit__';
export const LOCATION_PROMPT_ID = 'cosmos_memory_locations';
export const LOCATION_PROMPT_DEPTH = 10001;

export type LocationOperationType = 'add' | 'set' | 'delete';

export type LocationOperation = {
  type: LocationOperationType;
  world: string;
  world_brief?: string;
  country?: string;
  country_brief?: string;
  city?: string;
  city_brief?: string;
  scene?: string;
  scene_brief?: string;
  room?: string;
  room_brief?: string;
};

export type StoredLocationRoom = {
  name: string;
  brief: string;
};

export type StoredLocationScene = {
  name: string;
  brief: string;
  rooms: Record<string, StoredLocationRoom>;
};

export type StoredLocationCity = {
  name: string;
  brief: string;
  scenes: Record<string, StoredLocationScene>;
};

export type StoredLocationCountry = {
  name: string;
  brief: string;
  cities: Record<string, StoredLocationCity>;
};

export type StoredLocationWorld = {
  name: string;
  brief: string;
  countries: Record<string, StoredLocationCountry>;
  /** 最后影响该世界（含其下级地点）的摘要楼层；旧版本数据为 undefined */
  source_message_id?: number;
  /** 最后影响该世界（含其下级地点）的摘要生成时间 */
  updated_at?: string;
};

type SummaryWithLocationOperations = {
  message_id?: number;
  updated_at?: string;
  location_operations?: LocationOperation[];
};

export const LocationOperationResponse = z.object({
  type: z.enum(['add', 'set', 'delete']),
  world: z.string().trim().min(1),
  world_brief: z.string().trim().optional().default(''),
  country: z.string().trim().optional().default(''),
  country_brief: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default(''),
  city_brief: z.string().trim().optional().default(''),
  scene: z.string().trim().optional().default(''),
  scene_brief: z.string().trim().optional().default(''),
  room: z.string().trim().optional().default(''),
  room_brief: z.string().trim().optional().default(''),
});

export const LocationOperationsResponse = z.array(LocationOperationResponse).default([]);

function normalizeLocationKey(name: string): string {
  return normalizeEntityKey(name);
}

function isStoredLocationRoom(value: unknown): value is StoredLocationRoom {
  return (
    _.isPlainObject(value) &&
    typeof (value as Partial<StoredLocationRoom>).name === 'string' &&
    typeof (value as Partial<StoredLocationRoom>).brief === 'string'
  );
}

function isStoredLocationScene(value: unknown): value is StoredLocationScene {
  return (
    _.isPlainObject(value) &&
    typeof (value as Partial<StoredLocationScene>).name === 'string' &&
    typeof (value as Partial<StoredLocationScene>).brief === 'string' &&
    _.isPlainObject((value as Partial<StoredLocationScene>).rooms) &&
    Object.values((value as StoredLocationScene).rooms).every(isStoredLocationRoom)
  );
}

function isStoredLocationCity(value: unknown): value is StoredLocationCity {
  return (
    _.isPlainObject(value) &&
    typeof (value as Partial<StoredLocationCity>).name === 'string' &&
    typeof (value as Partial<StoredLocationCity>).brief === 'string' &&
    _.isPlainObject((value as Partial<StoredLocationCity>).scenes) &&
    Object.values((value as StoredLocationCity).scenes).every(isStoredLocationScene)
  );
}

function isStoredLocationCountry(value: unknown): value is StoredLocationCountry {
  return (
    _.isPlainObject(value) &&
    typeof (value as Partial<StoredLocationCountry>).name === 'string' &&
    typeof (value as Partial<StoredLocationCountry>).brief === 'string' &&
    _.isPlainObject((value as Partial<StoredLocationCountry>).cities) &&
    Object.values((value as StoredLocationCountry).cities).every(isStoredLocationCity)
  );
}

function isStoredLocationWorld(value: unknown): value is StoredLocationWorld {
  return (
    _.isPlainObject(value) &&
    typeof (value as Partial<StoredLocationWorld>).name === 'string' &&
    typeof (value as Partial<StoredLocationWorld>).brief === 'string' &&
    _.isPlainObject((value as Partial<StoredLocationWorld>).countries) &&
    Object.values((value as StoredLocationWorld).countries).every(isStoredLocationCountry)
  );
}

function getOrCreateWorld(locations: Record<string, StoredLocationWorld>, world_name: string): StoredLocationWorld {
  const world_key = normalizeLocationKey(world_name);
  const existing = locations[world_key];
  if (existing) {
    return existing;
  }

  const world: StoredLocationWorld = {
    name: world_name,
    brief: '',
    countries: {},
  };
  locations[world_key] = world;
  return world;
}

function getOrCreateCountry(world: StoredLocationWorld, country_name: string): StoredLocationCountry {
  const country_key = country_name ? normalizeLocationKey(country_name) : IMPLICIT_LOCATION_KEY;
  const existing = world.countries[country_key];
  if (existing) {
    return existing;
  }

  const country: StoredLocationCountry = {
    name: country_name,
    brief: '',
    cities: {},
  };
  world.countries[country_key] = country;
  return country;
}

function getOrCreateCity(country: StoredLocationCountry, city_name: string): StoredLocationCity {
  const city_key = city_name ? normalizeLocationKey(city_name) : IMPLICIT_LOCATION_KEY;
  const existing = country.cities[city_key];
  if (existing) {
    return existing;
  }

  const city: StoredLocationCity = {
    name: city_name,
    brief: '',
    scenes: {},
  };
  country.cities[city_key] = city;
  return city;
}

function getOrCreateScene(city: StoredLocationCity, scene_name: string): StoredLocationScene {
  const scene_key = scene_name ? normalizeLocationKey(scene_name) : IMPLICIT_LOCATION_KEY;
  const existing = city.scenes[scene_key];
  if (existing) {
    return existing;
  }

  const scene: StoredLocationScene = {
    name: scene_name,
    brief: '',
    rooms: {},
  };
  city.scenes[scene_key] = scene;
  return scene;
}

function mergeLocationOperation(
  locations: Record<string, StoredLocationWorld>,
  operation: LocationOperation,
): Record<string, StoredLocationWorld> {
  const world_name = normalizeText(operation.world);
  const country_name = normalizeText(operation.country);
  const city_name = normalizeText(operation.city);
  const scene_name = normalizeText(operation.scene);
  const room_name = normalizeText(operation.room);
  const world_key = normalizeLocationKey(world_name);

  if (!world_key) {
    return locations;
  }

  if (operation.type === 'delete') {
    const has_country_level = Boolean(country_name || city_name || scene_name || room_name);
    const has_city_level = Boolean(city_name || scene_name || room_name);
    const has_scene_level = Boolean(scene_name || room_name);
    const country_key = country_name ? normalizeLocationKey(country_name) : IMPLICIT_LOCATION_KEY;
    const city_key = city_name ? normalizeLocationKey(city_name) : IMPLICIT_LOCATION_KEY;
    const scene_key = scene_name ? normalizeLocationKey(scene_name) : IMPLICIT_LOCATION_KEY;

    if (room_name && has_scene_level && has_city_level && has_country_level) {
      _.unset(locations, [
        world_key,
        'countries',
        country_key,
        'cities',
        city_key,
        'scenes',
        scene_key,
        'rooms',
        normalizeLocationKey(room_name),
      ]);
      return locations;
    }
    if (scene_name && has_city_level && has_country_level) {
      _.unset(locations, [world_key, 'countries', country_key, 'cities', city_key, 'scenes', scene_key]);
      return locations;
    }
    if (city_name && has_country_level) {
      _.unset(locations, [world_key, 'countries', country_key, 'cities', city_key]);
      return locations;
    }
    if (country_name) {
      _.unset(locations, [world_key, 'countries', normalizeLocationKey(country_name)]);
      return locations;
    }

    _.unset(locations, world_key);
    return locations;
  }

  const world = getOrCreateWorld(locations, world_name);
  const world_brief = normalizeText(operation.world_brief);
  if (world_brief) {
    world.brief = world_brief;
  }

  // 允许跳过缺失的中间层，但不能在没有任何下级信息时凭空创建虚拟节点。
  if (!country_name && !city_name && !scene_name && !room_name) {
    return locations;
  }

  const country = getOrCreateCountry(world, country_name);
  const country_brief = normalizeText(operation.country_brief);
  if (country_brief) {
    country.brief = country_brief;
  }

  if (!city_name && !scene_name && !room_name) {
    return locations;
  }

  const city = getOrCreateCity(country, city_name);
  const city_brief = normalizeText(operation.city_brief);
  if (city_brief) {
    city.brief = city_brief;
  }

  if (!scene_name && !room_name) {
    return locations;
  }

  const scene = getOrCreateScene(city, scene_name);
  const scene_brief = normalizeText(operation.scene_brief);
  if (scene_brief) {
    scene.brief = scene_brief;
  }

  if (!room_name) {
    return locations;
  }

  const room_key = normalizeLocationKey(room_name);
  const room_brief = normalizeText(operation.room_brief);
  scene.rooms[room_key] = {
    name: room_name,
    brief: room_brief || scene.rooms[room_key]?.brief || '',
  };
  return locations;
}

const locationStore = defineEntityStore<StoredLocationWorld, LocationOperation, SummaryWithLocationOperations>({
  storagePath: LOCATION_STORAGE_PATH,
  entityName: '地点',
  isValidEntity: isStoredLocationWorld,
  getEntityKey: world => normalizeLocationKey(world.name),
  // 元数据记录在世界级实体上：一条地点操作可能触及世界下的任意层级，
  // 以世界为粒度记录来源楼层，足以支撑后续按楼层检索和级联失效
  applyOperation: (record, operation) => {
    const world_key = normalizeLocationKey(normalizeText(operation.world));
    mergeLocationOperation(record, operation);
    return world_key ? [world_key] : [];
  },
  sortEntities: (left, right) => left.name.localeCompare(right.name),
  getSummaryOperations: summary => summary.location_operations,
  getSummaryMeta: summary => ({ source_message_id: summary.message_id, updated_at: summary.updated_at }),
});

export function getStoredLocations(): StoredLocationWorld[] {
  return locationStore.getAll();
}

export function applyLocationOperations(operations: LocationOperation[], meta: EntityMeta = {}): StoredLocationWorld[] {
  return locationStore.applyOperations(operations, meta);
}

export function rebuildStoredLocationsFromSummaries(summaries: SummaryWithLocationOperations[]): StoredLocationWorld[] {
  return locationStore.rebuildFromSummaries(summaries);
}

/**
 * v2 开始允许省略任意中间层。旧合并逻辑遇到空的中间层会提前返回，
 * 因此需要从已经保存的摘要操作重放一次，补回此前被丢弃的下级地点。
 */
export function migrateStoredLocationsIfNeeded(summaries: SummaryWithLocationOperations[]): boolean {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  if (_.get(variables, LOCATION_STORAGE_VERSION_PATH) === LOCATION_STORAGE_VERSION) {
    return false;
  }

  locationStore.rebuildFromSummaries(summaries);
  window.TavernHelper.updateVariablesWith(
    current_variables => {
      _.set(current_variables, LOCATION_STORAGE_VERSION_PATH, LOCATION_STORAGE_VERSION);
      return current_variables;
    },
    { type: 'chat' },
  );
  return true;
}

/**
 * 手动应用一条地点操作（编辑各层级 brief 或删除节点）。
 * LocationOperation 本身支持任意层级的 set/delete，直接复用；
 * 操作进入手动日志，rebuild 时重放，用户修正不被回滚冲掉。
 */
export function manualApplyLocationOperation(operation: LocationOperation): StoredLocationWorld[] {
  return locationStore.applyManualOperation(operation);
}

export function formatLocationsForPrompt(locations: StoredLocationWorld[] = getStoredLocations()): string {
  if (locations.length === 0) {
    return '';
  }

  const lines = [
    '[CosmosMemory 地点信息]',
    '以下是已经记录的可重复使用地点设定。后续剧情涉及同名地点时，优先沿用这些世界/大陆、国家、城市、场景和房间信息。',
  ];

  for (const world of locations) {
    lines.push(`- 世界/大陆：${world.name}`);
    if (world.brief) {
      lines.push(`  简介：${world.brief}`);
    }

    for (const country of Object.values(world.countries).sort((left, right) => left.name.localeCompare(right.name))) {
      const country_depth = 1;
      if (country.name) {
        lines.push(`${'  '.repeat(country_depth)}- 国家/地区：${country.name}`);
      }
      if (country.brief) {
        lines.push(`${'  '.repeat(country_depth + 1)}简介：${country.brief}`);
      }

      for (const city of Object.values(country.cities).sort((left, right) => left.name.localeCompare(right.name))) {
        const city_depth = country.name ? country_depth + 1 : country_depth;
        if (city.name) {
          lines.push(`${'  '.repeat(city_depth)}- 城市/城镇：${city.name}`);
        }
        if (city.brief) {
          lines.push(`${'  '.repeat(city_depth + 1)}简介：${city.brief}`);
        }

        for (const scene of Object.values(city.scenes).sort((left, right) => left.name.localeCompare(right.name))) {
          const scene_depth = city.name ? city_depth + 1 : city_depth;
          if (scene.name) {
            lines.push(`${'  '.repeat(scene_depth)}- 场景/建筑：${scene.name}`);
          }
          if (scene.brief) {
            lines.push(`${'  '.repeat(scene_depth + 1)}简介：${scene.brief}`);
          }

          for (const room of Object.values(scene.rooms).sort((left, right) => left.name.localeCompare(right.name))) {
            const room_depth = scene.name ? scene_depth + 1 : scene_depth;
            lines.push(`${'  '.repeat(room_depth)}- 房间/具体地点：${room.name}`);
            if (room.brief) {
              lines.push(`${'  '.repeat(room_depth + 1)}简介：${room.brief}`);
            }
          }
        }
      }
    }
  }

  lines.push('[/CosmosMemory 地点信息]');
  return lines.join('\n');
}
