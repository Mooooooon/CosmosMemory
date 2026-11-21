/* eslint-disable import-x/no-nodejs-modules -- 在 Node 中模拟酒馆事件顺序 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { reactive, watch } from 'vue';

function harness() {
  const handlers = new Map();
  const timers = new Map();
  const calls = [];
  const prompts = new Set();
  const errors = [];
  const excluded = new Set();
  const messages = new Map([[2, '<think>思考过程</think>最终剧情']]);
  const settings = reactive({ enabled: true, summary_paused: false, filter: {}, summary: { resummarize_on_edit: false }, compression: { enabled: true } });
  let controller = new AbortController();
  let memory_controller = new AbortController();
  watch(() => settings.enabled, enabled => {
    if (enabled) controller = new AbortController();
    else controller.abort();
  }, { flush: 'sync' });
  watch(() => settings.enabled && !settings.summary_paused, can_generate => {
    if (can_generate) memory_controller = new AbortController();
    else memory_controller.abort();
  }, { flush: 'sync' });
  let timer_id = 0;
  const noop = () => {};
  const eventSource = {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    async emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) await handler(...args);
    },
  };
  const summary = {
    OPENING_MESSAGE_ID: 0,
    getAssistantMessage: message_id => ({ message_id, message: messages.get(message_id) }),
    getRegexedAiContent: message => message.message,
    getStoredMessageSummaries: () => [],
    refreshMemoryForCurrentChat: noop,
    rollbackSummariesFromMessage: noop,
    cancelSummarizationForChatChange: noop,
    invalidateAndResummarizeMessage: async message_id => {
      calls.push({ message_id, resummarize: true });
      return null;
    },
    summarizeReceivedMessage: async message_id => {
      calls.push({ message_id, content: messages.get(message_id) });
      return null;
    },
  };
  const filter = {
    evaluateMessageFilter: async () => ({ filtered: false }),
    resetFilterRetryCount: noop,
    setGenerationActive: noop,
    markGenerationStoppedByUser: noop,
    setupGlobalErrorInterceptors: noop,
  };
  const imports = {
    '@sillytavern/script': { eventSource, event_types: new Proxy({}, { get: (_, key) => key }) },
    '@/core/summary': summary,
    '@/store/settings': { useSettingsStore: () => ({ settings, getRunSignal: () => controller.signal, getMemoryGenerationSignal: () => memory_controller.signal }) },
    '@/type/settings': { isOpeningMessageCompressionEnabled: () => false },
    '@/core/message-flags': {
      isCosmosMemoryMessage: () => false,
      isExcludedFromMemory: message => excluded.has(message.message_id),
      excludeReplyFromMemory: message_id => excluded.add(message_id),
    },
    '@/core/filter': filter,
    '@/core/locations': { migrateStoredLocationsIfNeeded: () => false },
    '@/core/status-bar': { initStatusBar: noop, triggerUpdateStatusBar: noop },
    '@/core/vector-recall': {
      triggerVectorSyncDebounced: noop,
      cancelVectorSyncForChatChange: noop,
      applyVectorRecallForNextGeneration: () => prompts.add('recall'),
      clearVectorRecallPrompt: () => prompts.delete('recall'),
    },
    '@/core/summary-rollup': { stopSummaryRollupTask: noop },
    '@/core/memory-edit': { resetMemoryEditForChatChange: noop },
    '@/core/compression': {
      applySummaryCompressionForNextGeneration: () => prompts.add('summary'),
      clearInjectedSummaryPrompts: () => prompts.delete('summary'),
    },
    '@/core/runtime-memory': {
      applyRuntimeMemoryPromptInjection: () => prompts.add('runtime'),
      clearRuntimeMemoryPrompts: () => prompts.delete('runtime'),
    },
  };
  const context = createContext({
    console: { info: noop, error: noop },
    window: { TavernHelper: {} },
    t: parts => parts.join(''),
    Error,
    watch,
    toastr: { error: message => errors.push(message) },
    setTimeout: callback => {
      timers.set(++timer_id, callback);
      return timer_id;
    },
    clearTimeout: id => timers.delete(id),
  });
  const { outputText } = ts.transpileModule(readFileSync(new URL('../src/core/events.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInContext(`(function(require, exports) { ${outputText}\n})`, context)(id => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
    return imports[id];
  }, exports);
  exports.registerSummaryEvents();
  return {
    eventSource,
    messages,
    calls,
    errors,
    summary,
    settings,
    filter,
    prompts,
    excluded,
    async flush() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('收到回复后，等待同轮事件中的思考提取与正文更新，再自动总结最终正文', async () => {
  const h = harness();
  h.eventSource.on('MESSAGE_RECEIVED', async message_id => {
    h.messages.set(message_id, '最终剧情');
  });
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  assert.equal(h.calls.length, 0);
  await h.flush();
  assert.deepEqual(h.calls, [{ message_id: 2, content: '最终剧情' }]);
});

test('聊天切换或楼层删除时取消尚未启动的自动总结', async () => {
  for (const [event, args] of [
    ['CHAT_CHANGED', []],
    ['MESSAGE_DELETED', [2]],
  ]) {
    const h = harness();
    await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
    await h.eventSource.emit(event, ...args);
    await h.flush();
    assert.equal(h.calls.length, 0);
  }
});

test('同楼层重复回复事件只处理一次；quiet 事件不触发自动总结', async () => {
  const h = harness();
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'quiet');
  await h.flush();
  assert.equal(h.calls.length, 1);
});

test('事件预处理异常有用户提示，不留下未处理的 Promise 拒绝', async () => {
  const h = harness();
  h.summary.getAssistantMessage = () => {
    throw new Error('消息读取失败');
  };
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  await h.flush();
  assert.deepEqual(h.errors, ['消息读取失败']);
});

test('编辑事件只在开启编辑后重新总结时调用失效与重新生成逻辑', async () => {
  const h = harness();
  h.messages.set(2, '编辑后的正文');
  await h.eventSource.emit('MESSAGE_EDITED', 2);
  assert.equal(h.calls.length, 0);
  h.settings.summary.resummarize_on_edit = true;
  await h.eventSource.emit('MESSAGE_EDITED', 2);
  assert.deepEqual(h.calls, [{ message_id: 2, resummarize: true }]);
  assert.deepEqual(h.errors, []);
});

test('总开关关闭时立即撤销注入并取消排队总结，重新开启后恢复监听', async () => {
  const h = harness();
  await h.eventSource.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  assert.deepEqual([...h.prompts], ['summary', 'runtime', 'recall']);
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');

  h.settings.enabled = false;
  assert.equal(h.prompts.size, 0);
  await h.eventSource.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  await h.flush();
  assert.equal(h.prompts.size, 0);
  assert.equal(h.calls.length, 0);

  h.settings.enabled = true;
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  await h.flush();
  assert.equal(h.calls.length, 1);
});

test('快速关闭再开启时，关闭前已进入异步过滤的回复不会触发总结', async () => {
  const h = harness();
  let finish;
  h.filter.evaluateMessageFilter = () => new Promise(resolve => { finish = resolve; });
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  await h.flush();

  h.settings.enabled = false;
  h.settings.enabled = true;
  finish({ filtered: false });
  await h.flush();
  assert.equal(h.calls.length, 0);
});

test('临时关闭时保留三种注入，并在回复事件中立即标记以免恢复后自动总结', async () => {
  const h = harness();
  h.settings.summary_paused = true;
  await h.eventSource.emit('MESSAGE_SENT', 1);
  await h.eventSource.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  assert.deepEqual([...h.prompts], ['summary', 'runtime', 'recall']);
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'normal');
  assert.equal(h.excluded.has(2), true);

  h.settings.summary_paused = false;
  await h.eventSource.emit('MESSAGE_RECEIVED', 2, 'continue');
  h.messages.set(3, '恢复后收到的回复');
  await h.eventSource.emit('MESSAGE_RECEIVED', 3, 'normal');
  await h.flush();
  assert.deepEqual(h.calls, [{ message_id: 3, content: '恢复后收到的回复' }]);
  assert.deepEqual(h.errors, []);
});
