const STORAGE_ROOT = 'cosmos_memory';
const LOCATION_STORAGE_PATH = `${STORAGE_ROOT}.locations`;
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
};

type SummaryWithLocationOperations = {
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

let location_prompt_injected = false;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLocationKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
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

function getStoredLocationRecord(): Record<string, StoredLocationWorld> {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const locations = _.get(variables, LOCATION_STORAGE_PATH, {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(locations).filter((entry): entry is [string, StoredLocationWorld] => {
      const [key, location] = entry;
      return Boolean(key) && isStoredLocationWorld(location);
    }),
  );
}

export function getStoredLocations(): StoredLocationWorld[] {
  return Object.values(getStoredLocationRecord()).sort((left, right) => left.name.localeCompare(right.name));
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
  const country_key = normalizeLocationKey(country_name);
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
  const city_key = normalizeLocationKey(city_name);
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
  const scene_key = normalizeLocationKey(scene_name);
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
    if (room_name && scene_name && city_name && country_name) {
      _.unset(locations, [
        world_key,
        'countries',
        normalizeLocationKey(country_name),
        'cities',
        normalizeLocationKey(city_name),
        'scenes',
        normalizeLocationKey(scene_name),
        'rooms',
        normalizeLocationKey(room_name),
      ]);
      return locations;
    }
    if (scene_name && city_name && country_name) {
      _.unset(locations, [
        world_key,
        'countries',
        normalizeLocationKey(country_name),
        'cities',
        normalizeLocationKey(city_name),
        'scenes',
        normalizeLocationKey(scene_name),
      ]);
      return locations;
    }
    if (city_name && country_name) {
      _.unset(locations, [
        world_key,
        'countries',
        normalizeLocationKey(country_name),
        'cities',
        normalizeLocationKey(city_name),
      ]);
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

  if (!country_name) {
    return locations;
  }

  const country = getOrCreateCountry(world, country_name);
  const country_brief = normalizeText(operation.country_brief);
  if (country_brief) {
    country.brief = country_brief;
  }

  if (!city_name) {
    return locations;
  }

  const city = getOrCreateCity(country, city_name);
  const city_brief = normalizeText(operation.city_brief);
  if (city_brief) {
    city.brief = city_brief;
  }

  if (!scene_name) {
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

export function applyLocationOperations(operations: LocationOperation[]): StoredLocationWorld[] {
  const locations = getStoredLocationRecord();
  for (const operation of operations) {
    mergeLocationOperation(locations, operation);
  }

  saveLocationRecord(locations);
  return getStoredLocations();
}

export function rebuildStoredLocationsFromSummaries(summaries: SummaryWithLocationOperations[]): StoredLocationWorld[] {
  const locations: Record<string, StoredLocationWorld> = {};
  for (const summary of summaries) {
    for (const operation of summary.location_operations ?? []) {
      mergeLocationOperation(locations, operation);
    }
  }

  saveLocationRecord(locations);
  return Object.values(locations).sort((left, right) => left.name.localeCompare(right.name));
}

function saveLocationRecord(locations: Record<string, StoredLocationWorld>) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      _.set(variables, LOCATION_STORAGE_PATH, locations);
      return variables;
    },
    { type: 'chat' },
  );
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
      lines.push(`  - 国家/地区：${country.name}`);
      if (country.brief) {
        lines.push(`    简介：${country.brief}`);
      }

      for (const city of Object.values(country.cities).sort((left, right) => left.name.localeCompare(right.name))) {
        lines.push(`    - 城市/城镇：${city.name}`);
        if (city.brief) {
          lines.push(`      简介：${city.brief}`);
        }

        for (const scene of Object.values(city.scenes).sort((left, right) => left.name.localeCompare(right.name))) {
          lines.push(`      - 场景/建筑：${scene.name}`);
          if (scene.brief) {
            lines.push(`        简介：${scene.brief}`);
          }

          for (const room of Object.values(scene.rooms).sort((left, right) => left.name.localeCompare(right.name))) {
            lines.push(`        - 房间/具体地点：${room.name}`);
            if (room.brief) {
              lines.push(`          简介：${room.brief}`);
            }
          }
        }
      }
    }
  }

  lines.push('[/CosmosMemory 地点信息]');
  return lines.join('\n');
}

function clearChatLocationPrompt() {
  if (!location_prompt_injected) {
    return;
  }

  window.TavernHelper.uninjectPrompts([LOCATION_PROMPT_ID]);
  location_prompt_injected = false;
}

export function applyLocationPromptInjection(enabled: boolean): boolean {
  clearChatLocationPrompt();

  if (!enabled) {
    return false;
  }

  const content = formatLocationsForPrompt();
  if (!content) {
    return false;
  }

  window.TavernHelper.injectPrompts(
    [
      {
        id: LOCATION_PROMPT_ID,
        position: 'in_chat',
        depth: LOCATION_PROMPT_DEPTH,
        role: 'system',
        content,
      },
    ],
    { once: true },
  );
  location_prompt_injected = true;
  return true;
}
