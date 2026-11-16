/* eslint-disable import-x/no-nodejs-modules -- 回归测试在 Node.js 中运行 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { z } from 'zod';
import * as yaml from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const compiled = new Map();
const clone = value => JSON.parse(JSON.stringify(value));

function harness(chats = new Map()) {
  const state = {
    chat: 'chat-a',
    response: { data: [{ id: 'glm-5.3' }, { id: 'deepseek-v4-pro' }, { id: 'glm-5.3' }] },
    status: 200,
  };
  const calls = [];
  const requests = [];
  const context = createContext({
    z,
    URL,
    __COSMOS_MEMORY_VERSION__: version,
    _: {
      get: (object, path) => path.split('.').reduce((value, key) => value?.[key], object),
      set: (object, path, value) => {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce((current, key) => (current[key] ??= {}), object)[last] = value;
      },
      isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    },
    ref: value => ({ value }),
    t: parts => parts.join(''),
    toastr: { info() {} },
    console: { info() {}, warn() {} },
    setTimeout: callback => callback(),
    fetch: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      return {
        ok: state.status === 200,
        status: state.status,
        json: async () => {
          if (state.response instanceof Error) throw state.response;
          return state.response;
        },
      };
    },
    window: {
      TavernHelper: {
        getVariables: () => chats.get(state.chat) ?? {},
        updateVariablesWith: updater => chats.set(state.chat, updater(chats.get(state.chat) ?? {})),
        generateRaw: async config => {
          calls.push(config);
          return state.generation_response?.(calls.length) ?? '{"summary":"有效摘要"}';
        },
      },
    },
  });
  const modules = new Map();
  function load(id) {
    if (id === 'yaml') return yaml;
    if (id === '@sillytavern/script')
      return {
        getCurrentChatId: () => state.chat,
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' }),
        event_types: {},
        eventSource: {},
      };
    if (id === '@sillytavern/scripts/utils') return { uuidv4: randomUUID, getStringHash: value => value.length };
    assert.ok(id.startsWith('@/'), `Unexpected import: ${id}`);
    const filename = resolve(root, 'src', `${id.slice(2)}.ts`);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    modules.set(filename, exports);
    if (!compiled.has(filename))
      compiled.set(
        filename,
        ts.transpileModule(readFileSync(filename, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
      );
    runInContext(`(function(require, exports) { ${compiled.get(filename)}\n})`, context, { filename })(load, exports);
    return exports;
  }
  const settings = load('@/type/settings').AiSettings.parse({
    use_tavern_api: false,
    custom_api_source: 'opencode',
    custom_api_key: ' go-key ',
    selected_model: 'deepseek-v4-pro',
    custom_include_body: 'model: unwanted',
    custom_include_headers: 'Authorization: unwanted',
    custom_exclude_body: '[messages]',
  });
  return { state, calls, requests, chats, settings, api: load('@/api/ai') };
}

test('OpenCode 专用源使用官方端点和插件标识，覆盖全局自定义参数并保留 JSON Schema', async () => {
  const h = harness();
  await h.api.summarizeMessage(h.settings, '剧情');
  const request = h.calls[0];
  assert.ok(request.json_schema);
  assert.equal(request.custom_api.source, 'custom');
  assert.equal(request.custom_api.apiurl, 'https://opencode.ai/inference/go/openai/v1');
  assert.equal(request.custom_api.max_tokens, h.settings.max_output_tokens);
  assert.deepEqual(clone(request.custom_api.custom_include_body), {});
  assert.deepEqual(clone(request.custom_api.custom_exclude_body), []);
  assert.equal(request.custom_api.custom_include_headers.Authorization, 'Bearer go-key');
  assert.equal(request.custom_api.custom_include_headers['User-Agent'], `CosmosMemory/${version}`);
  assert.ok(z.uuid().safeParse(request.custom_api.custom_include_headers['x-opencode-session']).success);
});

test('会话标识跨模型列表、生成、重试与刷新保持一致，切换和复制聊天分别分配', async () => {
  const h = harness();
  await h.api.fetchCustomModelNames(h.settings);
  const first = yaml.parse(h.requests[0].body.custom_include_headers)['x-opencode-session'];
  h.state.generation_response = count => (count === 1 ? '' : '{"summary":"重试摘要"}');
  await h.api.summarizeMessage(h.settings, '剧情');
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.custom_api.custom_include_headers['x-opencode-session'] === first));

  const reloaded = harness(h.chats);
  await reloaded.api.sendPing(reloaded.settings);
  assert.equal(reloaded.calls[0].custom_api.custom_include_headers['x-opencode-session'], first);
  h.state.chat = 'chat-b';
  h.chats.set('chat-b', clone(h.chats.get('chat-a')));
  await h.api.sendPing(h.settings);
  assert.notEqual(h.calls.at(-1).custom_api.custom_include_headers['x-opencode-session'], first);
  h.state.chat = 'chat-a';
  await h.api.sendPing(h.settings);
  assert.equal(h.calls.at(-1).custom_api.custom_include_headers['x-opencode-session'], first);
});

test('无聊天测试使用稳定的页面会话，不写入聊天变量；损坏会话数据重新分配', async () => {
  const h = harness();
  h.state.chat = undefined;
  await h.api.sendPing(h.settings);
  await h.api.sendPing(h.settings);
  assert.equal(
    h.calls[0].custom_api.custom_include_headers['x-opencode-session'],
    h.calls[1].custom_api.custom_include_headers['x-opencode-session'],
  );
  assert.equal(h.chats.size, 0);
  h.state.chat = 'chat-a';
  h.chats.set('chat-a', {
    cosmos_memory: { opencode_session: { chat_id: 'chat-a', id: 'bad\nheader' }, unrelated: 42 },
  });
  await h.api.sendPing(h.settings);
  assert.ok(z.uuid().safeParse(h.calls[2].custom_api.custom_include_headers['x-opencode-session']).success);
  assert.equal(h.chats.get('chat-a').cosmos_memory.unrelated, 42);
});

test('模型列表通过酒馆后端附带身份头，校验后去重排序', async () => {
  const h = harness();
  assert.deepEqual(clone(await h.api.fetchCustomModelNames(h.settings)), ['deepseek-v4-pro', 'glm-5.3']);
  const request = h.requests[0];
  assert.equal(request.url, '/api/backends/chat-completions/status');
  assert.equal(request.headers['X-CSRF-Token'], 'test');
  assert.equal(request.body.custom_url, 'https://opencode.ai/inference/go/v1');
  assert.equal(request.body.chat_completion_source, 'custom');
  assert.equal(yaml.parse(request.body.custom_include_headers)['User-Agent'], `CosmosMemory/${version}`);
});

test('鉴权、空列表和无效响应明确报错，不回显密钥', async () => {
  const h = harness();
  h.state.status = 401;
  await assert.rejects(h.api.fetchCustomModelNames(h.settings), /HTTP 401/);
  h.state.status = 200;
  for (const response of [{ data: [] }, { error: 'go-key' }, { data: [{ id: 42 }] }, new SyntaxError('go-key')]) {
    h.state.response = response;
    await assert.rejects(
      h.api.fetchCustomModelNames(h.settings),
      error => /无效或为空/.test(error.message) && !error.message.includes('go-key'),
    );
  }
  h.settings.custom_api_key = '';
  await assert.rejects(h.api.sendPing(h.settings), /请先填写 OpenCode Go 密钥/);
  assert.equal(h.calls.length, 0);
});

test('自动推断优先识别官方 Go 路径；显式来源及酒馆 API 不受影响', async () => {
  const h = harness();
  h.settings.custom_api_source = 'auto';
  for (const url of ['https://opencode.ai/inference/go/openai/v1', 'https://opencode.ai/zen/go/v1']) {
    h.settings.custom_api_url = url;
    assert.equal(h.api.resolveCustomApiSource(h.settings), 'opencode');
  }
  h.settings.custom_api_url = 'https://opencode.ai.example/inference/go/v1';
  assert.equal(h.api.resolveCustomApiSource(h.settings), 'deepseek');
  h.settings.custom_api_source = 'custom';
  h.settings.custom_api_url = 'https://opencode.ai/inference/go/openai/v1';
  assert.equal(h.api.resolveCustomApiSource(h.settings), 'custom');
  h.settings.custom_api_source = 'opencode';
  h.settings.use_tavern_api = true;
  await h.api.sendPing(h.settings);
  assert.equal(h.calls[0].custom_api, undefined);
  assert.equal(h.chats.size, 0);
});
