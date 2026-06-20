# AGENTS.md

本文件是给 AI 编程助手和后续维护者看的项目级说明。修改本仓库前，请先阅读本文件，再结合当前代码和 `@types/` 中的类型定义判断实现方式。

## 项目定位

CosmosMemory 是一个基于酒馆助手（TavernHelper）开发的 SillyTavern 第三方插件。

**注意：当前处于开发阶段，结构随时变动，不用兼容旧版本。**

当前核心目标：

- 读取当前聊天剧情上下文。
- 调用 AI API 对较长剧情进行总结。
- 将总结后的内容注入到后续生成提示词中。
- 通过压缩历史上下文达到节约 token 的目的。

后续规划方向：

- 剧情摘要的结构化保存。
- 剧情数据记录和检索。
- 向量化/embedding 检索。
- 基于相似度召回相关历史剧情，再插入提示词。

实现新功能时要优先考虑这些后续方向，不要把摘要逻辑写死成只能处理单次字符串拼接。

## 技术栈与运行环境

- 插件框架：SillyTavern third-party extension。
- 主要接口来源：酒馆助手 `window.TavernHelper`。
- 前端框架：Vue 3 + Composition API。
- 状态管理：Pinia。
- 数据校验：Zod。
- 构建工具：Vite。
- 包管理器：pnpm。
- 入口文件：`src/index.ts`。
- 面板挂载：`src/panel.ts`。
- 插件配置：`src/store/settings.ts` 与 `src/type/settings.ts`。
- 打包产物：`dist/index.js` 和 `dist/index.css`。

常用命令：

```bash
pnpm install
pnpm build
pnpm watch
pnpm lint
pnpm lint:fix
pnpm format
```

修改代码后，至少运行 `pnpm build`。如果改动涉及较多 TypeScript/Vue 代码，也运行 `pnpm lint`。

## 酒馆助手接口优先级

酒馆助手已经封装了大量 SillyTavern 能力。开发时优先使用 TavernHelper 接口，不要直接操作 SillyTavern 内部对象或 DOM，除非 `@types/` 中没有合适封装且确实必要。

如果酒馆助手没有提供合适接口，可以使用模板提供的 `@sillytavern` 特殊导入方式，直接调用 SillyTavern 自身代码文件导出的函数。例如：

```typescript
import { uuidv4 } from '@sillytavern/scripts/utils';
```

这会导入 `SillyTavern/public/scripts/utils.js` 中导出的 `uuidv4`。使用这类直接导入前，要先确认对应 SillyTavern 文件确实导出了目标函数，并注意版本兼容性。

接口事实来源：

- `@types/function/index.d.ts`：`window.TavernHelper` 暴露的总入口。
- `@types/function/generate.d.ts`：AI 生成、静默生成、自定义 API、JSON Schema 输出。
- `@types/function/inject.d.ts`：提示词注入和取消注入。
- `@types/function/chat_message.d.ts`：聊天楼层读取、修改、创建、删除。
- `@types/function/worldbook.d.ts` 与 `@types/function/lorebook*.d.ts`：世界书/剧情资料相关能力。
- `@types/function/variables.d.ts`：变量读写。
- `@types/function/preset.d.ts`：预设读取和修改。
- `@types/iframe/*`：iframe 环境和事件相关类型。

使用接口前先查类型定义。不要凭记忆猜参数名、返回值或事件名。

## 核心业务原则

### 剧情摘要

- 摘要应保留剧情事实、角色状态、长期伏笔、关系变化和用户明确表达的偏好。
- 摘要不应加入模型臆测的新剧情。
- 摘要结果应尽量结构化，便于后续记录、检索和向量化。
- 调用 AI 做摘要时，优先使用酒馆助手 `generate` / `generateRaw` 的 `json_schema` 能力，再用 Zod 做本地校验。
- 对 AI 返回内容必须做错误处理：JSON 解析失败、schema 校验失败、空结果、接口报错都要有明确反馈。

### 提示词注入

- 插入摘要时优先使用 TavernHelper 的 `injectPrompts` / `uninjectPrompts`。
- 注入 ID 要稳定、可追踪，避免重复注入和残留旧摘要。
- 需要只对下一次生成生效时，使用 `once` 选项。
- 需要跨聊天或切换聊天恢复注入时，监听合适的酒馆事件并重新注入。
- 不要直接拼接到聊天正文里，除非功能明确要求修改楼层内容。

### 聊天历史读取

- 获取聊天内容优先使用 `getChatMessages`。
- 默认只处理实际被 AI 使用的消息页；只有需要分析所有 swipe 时才开启 `include_swipes`。
- 注意隐藏楼层、system/user/assistant 角色、空消息和范围不存在等边界情况。
- 摘要生成时应避免把已经被摘要覆盖的旧内容重复塞回上下文。

### 数据保存

- 插件设置走 Pinia store，并通过 `extension_settings` + `saveSettingsDebounced` 保存。
- 新增配置项必须先在 `src/type/settings.ts` 的 Zod schema 中定义默认值。
- 业务数据如果明显不是“全局插件设置”，不要随手塞进 settings。后续剧情记录、摘要缓存、向量索引应设计独立的数据层。
- 保存 API key、代理地址等敏感信息时要明确用途，避免日志输出。

## 代码组织约定

当前模板文件还比较少，但新增业务时应按职责拆分，不要把所有逻辑塞进 `Panel.vue`。

推荐结构：

```text
src/
  api/              # AI 调用、模型列表、代理预设等封装
  core/             # 摘要、压缩、注入、剧情记录等核心业务
  store/            # Pinia 状态
  type/             # Zod schema 和 TypeScript 类型
  util/             # 通用工具函数
  panel/            # 面板组件、组合式函数
```

拆分建议：

- AI 请求相关逻辑放到 `src/api/`。
- 摘要生成、摘要合并、摘要选择逻辑放到 `src/core/`。
- TavernHelper 读写封装可以放到 `src/core/tavern-*` 或 `src/api/tavern-*`，保持调用点清晰。
- Vue 组件只负责展示和用户操作，不承担复杂业务计算。
- 复杂函数应有明确输入输出类型，并尽量可单独测试。

## TypeScript 与校验

- 保持 `strict` 兼容，不引入隐式 `any`。
- 对外部输入、AI 输出、存储恢复的数据使用 Zod 校验。
- 不要吞掉异常；捕获后要么转成用户可理解的错误，要么继续向上抛出。
- 避免魔法字符串。摘要注入 ID、设置字段名、默认 token 限制等应提取常量。
- 不留下无用导入、调试日志和临时 TODO。

## UI 与交互

- 面板 UI 应贴合 SillyTavern 原有样式，优先使用现有类名如 `menu_button`、`inline-drawer`、`sysHR`。
- 文案使用 ``t`中文文案` ``，需要英文时同步维护 `i18n/en.json`。
- 用户操作需要有明确反馈：成功、失败、正在总结、已注入、已取消等状态。
- 长任务要避免重复点击造成并发请求；必要时提供停止生成或取消任务能力。
- 不在界面显示 API key 等敏感信息。

## 构建产物

- 源码修改主要发生在 `src/`、`i18n/`、配置文件和类型文件。
- `dist/` 是插件实际加载的产物。只有在完成源码修改并运行构建后才更新它。
- 不要手工编辑 `dist/index.js` 来实现功能。
- 如果只改文档，不需要重新构建。

## 开发流程

1. 先阅读相关源码和 `@types/` 类型定义。
2. 明确改动范围，优先做最小必要修改。
3. 新增较大功能时先拆模块，再接入 UI。
4. 为 AI 输出、聊天消息范围、注入状态等边界情况写清楚处理逻辑。
5. 运行 `pnpm build`，必要时运行 `pnpm lint`。
6. 如果能在 SillyTavern 中验证，应手动检查插件面板、摘要调用和提示词注入是否符合预期。

## 不要做的事

- 不要绕过 TavernHelper 直接依赖脆弱的 DOM 结构。
- 不要把 AI 摘要结果未经校验就写入设置或注入提示词。
- 不要把 API key 打印到控制台。
- 不要为了一个小功能大范围重写模板结构。
- 不要把长期剧情数据、向量数据和普通 UI 设置混在同一个 settings 对象里。
- 不要静默失败；失败时要有日志和用户可见提示。
