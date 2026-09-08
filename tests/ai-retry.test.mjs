/* eslint-disable import-x/no-nodejs-modules -- 回归测试在 Node.js 中运行 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));

// 使用实际请求构造与 Zod 校验，只替换酒馆接口、通知和计时器。
function harness(responses, settings_patch = {}) {
  const calls = [];
  const notices = [];
  const state = { cancelled: false, on_wait: () => {} };
  const context = createContext({
    z,
    Error,
    DOMException,
    console: { info() {}, warn() {} },
    t: parts => parts.join(''),
    toastr: { info: message => notices.push(message) },
    setTimeout: callback => {
      state.on_wait();
      callback();
    },
    window: {
      TavernHelper: {
        generateRaw: async config => {
          const index = calls.push(config) - 1;
          const result = responses[Math.min(index, responses.length - 1)];
          if (result instanceof Error) throw result;
          return typeof result === 'function' ? result() : result;
        },
      },
    },
  });
  const modules = new Map();
  function load(id) {
    if (id === '@sillytavern/script') return { event_types: {}, eventSource: {} };
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
  const settings = load('@/type/settings').AiSettings.parse(settings_patch);
  const api = load('@/api/ai');
  return { api, settings, calls, notices, state };
}

const generation_cases = [
  {
    name: '逐楼总结',
    run: h =>
      h.api.summarizeMessage(h.settings, '剧情', {
        generation_id: 'test-summary',
        should_cancel: () => h.state.cancelled,
      }),
    valid: '{"summary":"有效摘要"}',
    invalid: '{"summary":" "}',
  },
  {
    name: '二次总结',
    run: h =>
      h.api.rollupSummariesToArticle(h.settings, [{ message_id: 1, summary: '剧情' }], {
        generation_id: 'test-rollup',
        should_cancel: () => h.state.cancelled,
      }),
    valid: '{"article":"有效前情"}',
    invalid: '{"article":42}',
  },
  {
    name: '人物重新生成',
    run: h => h.api.extractCharactersFromChatContent(h.settings, '剧情'),
    valid: '{"characters":[]}',
    invalid: '{"characters":"错误类型"}',
  },
];

for (const entry of generation_cases) {
  test(`${entry.name}：空内容、JSON 错误和校验失败后第三次重试成功`, async () => {
    const h = harness(['', 'invalid json', entry.invalid, entry.valid]);
    await entry.run(h);
    assert.equal(h.settings.retry_enabled, true);
    assert.equal(h.settings.retry_count, 3);
    assert.equal(h.calls.length, 4);
    assert.equal(h.notices.length, 3);
    assert.ok(h.calls[0].json_schema);
    assert.ok(h.calls.slice(1).every(call => !call.json_schema));
    assert.ok(h.calls.every(call => call.generation_id === h.calls[0].generation_id));
  });

  test(`${entry.name}：关闭重试后只请求一次`, async () => {
    const h = harness([entry.invalid, entry.valid], { retry_enabled: false });
    await assert.rejects(entry.run(h));
    assert.equal(h.calls.length, 1);
    assert.equal(h.notices.length, 0);
  });

  test(`${entry.name}：连续非文本结果不会超过重试上限`, async () => {
    const h = harness([{ content: '', tool_calls: [] }]);
    await assert.rejects(entry.run(h), /非文本/);
    assert.equal(h.calls.length, 4);
  });
}

test('首次成功时不重试，网络错误可以恢复，自定义次数生效', async () => {
  const entry = generation_cases[0];
  const success = harness([entry.valid]);
  await entry.run(success);
  assert.equal(success.calls.length, 1);
  const recovered = harness([new Error('fetch failed'), entry.valid]);
  await entry.run(recovered);
  assert.equal(recovered.calls.length, 2);
  const error = new Error('timeout');
  const exhausted = harness([error], { retry_count: 2 });
  await assert.rejects(entry.run(exhausted), caught => caught === error);
  assert.equal(exhausted.calls.length, 3);
});

test('鉴权失败和 AbortError 不重试', async () => {
  for (const error of [
    new Error('401 Unauthorized'),
    new Error('403 Forbidden'),
    new DOMException('Stopped', 'AbortError'),
  ]) {
    const h = harness([error]);
    await assert.rejects(generation_cases[0].run(h), caught => caught === error);
    assert.equal(h.calls.length, 1);
  }
});

for (const entry of generation_cases.slice(0, 2)) {
  test(`${entry.name}：取消后不发请求，不接受取消期间返回的结果`, async () => {
    const h = harness([entry.valid]);
    h.state.cancelled = true;
    await assert.rejects(entry.run(h), { name: 'AbortError' });
    assert.equal(h.calls.length, 0);
    h.state.cancelled = false;
    const late = harness([
      () => {
        late.state.cancelled = true;
        return entry.valid;
      },
    ]);
    await assert.rejects(entry.run(late), { name: 'AbortError' });
    assert.equal(late.calls.length, 1);
  });

  test(`${entry.name}：等待期间取消或关闭开关不会继续请求`, async () => {
    for (const cancel of [true, false]) {
      const h = harness(['', entry.valid]);
      h.state.on_wait = () => {
        if (cancel) h.state.cancelled = true;
        else h.settings.retry_enabled = false;
      };
      await assert.rejects(entry.run(h));
      assert.equal(h.calls.length, 1);
    }
  });
}

test('自定义端点缺少配置时直接报错', async () => {
  const h = harness([''], { use_tavern_api: false, custom_api_url: '' });
  await assert.rejects(generation_cases[0].run(h), /端点/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.notices.length, 0);
});
