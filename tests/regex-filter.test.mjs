import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as ts from 'typescript';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));

function setupContext(mockFormatAsTavernRegexedString, summarySettings = {}) {
  const context = createContext({
    z,
    Error,
    ref: val => ({ value: val }),
    _: {
      debounce: fn => fn,
      get: (obj, path, def) => def,
      set: () => {},
    },
    console: { info() {}, warn() {}, error() {} },
    t: parts => parts.join(''),
    window: {
      TavernHelper: {
        formatAsTavernRegexedString: mockFormatAsTavernRegexedString,
      },
    },
  });

  const modules = new Map();
  function load(id) {
    if (id === '@sillytavern/script') return { event_types: {}, eventSource: {}, getCurrentChatId: () => 'chat-1' };
    if (id === '@sillytavern/scripts/utils') return { getStringHash: s => `hash_${s}` };
    if (id === '@sillytavern/scripts/tokenizers')
      return { getTokenCountAsync: async text => Math.ceil(text.length / 3) };
    if (id === '@/store/settings')
      return { useSettingsStore: () => ({ settings: { filter: { enabled: false }, summary: summarySettings } }) };
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

  return { ...load('@/core/summary'), ...load('@/core/body-filter') };
}

test('正文过滤：合并多段、多行及嵌套正文，排除标签外内容', () => {
  const { filterBodyContent } = setupContext();
  const text = '思考<content> 第一行\n第二行 </content>状态栏<CONTENT>第三段</CONTENT>尾部';
  assert.equal(filterBodyContent(text, true, '<content>'), '第一行\n第二行\n\n第三段');
  assert.equal(filterBodyContent('<content>甲<content>乙</content>丙</content>', true, 'content'), '甲乙丙');
  assert.equal(filterBodyContent(text, false, '<content>'), text);
});

test('正文过滤：空、缺失、不完整或无效标签均不发送原文，自定义标签按字面匹配', () => {
  const { filterBodyContent, normalizeBodyTag } = setupContext();
  for (const text of ['', '无标签正文', '<content>未闭合', '</content>只有结束标签', '<content> </content>']) {
    assert.equal(filterBodyContent(text, true, '<content>'), '');
  }
  assert.equal(
    filterBodyContent('<story.body>正文</story.body><storyXbody>外部</storyXbody>', true, 'story.body'),
    '正文',
  );
  assert.equal(filterBodyContent('<content>正文</content>', true, '.*'), '');
  assert.equal(normalizeBodyTag(''), '<content>');
  assert.equal(normalizeBodyTag(' story '), '<story>');
  assert.equal(normalizeBodyTag('<content attr="x">'), null);
});

test('正文过滤在酒馆正则之前执行，正则异常回退也不会泄露标签外文本，用户消息保持原有处理', () => {
  const settings = { filter_body: true, body_tag: '<content>' };
  const message = { message_id: 1, name: 'Alice', role: 'assistant', message: '思考<content>正文</content>状态栏' };
  const summary = setupContext(text => {
    assert.equal(text, '正文');
    return text;
  }, settings);
  assert.equal(summary.getRegexedAiContent(message), '正文');
  const failing = setupContext(() => {
    throw new Error('Regex error');
  }, settings);
  assert.equal(failing.getRegexedAiContent(message), '正文');
  const noRegex = setupContext(undefined, settings);
  assert.equal(noRegex.getRegexedMessageContent({ ...message, role: 'user', message: '用户原文' }), '用户原文');
});

test('getRegexedContent：依次调用 display 与 prompt，并传递角色名且不限制 depth', () => {
  const calls = [];
  const mock = (text, source, destination, options) => {
    calls.push({ text, source, destination, options });
    if (destination === 'display') {
      return text.replace(/<think>[\s\S]*?<\/think>/g, '');
    }
    if (destination === 'prompt') {
      return text.replace(/\[system_prompt\]/g, '');
    }
    return text;
  };

  const summary = setupContext(mock);
  const input = '<think>内意思考</think>你好世界[system_prompt]';
  const result = summary.getRegexedContent(input, 'ai_output', 'Alice');

  assert.equal(result, '你好世界');
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    text: input,
    source: 'ai_output',
    destination: 'display',
    options: { character_name: 'Alice' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), {
    text: '你好世界[system_prompt]',
    source: 'ai_output',
    destination: 'prompt',
    options: { character_name: 'Alice' },
  });
});

test('getRegexedAiContent：正确提取 assistant 消息的角色名并应用过滤', () => {
  const mock = (text, source, destination, options) => {
    assert.equal(source, 'ai_output');
    assert.equal(options.character_name, 'Bob');
    return text.replace(/<filtered>/g, '');
  };

  const summary = setupContext(mock);
  const message = {
    message_id: 1,
    name: 'Bob',
    role: 'assistant',
    is_hidden: false,
    message: '  <filtered>正文内容  ',
    data: {},
    extra: {},
  };

  const result = summary.getRegexedAiContent(message);
  assert.equal(result, '正文内容');
});

test('getRegexedMessageContent：user 角色使用 user_input 作用域', () => {
  const calls = [];
  const mock = (text, source, destination, options) => {
    calls.push({ source, options });
    return text.trim();
  };

  const summary = setupContext(mock);
  const userMessage = {
    message_id: 2,
    name: 'User',
    role: 'user',
    is_hidden: false,
    message: '用户输入文本',
    data: {},
    extra: {},
  };

  summary.getRegexedMessageContent(userMessage);
  assert.equal(calls[0].source, 'user_input');
  assert.equal(calls[0].options.character_name, 'User');
});

test('异常与边界处理：TavernHelper 抛错或未定义时安全回退', () => {
  const errorMock = () => {
    throw new Error('Regex error');
  };
  const summaryWithError = setupContext(errorMock);
  const result1 = summaryWithError.getRegexedContent('  原文文本  ', 'ai_output');
  assert.equal(result1, '原文文本');

  const summaryNoHelper = setupContext(undefined);
  const result2 = summaryNoHelper.getRegexedContent('  原文文本2  ', 'ai_output');
  assert.equal(result2, '原文文本2');

  assert.equal(summaryNoHelper.getRegexedContent(''), '');
  assert.equal(summaryNoHelper.getRegexedContent(null), '');
});
