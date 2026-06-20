# CosmosMemory

[中文说明](#中文说明) | [English Description](#english-description)

---

## 中文说明

`CosmosMemory` 是一个为 **SillyTavern (酒馆)** 角色扮演量身定制的第三方上下文压缩与结构化记忆管理插件。

通过自动分析聊天剧情、智能提炼关键要素（如：当前状态、出场人物、地点变迁、重要物品），插件能够在隐藏/折叠旧消息的同时，以高度结构化的提示词（Prompts）形式动态注入这些记忆。这在最大程度节省上下文 Token 开销的同时，让 AI 始终记住故事的关键走向与背景设定，非常适合超长扮演或跑团使用。

### 核心功能

1. **智能上下文压缩与总结 (Summary & Compression)**
   - 支持自定义设置保留最近的 `N` 条 AI 原始回复。
   - 当回复数量超出阈值时，插件会自动调用 AI 提取旧消息中的剧情事实和关键事件，并转为长效的剧情摘要注入到生成提示词中，同时隐藏原有的旧消息，在极大节省 Token 开销的同时防止遗忘。
2. **多维结构化记忆模块 (Structured Memory Modules)**
   - **当前状态 (Current Info)**：动态跟踪当前的虚拟时间、当前发生地以及场上角色状态（如服装、身体/精神状况等），并精准注入到人物信息之上。
   - **人物档案 (Characters)**：自动提取出场的主要角色（记录背景、外貌、性格）和常驻次要角色，支持根据完整聊天记录一键重新生成所有角色档案。
   - **地理坐标 (Locations)**：构建层次分明的世界观地理层级（国家 ➔ 城市 ➔ 场景 ➔ 房间），自动关联和更新各级地点描述，并在对应地点活跃时动态注入。
   - **剧情物品 (Items)**：监控并记录剧情关键物品或道具（如武器、药水、线索道具），维护其描述并在生成时注入。
3. **沉浸式聊天状态栏 (Tabbed Chat Status Bar)**
   - 在最新一条 AI 回复的末尾直接渲染交互式状态栏，提供“当前信息”、“人物信息”、“物品信息”、“地点信息”四个标签页，随时一键切换查看，无需频繁翻阅或点开侧边栏设置。
4. **分类设置面板 (Tabbed Settings Layout)**
   - 侧边栏配置面板进行了深度的标签式优化，将 API 设置、总结配置、当前信息、人物、地点、物品六个板块分门别类，操作更加优雅直观。
5. **记忆自动回溯与修复 (Memory Check & Repair)**
   - 自动在发送新消息前对整条聊天树进行回溯校验，自动清除失效的悬空总结，并补齐因网络等原因缺失的楼层总结。亦可在侧边栏手动执行全面校验。
6. **双语支持与自定义 API**
   - 拥有完整的中英双语本地化支持（i18n）。
   - 默认直接复用酒馆当前启用的 API，也支持配置自定义独立的 OpenAI 兼容端点（如 DeepSeek 等），支持模型列表拉取与连接测试。

### 工作原理

`CosmosMemory` 深度集成于 SillyTavern 的核心事件生命周期中：
- **收到新消息 (`MESSAGE_RECEIVED`)**：在 AI 生成回复后，触发总结逻辑，提取其中的剧情事实、状态变更，并更新到对应的结构化记忆模块中。
- **发送新消息 (`MESSAGE_SENT`)**：在用户发送消息前，对上下文及总结的连续性执行回溯检查，及时纠错或补齐。
- **生成新文本前 (`GENERATION_AFTER_COMMANDS`)**：计算需要隐藏的旧消息数量并予以折叠，将当前启用的各个记忆模块（时间、地点、人物、物品、历史剧情摘要）拼接为系统提示词，通过酒馆助手接口稳定注入到上下文的指定位置。

---

## English Description

`CosmosMemory` is a third-party extension designed specifically for **SillyTavern**, offering context window compression and structured memory management.

By analyzing the narrative context of the chat, the extension extracts key story facts, characters' states, location trajectories, and critical items. When older chat messages are hidden to save token budget, CosmosMemory injects these structured memories back into subsequent prompts, ensuring that the AI retains crucial lore and story progression indefinitely. It is an ideal companion for long-term campaigns and roleplaying.

### Core Features

1. **Narrative Summarization & Context Compression**
   - Allows setting a user-specified number of raw assistant replies (`N`) to keep visible.
   - When AI replies exceed the limit, older messages are compressed into concise narrative summaries and hidden from the context. These summaries are dynamically injected during the next generation to save valuable context tokens.
2. **Structured Memory Modules**
   - **Current Info**: Automatically tracks the in-universe time, location, and the current clothing/state of active characters, injecting this metadata above character profiles.
   - **Characters**: Extracts and updates descriptions (background, appearance, personality) of major characters, and keeps brief bios for secondary characters. Features one-click manual regeneration of character lists from scratch.
   - **Locations**: Builds a hierarchical geography tree (Country ➔ City ➔ Scene ➔ Room), dynamically updating descriptions and injecting them when active.
   - **Items**: Identifies and logs important narrative-affecting props, gear, or weapons, retaining their details permanently.
3. **In-Chat Status Bar**
   - Appends a clean, tabbed status panel at the bottom of the latest AI response in the chat timeline. Users can toggle between "Current Info", "Characters", "Items", and "Locations" tabs directly, seeing the game state in real-time.
4. **Tabbed Settings Sidebar**
   - Features a clean, optimized tabbed layout inside the SillyTavern extension settings panel, splitting configs into API Settings, Summaries, Current Info, Characters, Locations, and Items.
5. **Memory Backtrack & Validation**
   - Performs a retroactive scan of the chat tree before sending any new message, removing dangling summaries and backfilling missing ones automatically. Manual check is also available in the sidebar.
6. **Localization & Custom API Support**
   - Full i18n support for both Simplified Chinese and English.
   - Seamlessly uses the active SillyTavern API configuration, or connects to a custom OpenAI-compatible endpoint (e.g., DeepSeek) with model fetching and connectivity tests.

### How It Works

`CosmosMemory` integrates into SillyTavern's core event lifecycle:
- **Message Received (`MESSAGE_RECEIVED`)**: Summarizes the incoming message and updates active character states, locations, and items.
- **Message Sent (`MESSAGE_SENT`)**: Triggers an automated memory check on the chat tree to repair inconsistent or missing summaries before a new prompt is sent.
- **Before AI Generation (`GENERATION_AFTER_COMMANDS`)**: Compresses older message layers, updates prompt injections based on active memory modules, and instructs SillyTavern to hide older messages.

---

## 安装与开发 / Installation & Development

### 安装 / Installation

1. 克隆本仓库到酒馆的第三方扩展目录中：
   Clone this repository into SillyTavern's third-party extensions directory:
   ```bash
   cd SillyTavern/public/scripts/extensions/third-party
   git clone https://github.com/Mooooooon/CosmosMemory.git
   ```
2. 安装依赖并启动编译：
   Install dependencies and build:
   ```bash
   cd CosmosMemory
   pnpm install
   pnpm build
   ```
3. 刷新或重启 SillyTavern，并在侧边栏的扩展菜单中启用 `CosmosMemory`。
   Refresh or restart SillyTavern, and open the `CosmosMemory` drawer under the extension menu.

### 开发命令 / Developer Commands

在 `CosmosMemory` 目录下可以运行以下命令：
Run these commands in the `CosmosMemory` root directory:

- **安装依赖 / Install Dependencies**:
  ```bash
  pnpm install
  ```
- **单次构建 / Production Build**:
  ```bash
  pnpm build
  ```
- **持续监听并构建 (开发模式) / Development Watch Build**:
  ```bash
  pnpm watch
  ```
- **代码格式化 / Prettier Formatting**:
  ```bash
  pnpm format
  ```
- **代码静态检查 / ESLint Checking & Fixing**:
  ```bash
  pnpm lint
  pnpm lint:fix
  ```

---

## 许可证 / License

- [Aladdin](LICENSE)
