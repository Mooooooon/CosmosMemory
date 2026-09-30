/* eslint-disable import-x/no-nodejs-modules */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { z } from 'zod';

function loadSource(path, globals = {}, imports = {}) {
  const filename = fileURLToPath(new URL(`../src/${path}.ts`, import.meta.url));
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const context = createContext({ z, console: { info() {} }, ...globals });
  const exports = {};
  runInContext(`(function(require, exports) { ${outputText}\n})`, context, { filename })(id => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}

const { CompressionSettings, isOpeningMessageCompressionEnabled } = loadSource('type/settings');

test('CompressionSettings Schema：支持 include_opening_message 默认值与校验', () => {
  const default_settings = CompressionSettings.parse({});
  assert.equal(default_settings.enabled, true);
  assert.equal(default_settings.retained_original_assistant_messages, 5);
  assert.equal(default_settings.include_opening_message, false);

  const custom_settings = CompressionSettings.parse({ include_opening_message: true });
  assert.equal(custom_settings.include_opening_message, true);
});

test('isOpeningMessageCompressionEnabled：正确检测 compression 与 summary 设置', () => {
  assert.equal(isOpeningMessageCompressionEnabled({}), false);
  assert.equal(
    isOpeningMessageCompressionEnabled({
      compression: { include_opening_message: false },
      summary: { include_opening_message_original: false },
    }),
    false,
  );
  assert.equal(
    isOpeningMessageCompressionEnabled({
      compression: { include_opening_message: true },
      summary: { include_opening_message_original: false },
    }),
    true,
  );
  assert.equal(
    isOpeningMessageCompressionEnabled({
      compression: { include_opening_message: false },
      summary: { include_opening_message_original: true },
    }),
    true,
  );
  assert.equal(
    isOpeningMessageCompressionEnabled({
      compression: { include_opening_message: true },
      summary: { include_opening_message_original: true },
    }),
    true,
  );
});

test('实际压缩调用：开场白隐藏、恢复后不重复注入，并保留手动隐藏楼层的摘要', async () => {
  const settings = {
    compression: { retained_original_assistant_messages: 0, include_opening_message: true },
    summary: { include_opening_message_original: false },
  };
  const messages = [0, 2, 4].map(message_id => ({ message_id, is_hidden: message_id === 4, data: {} }));
  const summaries = messages.map(({ message_id }) => ({ message_id, summary: `summary-${message_id}` }));
  const injections = [];
  const removed = [];
  const { applySummaryCompressionForNextGeneration } = loadSource('core/compression', {
    _: {
      cloneDeep: value => structuredClone(value),
      set: (value, key, data) => { value[key] = data; },
      unset: (value, key) => { delete value[key]; },
    },
    window: { TavernHelper: {
      // 返回副本，模拟 setChatMessages 不会更新之前读取对象的真实行为。
      getChatMessages: () => structuredClone(messages),
      getLastMessageId: () => 4,
      setChatMessages: async updates => {
        for (const update of updates) Object.assign(messages.find(m => m.message_id === update.message_id), update);
      },
      injectPrompts: prompts => injections.push(prompts),
      uninjectPrompts: ids => removed.push(...ids),
    } },
  }, {
    '@/core/message-flags': {
      HIDDEN_BY_COMPRESSION_PATH: 'compressed',
      isCosmosMemoryMessage: () => false,
      isHiddenByCompression: message => message.data.compressed === true,
    },
    '@/core/summary-rollup': { getValidSummaryRollups: () => [] },
    '@/core/summary': { OPENING_MESSAGE_ID: 0, getStoredMessageSummaries: () => summaries },
    '@/store/settings': { useSettingsStore: () => ({ settings }) },
    '@/type/settings': { isOpeningMessageCompressionEnabled },
  });

  const ids = value => Array.from(value);
  const enabled = await applySummaryCompressionForNextGeneration();
  assert.deepEqual(ids(enabled.hidden_message_ids), [0, 2]);
  assert.deepEqual(ids(enabled.injected_summary_ids), [0, 2, 4]);

  settings.compression.include_opening_message = false;
  const disabled = await applySummaryCompressionForNextGeneration();
  assert.deepEqual(ids(disabled.restored_message_ids), [0]);
  assert.deepEqual(ids(disabled.injected_summary_ids), [2, 4]);
  assert.equal(messages[0].is_hidden, false);
  assert.equal(injections.at(-1)[0].content.includes('summary-0'), false);

  const restored = await applySummaryCompressionForNextGeneration(false);
  assert.deepEqual(ids(restored.restored_message_ids), [2]);
  assert.deepEqual(ids(restored.injected_summary_ids), [4]);
  assert.equal(messages[2].is_hidden, true);
  assert.deepEqual(removed, ['cosmos_memory_summary', 'cosmos_memory_summary']);
});

test('压缩楼层过滤：当包括开场白未开启时，开场白不参与压缩隐藏', () => {
  const OPENING_MESSAGE_ID = 0;
  const assistant_messages = [
    { message_id: 0, role: 'assistant', is_hidden: false },
    { message_id: 2, role: 'assistant', is_hidden: false },
    { message_id: 4, role: 'assistant', is_hidden: false },
    { message_id: 6, role: 'assistant', is_hidden: false },
    { message_id: 8, role: 'assistant', is_hidden: false },
    { message_id: 10, role: 'assistant', is_hidden: false },
    { message_id: 12, role: 'assistant', is_hidden: false },
  ];
  const retained_count = 5;
  const allow_opening = false;

  const candidates = allow_opening
    ? assistant_messages
    : assistant_messages.filter(m => m.message_id !== OPENING_MESSAGE_ID);

  const compressible = retained_count === 0 ? candidates : candidates.slice(0, -retained_count);

  // candidates: [2, 4, 6, 8, 10, 12] (6 条)
  // slice(0, -5): [2]
  assert.equal(compressible.length, 1);
  assert.equal(compressible[0].message_id, 2);
  assert.equal(compressible.some(m => m.message_id === 0), false);
});

test('压缩楼层过滤：当包括开场白开启时，开场白参与压缩隐藏', () => {
  const OPENING_MESSAGE_ID = 0;
  const assistant_messages = [
    { message_id: 0, role: 'assistant', is_hidden: false },
    { message_id: 2, role: 'assistant', is_hidden: false },
    { message_id: 4, role: 'assistant', is_hidden: false },
    { message_id: 6, role: 'assistant', is_hidden: false },
    { message_id: 8, role: 'assistant', is_hidden: false },
    { message_id: 10, role: 'assistant', is_hidden: false },
    { message_id: 12, role: 'assistant', is_hidden: false },
  ];
  const retained_count = 5;
  const allow_opening = true;

  const candidates = allow_opening
    ? assistant_messages
    : assistant_messages.filter(m => m.message_id !== OPENING_MESSAGE_ID);

  const compressible = retained_count === 0 ? candidates : candidates.slice(0, -retained_count);

  // candidates: [0, 2, 4, 6, 8, 10, 12] (7 条)
  // slice(0, -5): [0, 2]
  assert.equal(compressible.length, 2);
  assert.equal(compressible[0].message_id, 0);
  assert.equal(compressible[1].message_id, 2);
});

test('缺失补全检查：当包括开场白开启时，楼层 0 计入缺失总结候选', () => {
  const OPENING_MESSAGE_ID = 0;
  const stored_summary_ids = new Set([2]);
  const existing_messages = [
    { message_id: 0, role: 'assistant' },
    { message_id: 1, role: 'user' },
    { message_id: 2, role: 'assistant' },
    { message_id: 3, role: 'user' },
    { message_id: 4, role: 'assistant' },
  ];

  // 1. allow_opening = false
  const allow_opening_false = false;
  const candidates_disabled = existing_messages.filter(
    m =>
      (allow_opening_false || m.message_id !== OPENING_MESSAGE_ID) &&
      m.role === 'assistant' &&
      !stored_summary_ids.has(m.message_id),
  );
  assert.deepEqual(candidates_disabled.map(m => m.message_id), [4]);

  // 2. allow_opening = true
  const allow_opening_true = true;
  const candidates_enabled = existing_messages.filter(
    m =>
      (allow_opening_true || m.message_id !== OPENING_MESSAGE_ID) &&
      m.role === 'assistant' &&
      !stored_summary_ids.has(m.message_id),
  );
  assert.deepEqual(candidates_enabled.map(m => m.message_id), [0, 4]);
});

test('无效总结清理：当包括开场白开启时，开场白摘要不会被视为无效而清除', () => {
  const OPENING_MESSAGE_ID = 0;
  const existing_assistant_ids = new Set([0, 2, 4]);
  const max_message_id = 4;
  const summaries = [
    { message_id: 0, summary: '开场白摘要' },
    { message_id: 2, summary: '楼层2摘要' },
    { message_id: 4, summary: '楼层4摘要' },
  ];

  // allow_opening = false: 楼层 0 被移除
  const allow_opening_false = false;
  const removed_when_disabled = summaries.filter(
    s =>
      (!allow_opening_false && s.message_id === OPENING_MESSAGE_ID) ||
      s.message_id > max_message_id ||
      !existing_assistant_ids.has(s.message_id),
  );
  assert.deepEqual(removed_when_disabled.map(s => s.message_id), [0]);

  // allow_opening = true: 楼层 0 保留
  const allow_opening_true = true;
  const removed_when_enabled = summaries.filter(
    s =>
      (!allow_opening_true && s.message_id === OPENING_MESSAGE_ID) ||
      s.message_id > max_message_id ||
      !existing_assistant_ids.has(s.message_id),
  );
  assert.deepEqual(removed_when_enabled.map(s => s.message_id), []);
});
