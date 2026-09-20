/* eslint-disable import-x/no-nodejs-modules */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));

function setupFilterContext(options = {}) {
  const {
    filterSettings = {
      enabled: true,
      auto_retry: true,
      max_retries: 3,
      length_unit: 'token',
      min_length: 100,
      blocked_keywords: ['I cannot'],
    },
    lastMessageId = 5,
    toastrCalls = { info: [], warning: [], error: [] },
    slashCommands = [],
  } = options;

  const toastrObj = {
    info: (msg, title) => toastrCalls.info.push({ msg, title }),
    warning: (msg, title) => toastrCalls.warning.push({ msg, title }),
    error: (msg, title) => toastrCalls.error.push({ msg, title }),
  };

  const context = createContext({
    z,
    Error,
    DOMException,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    document: {
      querySelector: selector => {
        if (selector === '#option_regenerate' && options.mockButton) {
          return {
            click: () => {
              options.mockButtonClicked = true;
            },
          };
        }
        return null;
      },
    },
    toastr: toastrObj,
    console: {
      info() {},
      warn() {},
      error() {},
    },
    t: parts => parts.join(''),
    window: {
      toastr: toastrObj,
      addEventListener: () => {},
      TavernHelper: {
        getLastMessageId: () => lastMessageId,
        triggerSlash: async cmd => {
          slashCommands.push(cmd);
          if (options.throwSlash) {
            throw new Error('Slash error');
          }
          return '';
        },
      },
    },
  });

  const modules = new Map();
  function load(id) {
    if (id === '@sillytavern/scripts/tokenizers') {
      return { getTokenCountAsync: async text => Math.ceil(text.length / 3) };
    }
    if (id === '@/store/settings') {
      return {
        useSettingsStore: () => ({
          settings: {
            filter: filterSettings,
          },
        }),
      };
    }
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

  const settingsModule = load('@/type/settings');
  const filterModule = load('@/core/filter');

  return {
    filterModule,
    settingsModule,
    toastrCalls,
    slashCommands,
    context,
  };
}

test('FilterSettings Schema：支持 auto_retry 与 max_retries 的默认值与校验', () => {
  const { settingsModule } = setupFilterContext();
  const { FilterSettings, DEFAULT_FILTER_MAX_RETRIES } = settingsModule;

  assert.equal(DEFAULT_FILTER_MAX_RETRIES, 3);

  // 默认值
  const parsedDefault = FilterSettings.parse({});
  assert.equal(parsedDefault.enabled, true);
  assert.equal(parsedDefault.auto_retry, false);
  assert.equal(parsedDefault.max_retries, 3);

  // 自定义值
  const parsedCustom = FilterSettings.parse({
    auto_retry: true,
    max_retries: 5,
  });
  assert.equal(parsedCustom.auto_retry, true);
  assert.equal(parsedCustom.max_retries, 5);

  // 边界校验：必须在 1~20 之间
  assert.throws(() => FilterSettings.parse({ max_retries: 0 }));
  assert.throws(() => FilterSettings.parse({ max_retries: 21 }));
});

test('triggerFilterAutoRetry：当 auto_retry 未启用时跳过重试', () => {
  const { filterModule } = setupFilterContext({
    filterSettings: {
      enabled: true,
      auto_retry: false,
      max_retries: 3,
      length_unit: 'token',
      min_length: 100,
      blocked_keywords: [],
    },
  });

  const result = filterModule.triggerFilterAutoRetry(5, '回复为空');
  assert.equal(result.retried, false);
  assert.equal(filterModule.getFilterRetryCount(), 0);
});

test('triggerFilterAutoRetry：非最新楼层跳过重试', () => {
  const { filterModule } = setupFilterContext({
    lastMessageId: 10,
  });

  // 传入非最新楼层 5
  const result = filterModule.triggerFilterAutoRetry(5, '回复为空');
  assert.equal(result.retried, false);
  assert.equal(filterModule.getFilterRetryCount(), 0);
});

test('triggerFilterAutoRetry：递增重试并在超过 max_retries 时熔断并清零', () => {
  const toastrCalls = { info: [], warning: [], error: [] };
  const { filterModule } = setupFilterContext({
    lastMessageId: 5,
    toastrCalls,
    filterSettings: {
      enabled: true,
      auto_retry: true,
      max_retries: 3,
      length_unit: 'token',
      min_length: 100,
      blocked_keywords: [],
    },
  });

  filterModule.resetFilterRetryCount();

  // 第 1 次重试
  const res1 = filterModule.triggerFilterAutoRetry(5, '包含违禁词');
  assert.equal(res1.retried, true);
  assert.equal(res1.attempt, 1);
  assert.equal(filterModule.getFilterRetryCount(), 1);
  assert.equal(toastrCalls.info.length, 1);

  // 第 2 次重试
  const res2 = filterModule.triggerFilterAutoRetry(5, '包含违禁词');
  assert.equal(res2.retried, true);
  assert.equal(res2.attempt, 2);
  assert.equal(filterModule.getFilterRetryCount(), 2);
  assert.equal(toastrCalls.info.length, 2);

  // 第 3 次重试
  const res3 = filterModule.triggerFilterAutoRetry(5, '包含违禁词');
  assert.equal(res3.retried, true);
  assert.equal(res3.attempt, 3);
  assert.equal(filterModule.getFilterRetryCount(), 3);
  assert.equal(toastrCalls.info.length, 3);

  // 第 4 次：超过上限 (max_retries = 3)，熔断并停止重试
  const res4 = filterModule.triggerFilterAutoRetry(5, '包含违禁词');
  assert.equal(res4.retried, false);
  assert.equal(filterModule.getFilterRetryCount(), 0);
  assert.equal(toastrCalls.warning.length, 1);
});

test('triggerRegenerate：优先调用 TavernHelper.triggerSlash(\'/regenerate\')', async () => {
  const slashCommands = [];
  const { filterModule } = setupFilterContext({
    slashCommands,
  });

  await filterModule.triggerRegenerate();
  assert.deepEqual(slashCommands, ['/regenerate']);
});

test('triggerRegenerate：当 triggerSlash 失败时降级点击 #option_regenerate 按钮', async () => {
  const options = {
    throwSlash: true,
    mockButton: true,
    mockButtonClicked: false,
  };
  const { filterModule } = setupFilterContext(options);

  await filterModule.triggerRegenerate();
  assert.equal(options.mockButtonClicked, true);
});

test('evaluateMessageFilter：正确拦截包含 500 / Failed to load resource 等服务器报错的文本', async () => {
  const { filterModule } = setupFilterContext();
  const filterSettings = {
    enabled: true,
    auto_retry: true,
    max_retries: 3,
    length_unit: 'token',
    min_length: 0,
    blocked_keywords: [],
  };

  // 1. 经典浏览器 500 报错
  const res1 = await filterModule.evaluateMessageFilter(
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
    filterSettings,
  );
  assert.equal(res1.filtered, true);
  assert.match(res1.reason, /服务器报错/);

  // 2. 500 Internal Server Error
  const res2 = await filterModule.evaluateMessageFilter('Error: 500 Internal Server Error', filterSettings);
  assert.equal(res2.filtered, true);

  // 3. 502 Bad Gateway
  const res3 = await filterModule.evaluateMessageFilter('<html>502 Bad Gateway</html>', filterSettings);
  assert.equal(res3.filtered, true);

  // 4. 正常文本不被拦截
  const res4 = await filterModule.evaluateMessageFilter('这是正常的模型回复内容。', filterSettings);
  assert.equal(res4.filtered, false);
});

test('handleGenerationError：在生成期间发生 500 报错自动调度重试', () => {
  const toastrCalls = { info: [], warning: [], error: [] };
  const { filterModule } = setupFilterContext({
    toastrCalls,
    filterSettings: {
      enabled: true,
      auto_retry: true,
      max_retries: 2,
      length_unit: 'token',
      min_length: 0,
      blocked_keywords: [],
    },
  });

  filterModule.resetFilterRetryCount();

  // 未开始生成时发生错误 -> 不重试
  filterModule.setGenerationActive(false);
  const ignored = filterModule.handleGenerationError('Failed to load resource: the server responded with a status of 500');
  assert.equal(ignored, false);

  // 标记开始正常生成
  filterModule.setGenerationActive(true, 'normal');

  // 第 1 次 500 报错 -> 触发重试
  const retried1 = filterModule.handleGenerationError('Failed to load resource: the server responded with a status of 500 (Internal Server Error)');
  assert.equal(retried1, true);
  assert.equal(filterModule.getFilterRetryCount(), 1);
  assert.equal(toastrCalls.info.length, 1);
  assert.match(toastrCalls.info[0].msg, /500 Internal Server Error/);

  // 鉴权类错误 (401/403) -> 不重试
  filterModule.cancelPendingAutoRetry();
  const authErr = filterModule.handleGenerationError('401 Unauthorized: Invalid API Key');
  assert.equal(authErr, false);

  // 用户点击停止生成 -> 不重试
  filterModule.markGenerationStoppedByUser();
  const stoppedErr = filterModule.handleGenerationError('status of 500');
  assert.equal(stoppedErr, false);
});

test('setupGlobalErrorInterceptors：拦截 window.toastr.error 并在生成中触发重试', () => {
  const toastrCalls = { info: [], warning: [], error: [] };
  const { filterModule, context } = setupFilterContext({
    toastrCalls,
    filterSettings: {
      enabled: true,
      auto_retry: true,
      max_retries: 3,
      length_unit: 'token',
      min_length: 0,
      blocked_keywords: [],
    },
  });

  filterModule.resetFilterRetryCount();
  filterModule.setupGlobalErrorInterceptors();

  filterModule.setGenerationActive(true, 'normal');

  // 模拟酒馆弹出 500 报错
  context.toastr.error('status of 500 (Internal Server Error)', 'Chat Completion API');

  assert.equal(filterModule.getFilterRetryCount(), 1);
  assert.equal(toastrCalls.info.length, 1);
  assert.match(toastrCalls.info[0].msg, /正在自动重试 \(1\/3\)/);
});
