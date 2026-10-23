/* eslint-disable import-x/no-nodejs-modules -- 回归测试在 Node.js 中运行 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { z } from 'zod';
import * as yaml from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));

// 使用实际请求构造与 Zod 校验，只替换酒馆接口、通知和计时器。
function harness(responses, settings_patch = {}) {
  const calls = [];
  const notices = [];
  const state = { cancelled: false, on_wait: () => {} };
  const context = createContext({
    z,
    _: { isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value) },
    ref: value => ({ value }),
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
    if (id === 'yaml') return yaml;
    if (id === '@sillytavern/script') return { event_types: {}, eventSource: {} };
    if (id === '@sillytavern/scripts/utils') return { getStringHash: value => value.length };
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

test('总结 JSON：修复 characters 末尾多余引号并保留后续时间和地点字段', async () => {
  const raw =
    '{"summary":"剧情摘要","current_info_update":{"current_time":"辰时","location":"赵府正堂","characters":{"赵管家":{"clothing":"绸衫","status":"侍立"},"},"elapsed_time":"18小时","reason":"次日进城"},"location_operations":[]}';
  const h = harness([raw], { retry_enabled: false });
  const result = await h.api.summarizeMessage(h.settings, '剧情', { current_info_enabled: true });
  assert.equal(result.summary, '剧情摘要');
  assert.equal(result.current_info_update.characters.赵管家.status, '侍立');
  assert.equal(Object.keys(result.current_info_update.characters).length, 1);
  assert.equal(result.current_info_update.elapsed_time, '18小时');
  assert.equal(result.current_info_update.reason, '次日进城');
  assert.equal(result.current_info_update.location, '赵府正堂');
  assert.equal(h.calls.length, 1);
});

test('地点总结：未知世界名称不影响具体地点入库前的解析校验', async () => {
  const h = harness(
    [
      JSON.stringify({
        summary: '李行在岩洞取火',
        location_operations: [{ type: 'add', world: '', city: '风语部落', scene: '白霜的岩洞' }],
      }),
    ],
    { retry_enabled: false },
  );
  const result = await h.api.summarizeMessage(h.settings, '剧情', { locations_enabled: true, locations: [] });
  assert.equal(result.location_operations[0].world, '');
  assert.equal(result.location_operations[0].scene, '白霜的岩洞');
  assert.equal(h.calls.length, 1);
});

test('总结 JSON：仅修复字符串外尾逗号，保留正文中的引号、反斜杠及分隔符', async () => {
  const summary = '原文 ,} ,] ,"}, 和转义引号 "、反斜杠 \\';
  for (const suffix of ['', ',']) {
    const raw = `\`\`\`json\n{"summary":${JSON.stringify(summary)}${suffix}}\n\`\`\``;
    const h = harness([raw], { retry_enabled: false });
    assert.equal((await generation_cases[0].run(h)).summary, summary);
  }
  const h = harness(['{"characters": [{"type":"secondary","name":"管家","brief":"侍立",},],}']);
  assert.equal((await generation_cases[2].run(h))[0].name, '管家');
});

test('总结 JSON：格式修复后仍校验字段；截断和缺失字段值明确报错', async () => {
  for (const raw of ['{"summary":42,}', '{"summary":" " ,}']) {
    const h = harness([raw], { retry_enabled: false });
    await assert.rejects(generation_cases[0].run(h));
  }
  for (const raw of ['{"summary":}', '{"summary":"截断', '{"summary":"摘要","current_info_update":']) {
    const h = harness([raw], { retry_enabled: false });
    await assert.rejects(generation_cases[0].run(h), /JSON 格式无效/);
    assert.equal(h.calls.length, 1);
  }
});

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

const custom_settings = {
  use_tavern_api: false,
  custom_api_source: 'custom',
  selected_model: 'test-model',
  custom_api_key: 'test-key',
};

test('自定义源：YAML / JSON 参数传给酒馆助手，保留 false、嵌套对象和排除字段', async () => {
  for (const body of [
    'enable_thinking: false\nthinking:\n  type: disabled\ntemperature: 0',
    '{"enable_thinking":false,"thinking":{"type":"disabled"},"temperature":0}',
  ]) {
    const h = harness(['pong'], {
      ...custom_settings,
      custom_include_body: body,
      custom_exclude_body: '- frequency_penalty\n- presence_penalty',
      custom_include_headers: 'X-Test: custom-value',
      reasoning_effort: 'off',
    });
    await h.api.sendPing(h.settings);
    const options = h.calls[0].custom_api;
    assert.equal(options.source, 'custom');
    assert.equal(options.custom_include_body.enable_thinking, false);
    assert.equal(options.custom_include_body.thinking.type, 'disabled');
    assert.equal(options.custom_include_body.temperature, 0);
    assert.equal(options.custom_exclude_body.join(','), 'frequency_penalty,presence_penalty');
    assert.equal(options.custom_include_headers.Authorization, 'Bearer test-key');
    assert.equal(options.custom_include_headers['X-Test'], 'custom-value');
  }
});

test('自定义源：留空显式清除酒馆附加配置，不继承全局自定义源密钥', async () => {
  const h = harness(['pong'], { ...custom_settings, custom_api_key: '' });
  await h.api.sendPing(h.settings);
  const options = h.calls[0].custom_api;
  assert.equal(Object.keys(options.custom_include_body).length, 0);
  assert.equal(options.custom_exclude_body.length, 0);
  assert.equal(options.custom_include_headers.Authorization, 'Bearer ');
});

test('自定义源：追加请求头可以覆盖密钥自动生成的 Authorization', async () => {
  for (const name of ['Authorization', 'authorization']) {
    const h = harness(['pong'], {
      ...custom_settings,
      custom_include_headers: `${name}: Bearer override\ncontent-type: application/json`,
    });
    await h.api.sendPing(h.settings);
    const headers = h.calls[0].custom_api.custom_include_headers;
    assert.equal(headers.Authorization, 'Bearer override');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(Object.keys(headers).length, 2);
  }
});

test('自定义源：错误配置在发送前拒绝，不重试且不回显原始值', async () => {
  for (const patch of [
    { custom_include_body: 'secret: [sensitive-value' },
    { custom_include_body: '["sensitive-value"]' },
    { custom_include_body: 'null' },
    { custom_exclude_body: '{"sensitive-value":true}' },
    { custom_exclude_body: '[42]' },
    { custom_include_headers: 'Authorization: [sensitive-value]' },
  ]) {
    const h = harness(['pong'], { ...custom_settings, ...patch });
    await assert.rejects(h.api.summarizeMessage(h.settings, '剧情'), error => {
      assert.match(error.message, /无效/);
      assert.doesNotMatch(error.message, /sensitive-value/);
      return true;
    });
    assert.equal(h.calls.length, 0);
    assert.equal(h.notices.length, 0);
  }
});

test('酒馆 API 与其他源忽略自定义参数；切回自定义源仍保留配置', async () => {
  for (const patch of [{ use_tavern_api: true }, { custom_api_source: 'openai' }]) {
    const h = harness(['pong'], { ...custom_settings, custom_include_body: 'invalid: [', ...patch });
    await h.api.sendPing(h.settings);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].custom_api?.custom_include_body, undefined);
    h.settings.use_tavern_api = false;
    h.settings.custom_api_source = 'custom';
    await assert.rejects(h.api.sendPing(h.settings), /追加请求体无效/);
    assert.equal(h.calls.length, 1);
  }
});
