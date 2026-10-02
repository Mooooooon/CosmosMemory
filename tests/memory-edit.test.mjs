/* eslint-disable import-x/no-nodejs-modules -- 在 Node 中运行真实存储、请求构造和校验的回归测试 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as ts from 'typescript';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));
const pathParts = path => (Array.isArray(path) ? path : path.split('.'));
const lodash = {
  get(object, path, fallback) {
    const value = pathParts(path).reduce((current, key) => current?.[key], object);
    return value === undefined ? fallback : value;
  },
  set(object, path, value) {
    const keys = pathParts(path);
    const last = keys.pop();
    const parent = keys.reduce((current, key) => (current[key] ??= {}), object);
    parent[last] = value;
    return object;
  },
  unset(object, path) {
    const keys = pathParts(path);
    const last = keys.pop();
    const parent = keys.reduce((current, key) => current?.[key], object);
    if (parent) delete parent[last];
  },
  has: (object, path) => lodash.get(object, path) !== undefined,
  isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  isEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
};

function harness(responder) {
  const state = {
    chat_id: 'chat-a',
    variables: { other_extension: { keep: true } },
    fail_write: 0,
    writes: 0,
    refreshes: 0,
    last_message_id: 100,
    messages: new Map(
      Array.from({ length: 102 }, (_, message_id) => [
        message_id,
        {
          message_id,
          swipe_id: 0,
          swipes: [`剧情 ${message_id}`, `另一分支 ${message_id}`],
          role: 'assistant',
          name: '角色',
          data: {},
          is_hidden: false,
        },
      ]),
    ),
  };
  const calls = [];
  const stopped = [];
  const context = createContext({
    z,
    _: lodash,
    klona: value => structuredClone(value),
    crypto: webcrypto,
    ref: value => ({ value }),
    t: parts => parts.join(''),
    Error,
    DOMException,
    console: { info() {}, warn() {}, error() {} },
    toastr: { info() {} },
    setTimeout: callback => callback(),
    window: {
      TavernHelper: {
        getVariables: () => structuredClone(state.variables),
        updateVariablesWith: updater => {
          if (++state.writes === state.fail_write) throw new Error('storage failed');
          state.variables = structuredClone(updater(structuredClone(state.variables)));
        },
        getLastMessageId: () => state.last_message_id,
        getChatMessages: (range, options = {}) => {
          const messages = typeof range === 'number' ? [state.messages.get(range)] : [...state.messages.values()];
          return messages
            .filter(message => message && message.message_id <= state.last_message_id)
            .map(message =>
              options.include_swipes
                ? structuredClone(message)
                : { ...message, message: message.swipes[message.swipe_id] },
            );
        },
        generateRaw: async config => {
          calls.push(config);
          return responder(config, state);
        },
        stopGenerationById: id => stopped.push(id),
      },
    },
  });
  const modules = new Map();
  function load(id) {
    if (id === '@sillytavern/script')
      return { getCurrentChatId: () => state.chat_id, event_types: {}, eventSource: {} };
    if (id === '@sillytavern/scripts/utils')
      return { getStringHash: value => [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0) };
    if (id === '@/core/status-bar') return { triggerUpdateStatusBar: () => state.refreshes++ };
    if (id === '@/core/filter') return { evaluateMessageFilter: async () => ({ filtered: false }) };
    if (id === '@/store/settings') return { useSettingsStore: () => ({ settings: state.settings }) };
    assert.ok(id.startsWith('@/'), `Unexpected import: ${id}`);
    const filename = resolve(root, 'src', `${id.slice(2)}.ts`);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    modules.set(filename, exports);
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInContext(`(function(require, exports) { ${outputText}\n})`, context, { filename })(load, exports);
    return exports;
  }
  const settings = load('@/type/settings').Settings.parse({});
  state.settings = settings;
  return {
    state,
    calls,
    stopped,
    load,
    core: load('@/core/memory-edit'),
    settings,
  };
}

function result(patch = {}) {
  return {
    explanation: '修改说明',
    character_operations: [],
    item_operations: [],
    location_operations: [],
    setting_change_operations: [],
    current_info: null,
    instructions: null,
    ...patch,
  };
}

test('严格校验：空结果、非法操作、不完整快照和空事实均拒绝，代码块 JSON 可读取', () => {
  const { parseMemoryEditResult: parse } = harness(() => '').load('@/api/memory-edit');
  for (const value of [
    '',
    '{}',
    'not JSON',
    JSON.stringify(result({ current_info: { current_time: '12:00' } })),
    JSON.stringify(result({ location_operations: [{ type: 'erase', world: '地球' }] })),
    JSON.stringify(result({ setting_change_operations: [{ type: 'set', key: '林秋/境界', content: '' }] })),
  ]) {
    assert.throws(() => parse(value));
  }
  assert.equal(parse('```json\n' + JSON.stringify(result()) + '\n```').explanation, '修改说明');
});

function summary80() {
  return {
    message_id: 80,
    swipe_id: 0,
    summary: '80楼剧情',
    updated_at: '2026-10-02T00:00:00.000Z',
    character_operations: [
      { type: 'add', character_type: 'primary', name: '林秋', background: '学生', personality: '活泼' },
    ],
    item_operations: [{ type: 'add', name: '钥匙', brief: '旧钥匙' }],
    location_operations: [{ type: 'add', world: '地球', city: '青城', scene: '家', room: '旧房间' }],
    setting_change_operations: [{ type: 'set', key: '林秋/境界', content: '林秋处于初阶' }],
    current_info_update: {
      current_time: '10:00',
      location: '家',
      characters: { 林秋: { clothing: '长袍', status: '休息' } },
    },
    current_scene: '平静的画面',
  };
}

function seedSummary(h, summary = summary80()) {
  h.state.variables.cosmos_memory ??= {};
  h.state.variables.cosmos_memory.summaries ??= {};
  h.state.variables.cosmos_memory.summaries[summary.message_id] = summary;
  h.load('@/core/summary').refreshMemoryForCurrentChat();
}

test('100楼的所有修改在回到80楼时撤销：包含规则和没有摘要的修改楼层', async () => {
  const h = harness(() =>
    JSON.stringify(
      result({
        character_operations: [{ type: 'set', character_type: 'primary', name: '林秋', personality: '沉稳' }],
        item_operations: [
          { type: 'delete', name: '钥匙' },
          { type: 'add', name: '剑', brief: '新剑' },
        ],
        location_operations: [
          { type: 'delete', world: '地球', city: '青城', scene: '家', room: '旧房间' },
          { type: 'add', world: '地球', city: '青城', scene: '家', room: '新房间' },
        ],
        setting_change_operations: [{ type: 'set', key: '林秋/境界', content: '林秋突破高阶' }],
        current_info: {
          current_time: '12:00',
          location: '新房间',
          characters: { 林秋: { clothing: '铠甲', status: '战斗' } },
        },
        instructions: [{ key: 'tracking', content: '持续跟踪林秋境界' }],
      }),
    ),
  );
  h.state.last_message_id = 50;
  h.load('@/core/memory-instructions').saveMemoryInstructions([{ key: 'time', content: '使用24小时制' }]);
  h.state.last_message_id = 100;
  seedSummary(h);
  await h.core.generateMemoryEdit('修改所有记忆', h.settings);
  h.core.applyMemoryEditPreview();
  h.load('@/core/current-scene').manualSaveCurrentScene('战斗的画面');
  assert.equal(h.state.variables.cosmos_memory.current_info.current_time, '12:00');
  assert.equal(h.state.variables.cosmos_memory.instructions[0].key, 'tracking');
  h.state.last_message_id = 80;
  // 100楼没有摘要；仍需回滚修改日志，不能依赖 removed_summaries 非空。
  assert.equal(h.load('@/core/summary').rollbackSummariesFromMessage(81).length, 0);
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '活泼');
  assert.equal(h.load('@/core/items').getStoredItems()[0].name, '钥匙');
  const locations = h.load('@/core/locations').formatLocationsForPrompt();
  assert.match(locations, /旧房间/);
  assert.doesNotMatch(locations, /新房间/);
  assert.equal(h.load('@/core/setting-changes').getSettingChanges()[0].content, '林秋处于初阶');
  assert.equal(h.state.variables.cosmos_memory.current_info.current_time, '10:00');
  assert.equal(h.state.variables.cosmos_memory.current_info.characters.林秋.status, '休息');
  assert.equal(h.state.variables.cosmos_memory.current_scene, '平静的画面');
  assert.equal(h.state.variables.cosmos_memory.instructions[0].key, 'time');
  assert.equal(h.state.variables.cosmos_memory.instructions_manual_ops.length, 1);
  // 删除后再次使用100楼编号，不会让旧修改复活。
  h.state.last_message_id = 100;
  h.load('@/core/summary').refreshMemoryForCurrentChat();
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '活泼');
});

test('修改与 swipe 绑定：切换停用，切回恢复，清空规则也能恢复此前版本', async () => {
  const h = harness(() =>
    JSON.stringify(
      result({
        character_operations: [{ type: 'set', character_type: 'primary', name: '林秋', personality: '沉稳' }],
        instructions: [{ key: 'tracking', content: '持续跟踪林秋境界' }],
      }),
    ),
  );
  seedSummary(h);
  await h.core.generateMemoryEdit('修改角色及规则', h.settings);
  h.core.applyMemoryEditPreview();
  const summary = h.load('@/core/summary');
  h.state.messages.get(100).swipe_id = 1;
  summary.refreshMemoryForCurrentChat();
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '活泼');
  assert.equal(h.state.variables.cosmos_memory.instructions.length, 0);
  h.load('@/core/memory-instructions').saveMemoryInstructions([]);
  h.state.messages.get(100).swipe_id = 0;
  summary.refreshMemoryForCurrentChat();
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '沉稳');
  assert.equal(h.state.variables.cosmos_memory.instructions[0].key, 'tracking');
  assert.equal(h.state.variables.cosmos_memory.instructions_manual_ops.length, 2);
});

test('显式回溯到80楼，即使100楼尚未物理删除，也不保留100楼修改', async () => {
  const h = harness(() => JSON.stringify(result({
    character_operations: [{ type: 'set', character_type: 'primary', name: '林秋', personality: '沉稳' }],
    instructions: [{ key: 'tracking', content: '持续跟踪林秋境界' }],
  })));
  seedSummary(h);
  await h.core.generateMemoryEdit('修改角色', h.settings);
  h.core.applyMemoryEditPreview();
  h.load('@/core/summary').pruneMessageSummariesAfterMessage(80);
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '活泼');
  assert.equal(h.state.variables.cosmos_memory.instructions.length, 0);
});

test('101楼自动变化接管100楼修改，回到100楼恢复修改，重生成前暂时停用', async () => {
  const h = harness(() =>
    JSON.stringify(
      result({
        character_operations: [{ type: 'set', character_type: 'primary', name: '林秋', personality: '沉稳' }],
        setting_change_operations: [{ type: 'set', key: '林秋/境界', content: '林秋突破高阶' }],
        instructions: [{ key: 'tracking', content: '持续跟踪林秋境界' }],
      }),
    ),
  );
  seedSummary(h);
  await h.core.generateMemoryEdit('修改角色', h.settings);
  h.core.applyMemoryEditPreview();
  h.state.last_message_id = 101;
  seedSummary(h, {
    message_id: 101,
    summary: '101楼剧情',
    updated_at: '2026-10-02T00:01:00.000Z',
    character_operations: [{ type: 'set', character_type: 'primary', name: '林秋', personality: '冷静' }],
    setting_change_operations: [{ type: 'set', key: '林秋/境界', content: '林秋突破宗师' }],
  });
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '冷静');
  assert.equal(h.load('@/core/setting-changes').getSettingChanges()[0].content, '林秋突破宗师');
  h.state.last_message_id = 100;
  h.load('@/core/summary').rollbackSummariesFromMessage(101);
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '沉稳');
  assert.equal(h.load('@/core/setting-changes').getSettingChanges()[0].content, '林秋突破高阶');
  h.load('@/core/summary').rollbackSummariesFromMessage(100, { purge_swipe_cache: false });
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '活泼');
  assert.equal(h.state.variables.cosmos_memory.instructions.length, 0);
  // 旧分支日志保留，生成完切回该分支时可恢复。
  h.load('@/core/summary').refreshMemoryForCurrentChat();
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '沉稳');
});

test('预览绑定楼层，聊天新增楼层或原楼层内容变化时拒绝应用', async () => {
  for (const change_floor of [true, false]) {
    const h = harness(() => JSON.stringify(result({ instructions: [{ key: 'time', content: '使用24小时制' }] })));
    await h.core.generateMemoryEdit('改时间格式', h.settings);
    if (change_floor) h.state.last_message_id = 101;
    else h.state.messages.get(100).swipes[0] = '重写后的剧情';
    assert.throws(() => h.core.applyMemoryEditPreview(), /已变化/);
    assert.equal(h.state.writes, 0);
  }
});

test('整个人物表重新生成也绑定楼层，回溯时恢复之前的人物', () => {
  const h = harness(() => '');
  seedSummary(h);
  h.load('@/core/characters').replaceStoredCharacters([{ type: 'secondary', name: '新人', brief: '新角色' }]);
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].name, '新人');
  h.load('@/core/summary').refreshMemoryForCurrentChat();
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].name, '新人');
  h.state.last_message_id = 80;
  h.load('@/core/summary').rollbackSummariesFromMessage(81);
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].name, '林秋');
});

test('补全80楼摘要只读更早的记忆，不泄漏100楼修改，不改写当前快照', async () => {
  let checked = false;
  const h = harness(config => {
    if (config.json_schema?.name === 'cosmos_memory_edit')
      return JSON.stringify(
        result({
          character_operations: [{ type: 'set', character_type: 'primary', name: '林秋', personality: '未来性格' }],
          item_operations: [{ type: 'add', name: '未来物品', brief: '未来获得' }],
          location_operations: [{ type: 'add', world: '未来世界', world_brief: '未来探索' }],
          setting_change_operations: [{ type: 'set', key: '林秋/境界', content: '未来境界' }],
          current_info: { current_time: '未来时间', location: '未来地点', characters: {} },
          instructions: [{ key: 'future', content: '未来规则' }],
        }),
      );
    const prompt = JSON.stringify(config.ordered_prompts);
    assert.doesNotMatch(prompt, /未来/);
    assert.match(prompt, /活泼/);
    assert.match(prompt, /旧钥匙/);
    assert.match(prompt, /初阶/);
    assert.match(prompt, /10:00/);
    assert.deepEqual(h.state.variables, before);
    checked = true;
    return JSON.stringify({ summary: '80楼总结' });
  });
  seedSummary(h, { ...summary80(), message_id: 70 });
  await h.core.generateMemoryEdit('修改未来的记忆', h.settings);
  h.core.applyMemoryEditPreview();
  for (const key of ['characters', 'items', 'locations', 'setting_changes', 'current_info'])
    h.settings[key].enabled = true;
  const before = structuredClone(h.state.variables);
  await h.load('@/core/summary').summarizeReceivedMessage(80);
  assert.equal(checked, true);
  assert.equal(h.load('@/core/characters').getStoredCharacters()[0].personality, '未来性格');
  assert.equal(h.state.variables.cosmos_memory.current_info.current_time, '未来时间');
});

test('更改楼层原文使该分支的修改失效；空聊天不能生成未绑定的修改', async () => {
  const h = harness(() => JSON.stringify(result({ instructions: [{ key: 'time', content: '使用24小时制' }] })));
  await h.core.generateMemoryEdit('修改格式', h.settings);
  h.core.applyMemoryEditPreview();
  h.state.messages.get(100).swipes[0] = '改写后的楼层';
  h.load('@/core/summary').refreshMemoryForCurrentChat();
  assert.equal(h.state.variables.cosmos_memory.instructions.length, 0);
  assert.equal(h.state.variables.cosmos_memory.instructions_manual_ops.length, 0);
  h.state.last_message_id = -1;
  await assert.rejects(h.core.generateMemoryEdit('修改格式', h.settings), /没有可绑定/);
});

test('时间格式与追踪规则：预览不写入，应用后传给后续总结，同时保留其他字段', async () => {
  const h = harness(() =>
    JSON.stringify(
      result({
        current_info: {
          current_time: '2026-10-02 12:00',
          location: '书房',
          characters: { 林秋: { clothing: '长袍', status: '读书' } },
        },
        instructions: [
          { key: 'time-format', content: '时间使用 YYYY-MM-DD HH:mm' },
          { key: '林秋/境界', content: '持续记录林秋的境界变化' },
        ],
      }),
    ),
  );
  await h.core.generateMemoryEdit('修改时间格式并追踪林秋境界', h.settings);
  assert.equal(h.state.writes, 0);
  assert.ok(h.calls[0].json_schema);
  assert.deepEqual(Object.keys(h.calls[0].json_schema.value.properties), Object.keys(result()));
  h.core.applyMemoryEditPreview();
  assert.equal(h.state.variables.cosmos_memory.current_info.location, '书房');
  assert.equal(h.state.variables.cosmos_memory.instructions.length, 2);
  assert.equal(h.state.variables.other_extension.keep, true);
  const rules = h.load('@/core/memory-instructions').getMemoryInstructions();
  // 替换下一次响应，通过实际总结 API 检查规则注入和时间字段协议。
  await assert.rejects(
    h.load('@/api/ai').summarizeMessage({ ...h.settings.ai, retry_enabled: false }, '剧情', {
      current_info_enabled: true,
      memory_instructions: rules,
    }),
  );
  const summary_request = h.calls.at(-1);
  assert.match(summary_request.ordered_prompts[0].content, /持续记录林秋的境界变化/);
  assert.match(summary_request.ordered_prompts[1].content, /遵循系统提示词中用户指定的时间格式/);
  assert.match(
    summary_request.json_schema.value.properties.current_info_update.properties.current_time.description,
    /用户指定/,
  );
});

test('地点删除只作用于指定房间，角色修改在摘要重建后保留', async () => {
  const h = harness(() =>
    JSON.stringify(
      result({
        location_operations: [{ type: 'delete', world: '地球', city: '青城', scene: '家', room: '厨房' }],
        character_operations: [{ type: 'set', character_type: 'primary', name: '林秋', personality: '沉稳' }],
      }),
    ),
  );
  const locations = h.load('@/core/locations');
  locations.applyLocationOperations([
    { type: 'add', world: '地球', city: '青城', scene: '家', room: '厨房', room_brief: '厨房' },
    { type: 'add', world: '地球', city: '青城', scene: '家', room: '书房', room_brief: '书房' },
  ]);
  const characters = h.load('@/core/characters');
  characters.applyCharacterOperations([
    {
      type: 'add',
      character_type: 'primary',
      name: '林秋',
      background: '学生',
      appearance: '黑发',
      personality: '活泼',
    },
  ]);
  await h.core.generateMemoryEdit('删除厨房，林秋性格改成沉稳', h.settings);
  h.core.applyMemoryEditPreview();
  const text = locations.formatLocationsForPrompt();
  assert.doesNotMatch(text, /厨房/);
  assert.match(text, /书房/);
  characters.rebuildStoredCharactersFromSummaries([
    {
      message_id: 80,
      character_operations: [
        { type: 'add', character_type: 'primary', name: '林秋', background: '学生', personality: '活泼' },
      ],
    },
  ]);
  assert.equal(characters.getStoredCharacters()[0].personality, '沉稳');
  assert.equal(characters.getStoredCharacters()[0].background, '学生');
});

test('切换聊天、停止请求和并发请求：丢弃结果，不污染新聊天', async () => {
  let finish;
  const h = harness(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const task = h.core.generateMemoryEdit('改时间', h.settings);
  await assert.rejects(h.core.generateMemoryEdit('重复请求', h.settings), /正在进行/);
  h.state.chat_id = 'chat-b';
  h.core.resetMemoryEditForChatChange();
  finish(JSON.stringify(result({ instructions: [{ key: 'time', content: '使用24小时制' }] })));
  assert.equal(await task, false);
  assert.equal(h.core.memory_edit_preview.value, null);
  assert.equal(h.stopped.length, 1);
  assert.equal(h.state.writes, 0);
});

test('预览后数据变化拒绝应用；应用失败恢复原数据和手动日志', async () => {
  const h = harness(() => JSON.stringify(result({ item_operations: [{ type: 'add', name: '剑', brief: '长剑' }] })));
  await h.core.generateMemoryEdit('新增剑', h.settings);
  h.state.variables.cosmos_memory = { current_info: { current_time: '12:00' } };
  assert.throws(() => h.core.applyMemoryEditPreview(), /已变化/);
  await h.core.generateMemoryEdit('新增剑', h.settings);
  const before = structuredClone(h.state.variables);
  h.state.fail_write = h.state.writes + 2;
  assert.throws(() => h.core.applyMemoryEditPreview(), /storage failed/);
  assert.deepEqual(h.state.variables, before);
});

test('AI 格式失败时重试使用 JSON 提示，取消规则的空列表可保存', async () => {
  let count = 0;
  const h = harness(() => (++count === 1 ? 'invalid' : JSON.stringify(result({ instructions: [] }))));
  await h.core.generateMemoryEdit('清空记忆整理规则', h.settings);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[0].json_schema);
  assert.equal(h.calls[1].json_schema, undefined);
  h.core.applyMemoryEditPreview();
  assert.deepEqual(h.state.variables.cosmos_memory.instructions, []);
});

test('单独停止请求后不接受返回结果；请求中记忆变化不创建过期预览', async () => {
  for (const cancel of [true, false]) {
    let finish;
    const h = harness(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const task = h.core.generateMemoryEdit('修改记忆', h.settings);
    if (cancel) h.core.stopMemoryEdit();
    else h.state.variables.cosmos_memory = { instructions: [] };
    finish(JSON.stringify(result({ item_operations: [{ type: 'add', name: '剑', brief: '长剑' }] })));
    if (cancel) assert.equal(await task, false);
    else await assert.rejects(task, /已变化/);
    assert.equal(h.core.memory_edit_preview.value, null);
    assert.equal(h.state.writes, 0);
    assert.equal(h.core.is_editing_memory.value, false);
  }
});
