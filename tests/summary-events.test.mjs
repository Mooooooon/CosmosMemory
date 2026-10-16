/* eslint-disable import-x/no-nodejs-modules -- 在 Node 中模拟酒馆事件顺序 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';

function harness() {
  const handlers = new Map();
  const timers = new Map();
  const calls = [];
  const errors = [];
  const messages = new Map([[2, '<think>思考过程</think>最终剧情']]);
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
    summarizeReceivedMessage: async message_id => {
      calls.push({ message_id, content: messages.get(message_id) });
      return null;
    },
  };
  const imports = {
    '@sillytavern/script': { eventSource, event_types: new Proxy({}, { get: (_, key) => key }) },
    '@/core/summary': summary,
    '@/store/settings': { useSettingsStore: () => ({ settings: { filter: {} } }) },
    '@/type/settings': { isOpeningMessageCompressionEnabled: () => false },
    '@/core/message-flags': { isCosmosMemoryMessage: () => false },
    '@/core/filter': {
      evaluateMessageFilter: async () => ({ filtered: false }),
      resetFilterRetryCount: noop,
      setGenerationActive: noop,
      setupGlobalErrorInterceptors: noop,
      cancelPendingAutoRetry: noop,
    },
    '@/core/locations': { migrateStoredLocationsIfNeeded: () => false },
    '@/core/status-bar': { initStatusBar: noop, triggerUpdateStatusBar: noop },
    '@/core/vector-recall': { triggerVectorSyncDebounced: noop, cancelVectorSyncForChatChange: noop },
    '@/core/summary-rollup': { stopSummaryRollupTask: noop },
    '@/core/memory-edit': { resetMemoryEditForChatChange: noop },
    '@/core/compression': {},
    '@/core/runtime-memory': {},
  };
  const context = createContext({
    console: { info: noop, error: noop },
    window: { TavernHelper: {} },
    t: parts => parts.join(''),
    Error,
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
