# CosmosMemory 待优化清单

> 来源：2026-07-17 架构评审（覆盖全部源码与 `@types/` 类型核对）中提出、尚未实施的优化项。
> 已完成的批次见文末「已完成记录」。条目按优先级分组，组内大致按价值/工作量排序。
> 引用位置以「文件 + 函数名」为准，行号可能随后续改动漂移。

## 一、正确性残余

### 1. character-regeneration 全量重建的输入与一致性

- 位置：`src/core/character-regeneration.ts`
- 问题：`getChatMessages` 未排除隐藏楼层（`hide_state` 默认 `'all'`），被压缩隐藏的旧楼层原文也参与人物重建；全聊天拼接无长度上限，长聊天必超 token；只重建人物，不联动地点/物品/当前信息，重建后四类数据互相不一致。
- 建议：加 `hide_state: 'unhidden'`（或改为基于已存摘要重放）；拼接内容加长度上限并优先保留近期楼层；考虑同步重建其余三类实体，或在面板文案明确说明只重建人物。

### 2. 总结任务复用竞态（旧 swipe 内容指纹）

- 位置：`src/core/summary.ts` `summarizeReceivedMessage`、`src/core/events.ts` `handleMessageReceived`
- 问题：旧 swipe 的总结任务仍在进行时快速再次 swipe/regenerate，Map 去重会让新楼层复用旧任务，得到旧内容的摘要。窗口小但真实存在。
- 建议：为进行中的任务记录内容指纹（如原文长度 + 特征值），regenerate/swipe 类事件不复用指纹不符的任务；或对 regenerate/swipe 强制新任务并取消旧任务（P0-6 已有按楼层取消能力可复用）。

## 二、用户体验

### 3. 数据对话框为点击时快照

- 位置：`src/Panel.vue` `handle_show_*`
- 问题：总结/人物/地点/物品四个对话框只在点击瞬间取数，后台事件更新后内容陈旧；只有「当前信息」Tab 有刷新按钮。
- 建议：对话框打开期间监听更新事件自动刷新，或给每个对话框加刷新按钮。

### 4. 长任务取消能力不齐

- 位置：`src/Panel.vue` `handle_regenerate_characters`、`src/core/summary.ts`
- 问题：人物全量重建无停止按钮；「手动检查记忆」与「重新生成人物」两个 AI 长任务互不禁用，可并发触发；MESSAGE_SENT 自动补全路径没有 UI 取消入口（`stopSummarizeTasks` API 已具备）。
- 建议：重建人物接入同类停止机制；两个任务互相纳入对方 disabled 计算；面板提供全局「停止总结任务」入口。

### 5. 面板 DOM 操作未收口

- 位置：`src/Panel.vue` `handle_status_bar_toggle`、`src/core/status-bar.ts`
- 问题：Panel 直接用 jQuery 选择器移除状态栏，与 status-bar.ts 内部实现重复；`window.parent.document` 语义误导（扩展运行在顶层窗口时 `parent === window`）。
- 建议：status-bar.ts 导出 `removeStatusBar()`，Panel 改调用；统一去掉 `window.parent.document`。

## 三、工程健康

### 6. Panel.vue 拆分（约 980 行）

- 位置：`src/Panel.vue`
- 建议：落地 AGENTS.md 推荐的 `src/panel/` 结构——4 个对话框子组件、composable（`useAiConnection`、`useMemoryDialogs`）；`normalize_*` 移到 store 或从 schema 默认值读取；`format_time` 入 `src/util/`；`sorted_location_*` 入 `core/locations` 导出。`vite.config.ts` 已配置 `./src/panel/composable` 的 auto-import 目录，可直接使用。

### 7. 生产构建 sourcemap

- 位置：`vite.config.ts` `build.sourcemap`
- 问题：production 生成独立 `.map`（`dist/index.js.map` 约 1.6MB）随 git 分发给所有用户，酒馆运行时不需要。
- 建议：改为 `'hidden'` 或关闭。

### 8. TypeScript 版本与 tsconfig 全量 include

- 位置：`package.json`、`tsconfig.json`
- 问题：`typescript` 为 `6.0.0-dev` 每日构建版，有稳定性风险；`include` 拉入酒馆全部 `public/**/*.js` 仅为 intellisense，拖慢 `tsc`。
- 建议：TS 锁稳定版；include 收窄到实际引用的酒馆文件子集。

### 9. 日志噪音与前缀常量

- 位置：`src/core/events.ts`、`src/core/summary.ts` 等
- 问题：每条消息 3-4 条 `console.info`，长聊天刷屏；`'[CosmosMemory]'` 前缀散布各文件。
- 建议：提取共享日志工具（统一前缀 + debug 开关），info 级日志受开关控制，默认只保留 warn/error。

### 10. 性能：状态栏与聊天变量解析

- 位置：`src/core/status-bar.ts` `getLatestAiMessageId`、`src/core/summary.ts` `getStoredMessageSummaries`
- 问题：状态栏每次刷新全量遍历聊天记录找最后一条 assistant 楼层；`renderTabContent` 每次 4 次 `getVariables`（每次深拷贝整份聊天变量）；`getStoredMessageSummaries` 在总结/回溯/压缩/注入/状态栏多个热路径反复全量解析 + 逐条 Zod 校验。
- 建议：状态栏用 `getLastMessageId()` + 小范围倒序查询，四个 store 读取合并为一次 `getVariables`；摘要解析结果做 per-chat 内存缓存，写入时失效。

### 11. 小项合集

- `src/global.css`：`word-break: break-all` 会把英文单词从中断开，建议 `overflow-wrap: anywhere`。
- `src/core/compression.ts`：`Record<string, any>`（`cloneMessageData` 等）类型可收窄。
- `src/core/summary.ts`：`getStoredMessageSummaries` 用手写 `typeof` 检查 + 分散 `safeParse`，建议定义 `MessageSummary` Zod schema 统一校验（呼应 AGENTS.md「存储恢复数据用 Zod」）。
- `src/api/ai.ts`：`parseSummaryJson` / `parseFullCharacterExtractionJson` 的 JSON 提取逻辑重复，且 `/\{[\s\S]*\}/` 贪婪匹配对多花括号文本不稳；建议提取 `extractJsonText` 工具函数，解析失败时把原始返回截断片段带进错误信息便于排障。
- `src/panel.ts`：`initPanel` 无重复挂载防护（开发热重载会双份挂载）。
- 事件监听均无 `eventSource.off` 句柄（酒馆扩展生命周期内可接受，仅记录）。
- 模块级 `injected_summary_prompt_ids` 在 `CHAT_CHANGED` 时不显式清理（当前靠下次生成前 clear 兜底，风险低）。

## 四、架构演进（面向剧情检索与向量化）

### 12. current-info 的 elapsed_time / reason 落盘即丢

- 位置：`src/core/current-info.ts` `normalizeCurrentInfo`
- 问题：AI 按 schema 返回 `elapsed_time`、`reason`，落盘时被丢弃，AI 白生成。
- 建议：存入 current_info（带 `updated_at`），或从请求 schema 删除。故事时间是后续按时间检索的天然字段，建议保留。

### 13. current-info 角色键与人物库不对齐

- 位置：`src/core/current-info.ts` `normalizeCurrentCharacters`
- 问题：当前信息的角色表以原始名称为键（仅 trim），人物库用 `normalizeEntityKey`（小写 + 压缩空白）；「李华」/「李华 」在两套数据里对不上，后续做实体关联/检索时会成为脏数据源头。
- 建议：current-info 存储可保持显示名，但需要维护一份到人物库规范键的映射（实体解析层：别名 → 规范键）。

### 14. 摘要结构化字段增强（向量化前置）

- 位置：`src/core/summary.ts` `MessageSummary`
- 建议：后续做向量检索前，给摘要补充结构化字段——覆盖楼层范围、关键实体名列表（可从当次 operations 的 `name` 字段免费提取）、故事时间（current_info 已产出）、token 估算。这些字段可直接作为相似度召回时的 metadata filter，无需重新调 AI。

## 已完成记录（2026-07-17）

| 提交 | 内容 |
|---|---|
| `4c593c2` | P0 六项修复（swipe 回滚、事件不再阻断生成、状态栏 XSS、settings 容错、跨聊天防护、补全并发 + 取消）+ 统一实体数据层（entity-store + 来源元数据） |
| `8edd8fe` | 摘要注入框架化：`[CosmosMemory 前情摘要]` 标记 + system role |
| `b765b15` | 依赖大扫除（20 个零引用包、tailwind/postcss 配置、eslint 插件） |
| `303fbd7` | 摘要生命周期三件套（MESSAGE_EDITED 失效重总结、压缩总开关、手动隐藏楼层注入摘要） |
| `02f968b` | API 源设置项 + 鉴权/网络错误不再降级重试 |
| `a2b5242` | i18n 补全（启用开关键、错误消息走 `t``、整句参数化） |
