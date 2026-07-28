<template>
  <dialog ref="dialog_element" class="cosmos-memory-dialog">
    <div class="cosmos-memory-dialog-header">
      <b>{{ t`当前聊天地点信息` }}</b>
      <button class="menu_button" type="button" @click="close">{{ t`关闭` }}</button>
    </div>

    <div v-if="editing" class="cosmos-memory-edit-form">
      <div class="cosmos-memory-field">
        <span>{{ t`地点` }}</span>
        <b>{{ editing.display_path }}</b>
      </div>

      <label class="cosmos-memory-field">
        <span>{{ t`简介` }}</span>
        <textarea v-model.trim="editing.brief" class="text_pole"></textarea>
      </label>

      <div class="cosmos-memory-entity-actions">
        <button class="menu_button" type="button" @click="handle_save">{{ t`保存` }}</button>
        <button class="menu_button" type="button" @click="editing = null">{{ t`取消` }}</button>
      </div>
    </div>

    <div v-if="locations.length === 0 && !editing" class="cosmos-memory-empty">
      {{ t`当前聊天记录还没有地点信息。` }}
    </div>

    <div v-else class="cosmos-memory-summary-list">
      <article
        v-for="world in locations"
        :key="world.name"
        class="cosmos-memory-summary-item cosmos-memory-location-item"
      >
        <div class="cosmos-memory-summary-meta">
          <b>{{ t`世界/大陆` }}：{{ world.name }}</b>
          <span class="cosmos-memory-inline-actions">
            <button class="menu_button" type="button" @click="handle_edit([world.name], world.brief)">
              {{ t`编辑` }}
            </button>
            <button class="menu_button" type="button" @click="handle_delete([world.name])">{{ t`删除` }}</button>
          </span>
        </div>
        <p v-if="world.brief">{{ world.brief }}</p>

        <section v-for="country in sorted_countries(world)" :key="country.name">
          <h4>
            {{ t`国家/地区` }}：{{ country.name }}
            <span class="cosmos-memory-inline-actions">
              <button class="menu_button" type="button" @click="handle_edit([world.name, country.name], country.brief)">
                {{ t`编辑` }}
              </button>
              <button class="menu_button" type="button" @click="handle_delete([world.name, country.name])">
                {{ t`删除` }}
              </button>
            </span>
          </h4>
          <p v-if="country.brief">{{ country.brief }}</p>

          <section v-for="city in sorted_cities(country)" :key="city.name">
            <h5>
              {{ t`城市/城镇` }}：{{ city.name }}
              <span class="cosmos-memory-inline-actions">
                <button
                  class="menu_button"
                  type="button"
                  @click="handle_edit([world.name, country.name, city.name], city.brief)"
                >
                  {{ t`编辑` }}
                </button>
                <button class="menu_button" type="button" @click="handle_delete([world.name, country.name, city.name])">
                  {{ t`删除` }}
                </button>
              </span>
            </h5>
            <p v-if="city.brief">{{ city.brief }}</p>

            <section v-for="scene in sorted_scenes(city)" :key="scene.name">
              <h6>
                {{ t`场景/建筑` }}：{{ scene.name }}
                <span class="cosmos-memory-inline-actions">
                  <button
                    class="menu_button"
                    type="button"
                    @click="handle_edit([world.name, country.name, city.name, scene.name], scene.brief)"
                  >
                    {{ t`编辑` }}
                  </button>
                  <button
                    class="menu_button"
                    type="button"
                    @click="handle_delete([world.name, country.name, city.name, scene.name])"
                  >
                    {{ t`删除` }}
                  </button>
                </span>
              </h6>
              <p v-if="scene.brief">{{ scene.brief }}</p>

              <dl v-if="sorted_rooms(scene).length > 0" class="cosmos-memory-location-rooms">
                <template v-for="room in sorted_rooms(scene)" :key="room.name">
                  <dt>
                    {{ t`房间/具体地点` }}：{{ room.name }}
                    <span class="cosmos-memory-inline-actions">
                      <button
                        class="menu_button"
                        type="button"
                        @click="handle_edit([world.name, country.name, city.name, scene.name, room.name], room.brief)"
                      >
                        {{ t`编辑` }}
                      </button>
                      <button
                        class="menu_button"
                        type="button"
                        @click="handle_delete([world.name, country.name, city.name, scene.name, room.name])"
                      >
                        {{ t`删除` }}
                      </button>
                    </span>
                  </dt>
                  <dd v-if="room.brief">{{ room.brief }}</dd>
                </template>
              </dl>
            </section>
          </section>
        </section>
      </article>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import {
  getStoredLocations,
  manualApplyLocationOperation,
  type LocationOperation,
  type StoredLocationCity,
  type StoredLocationCountry,
  type StoredLocationRoom,
  type StoredLocationScene,
  type StoredLocationWorld,
} from '@/core/locations';
import { triggerUpdateStatusBar } from '@/core/status-bar';

/** 地点路径：[世界, 国家?, 城市?, 场景?, 房间?]，长度即层级深度 */
type LocationPath = string[];

type EditingLocation = {
  path: LocationPath;
  display_path: string;
  brief: string;
};

const dialog_element = ref<HTMLDialogElement | null>(null);
const locations = ref<StoredLocationWorld[]>([]);
const editing = ref<EditingLocation | null>(null);

function open() {
  locations.value = getStoredLocations();
  editing.value = null;
  dialog_element.value?.showModal();
}

function close() {
  dialog_element.value?.close();
}

defineExpose({ open });

/** 把地点路径转换为 LocationOperation 的层级字段；brief 只写到目标层级 */
function buildOperation(type: 'set' | 'delete', path: LocationPath, brief?: string): LocationOperation {
  const [world, country, city, scene, room] = path;
  const operation: LocationOperation = { type, world: world ?? '' };
  if (country) {
    operation.country = country;
  }
  if (city) {
    operation.city = city;
  }
  if (scene) {
    operation.scene = scene;
  }
  if (room) {
    operation.room = room;
  }

  if (type === 'set' && brief !== undefined) {
    const brief_field = (['world_brief', 'country_brief', 'city_brief', 'scene_brief', 'room_brief'] as const)[
      path.length - 1
    ]!;
    operation[brief_field] = brief;
  }

  return operation;
}

function handle_edit(path: LocationPath, brief: string) {
  editing.value = { path, display_path: path.join(' / '), brief };
}

function handle_save() {
  const form = editing.value;
  if (!form) {
    return;
  }

  try {
    // set 语义只覆盖非空 brief；清空简介时退化为原值保留，属于已知限制
    locations.value = manualApplyLocationOperation(buildOperation('set', form.path, form.brief));
    editing.value = null;
    triggerUpdateStatusBar();
    toastr.success(t`地点信息已保存。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 保存地点失败`);
  }
}

function handle_delete(path: LocationPath) {
  const display_path = path.join(' / ');
  if (!confirm(t`确定要删除地点「{name}」及其下所有层级吗？`.replace('{name}', display_path))) {
    return;
  }

  try {
    locations.value = manualApplyLocationOperation(buildOperation('delete', path));
    triggerUpdateStatusBar();
    toastr.success(t`地点已删除。`, 'Cosmos Memory');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, t`Cosmos Memory 删除地点失败`);
  }
}

function sorted_countries(world: StoredLocationWorld): StoredLocationCountry[] {
  return Object.values(world.countries).sort((left, right) => left.name.localeCompare(right.name));
}

function sorted_cities(country: StoredLocationCountry): StoredLocationCity[] {
  return Object.values(country.cities).sort((left, right) => left.name.localeCompare(right.name));
}

function sorted_scenes(city: StoredLocationCity): StoredLocationScene[] {
  return Object.values(city.scenes).sort((left, right) => left.name.localeCompare(right.name));
}

function sorted_rooms(scene: StoredLocationScene): StoredLocationRoom[] {
  return Object.values(scene.rooms).sort((left, right) => left.name.localeCompare(right.name));
}
</script>
