🌐 [한국어](README.ko.md) | [English](README.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**基于多 AI 模型的开发团队模拟**

将 Claude Code、Gemini CLI、Codex CLI 分配给各个角色，
自动化完成从会议 → 设计 → 开发 → 评审 → QA → PR 创建的全流程。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                       Polymeld                              │
│                  (Node.js 编排器)                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  REPL Shell (Interactive)   ←→   Session (上下文保持)       │
│  状态栏、命令菜单、             SessionStore (磁盘存储)     │
│  Tab 自动补全、多行输入         Phase 检查点/恢复           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  validateConnections: CLI 安装 → 认证 → GitHub 验证 + 范围  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PipelineState              PromptAssembler                 │
│  (单一状态存储)             (按Phase差异化令牌预算)         │
│                                                             │
│  ResponseParser             ModelAdapter                    │
│  (LLM 响应结构化解析)       (CLI 抽象化 + thinking 映射)    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Claude   │    │ Gemini   │    │ Codex    │              │
│  │ Code CLI │    │ CLI      │    │ CLI      │              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │                     │
│  ┌────┴─────┐  ┌────┴─────┐   ┌────┴─────┐               │
│  │ 林架构    │  │ 刘创新   │   │ 韩码杰   │               │
│  │ (组长)    │  │ 姜策远   │   │ (王牌)   │               │
│  │ 安盾强    │  │ 尹悦然*  │   │ 郑测安   │               │
│  └──────────┘  │ 画灵秀*  │   └──────────┘               │
│                └──────────┘                                │
│                └─────────────┘                              │
│  * 生成图像时使用 Nano Banana 2                             │
│  会议中通过 [PASS] 自主控制参与                             │
│                                                             │
├──────────────────────────┬──────────────────────────────────┤
│   LocalWorkspace         │       GitHub Integration         │
│   (本地 Git 仓库联动)     │  Issues │ Comments │ Projects   │
│   文件浏览/读取/写入       │  Branches │ PRs │ Commits      │
│   git branch/commit/push │  空仓库自动初始化                │
└──────────────────────────┴──────────────────────────────────┘
```

## 安装

```bash
npm install -g polymeld
```

## 快速开始

```bash
# 1. 安装 CLI 工具（如未安装）
npm install -g @anthropic-ai/claude-code  # Claude Code
npm install -g @google/gemini-cli          # Gemini CLI
npm install -g @openai/codex               # Codex CLI

# 3. 初始设置（交互式向导）
polymeld init --global      # 全局配置 + 凭证输入
# 或不带参数运行，会自动启动引导向导：
polymeld

# 4.（可选）关联本地工作区
# 在目标项目目录中运行即可自动检测：
cd ~/projects/my-app && polymeld start
# 或在配置文件中指定：
#   project:
#     local_path: ~/projects/my-app

# 5. 验证配置（CLI 认证 + GitHub 集成自动验证）
polymeld test-models

# 6. 运行！
polymeld run "实现用户认证功能（邮箱/密码 + OAuth）"

# 7. 指定语言（可选，未指定时自动检测 OS 区域设置）
polymeld run "聊天功能" --lang en   # English
polymeld run "聊天功能" --lang ja   # 日本語
polymeld run "聊天功能" --lang zh-CN # 中文(简体)

```

> **首次运行引导**：不带参数运行 `polymeld` 时，如果不存在全局配置，将引导完成引导向导（模型选择 → 凭证输入），然后自动进入 REPL 模式。

## 配置

### 环境变量（.env 文件）

在项目根目录创建 `.env` 文件进行配置（`dotenv` 自动加载）：

```bash
# 复制 .env.example 使用
cp .env.example .env
```

```bash
# GitHub Personal Access Token
# - Classic PAT: repo（必需）+ project（可选，用于 Projects 看板）范围
# - Fine-grained PAT: Issues、Contents、Pull requests 写入权限
GITHUB_TOKEN=ghp_xxxxx
GITHUB_REPO=owner/repo            # 目标仓库（owner/repo 格式）
```

> **启动时自动验证**：按顺序检查 CLI 安装 → CLI 认证 → GitHub 集成 + 令牌范围。Classic PAT 缺少 `project` 范围时会显示警告。

> 注意：AI CLI 工具的 API 密钥由各 CLI 自行管理（请按照各 CLI 的认证方式操作）。

### 配置文件加载顺序

配置按层级合并（下层覆盖上层）：

| 优先级 | 路径 | 用途 |
|--------|------|------|
| 1（最高） | `-c` 标志 | 仅使用指定的文件 |
| 2 | `~/.polymeld/config.yaml` | 全局设置（所有项目通用） |
| 3 | `.polymeld/config.yaml` | 项目共享设置（git 提交对象） |
| 4 | `.polymeld/config.local.yaml` | 项目本地设置（个人用，.gitignore） |
| 5 | `polymeld.config.yaml` | 旧版兼容 |

### 凭证管理

凭证安全存储在 `~/.polymeld/credentials.yaml`（文件权限 `0600`）：

```yaml
# ~/.polymeld/credentials.yaml
GITHUB_TOKEN: ghp_xxxxx
GITHUB_REPO: owner/repo
ANTHROPIC_API_KEY: sk-...
GOOGLE_API_KEY: AIzaSy...
OPENAI_API_KEY: sk-...
```

**加载优先级**：`.env`（dotenv） → `~/.polymeld/credentials.yaml` → 环境变量（`process.env` 优先）

> 使用 `polymeld auth` 交互式输入凭证，或使用 `polymeld auth --show` 查看当前凭证状态。

### config.yaml 配置项

#### 项目设置（本地工作区）

配置代理参考现有代码，并将生成的代码直接保存为本地文件：

```yaml
# 指定本地 Git 仓库路径后，代理会参考现有代码进行开发。
# 未设置时自动检测当前目录的 .git。
project:
  local_path: ~/projects/my-app
```

> **自动检测**：即使不设置 `project.local_path`，在目标项目目录中运行 Polymeld 也会自动检测 `.git` 并用作工作区。

#### 模型定义

定义要使用的 AI 模型及 CLI 映射：

```yaml
models:
  claude:
    cli: claude
    model: claude-opus-4-6
    fallback: gemini               # rate limit 时切换的模型
  gemini:
    cli: gemini
    model: gemini-3.1-pro-preview
    fallback: claude
  codex:
    cli: codex
    model: gpt-5.4
    fallback: claude
  gemini_image:
    cli: gemini
    model: gemini-3.1-flash-image    # Nano Banana 2（图像生成专用）
```

#### fallback（Rate Limit 自动切换）

为模型设置 `fallback` 字段后，当遇到 rate limit 时会自动切换到备用模型：

- **CLI → API → fallback** 3 级优先级链
- CLI 使用量超限时自动切换到 API key 后端
- API key 也遇到 rate limit 时切换到 `fallback` 模型
- 从 stderr 自动检测 rate limit 模式（`Rate limit reached`、`Resource exhausted`、`usage limit` 等）

#### CLI 执行设置

```yaml
cli:
  timeout: 600000          # 默认超时 10 分钟（毫秒）
  timeouts:
    claude:                # 双重超时（idle + max）
      idle: 300000         #   5 分钟：最后输出后无响应时终止（有输出则重置）
      max: 1800000         #   30 分钟：绝对上限（防止无限循环）
    gemini: 600000         # 也支持单一超时（10 分钟）
    codex:
      idle: 300000
      max: 1800000
  max_turns:
    claude: 10             # Claude 智能体循环最大轮次
```

> **双重超时**：`idle` 在每次有输出时重置，防止活跃进程被提前终止。`max` 为绝对上限，防止无限循环。也向后兼容单一数值。

#### 角色分配

为每个角色分配模型。所有角色都参与会议，没有要贡献的内容时通过 `[PASS]` 自主跳过：

```yaml
personas:
  tech_lead:
    name: 林架构
    model: claude
    thinking_budget: 100      # 按角色覆盖（0-100）

  ace_programmer:
    name: 韩码杰
    model: codex

  creative_programmer:
    name: 刘创新
    model: gemini

  qa:
    name: 郑测安
    model: codex
    thinking_budget: 100

  designer:
    name: 尹悦然
    model: gemini             # 对话/设计时使用 Gemini 3.1 Pro
    image_model: gemini_image # 图像生成时使用 Nano Banana 2
```

#### image_model（图像生成）

设置 `image_model` 字段后，该角色可以执行图像生成任务：
- **对话/设计/评审**：使用默认 `model`（例如 Gemini 3.1 Pro）
- **图像生成**：使用 `image_model`（例如 Nano Banana 2）
- 图像任务自动检测：任务标题/描述中包含设计、原型、图标、插图等关键词时
- `image_model` 为可选项 — 未设置时作为纯文本代理运行

#### thinking_budget（AI 思考深度）

以 0-100 的刻度控制 AI 模型的推理深度：

```yaml
pipeline:
  thinking_budget: 70         # 全局默认值（0-100）

personas:
  tech_lead:
    thinking_budget: 100      # 按角色覆盖
```

各 CLI 转换规则：
| CLI | 参数 | 转换 |
|-----|---------|------|
| Claude | `--effort` | 0-33: low, 34-75: medium, 76-100: high |
| Codex | `-c model_reasoning_effort` | 0-25: low, 26-60: medium, 61-85: high, 86-100: xhigh |
| Gemini | (CLI 不支持此标志) | 仅通过 settings.json `thinkingConfig` 控制 |

API 后端使用时的转换：
| API | 参数 | 转换 |
|-----|---------|------|
| Claude (Anthropic) | `thinking.budget_tokens` | 0-33: 禁用、34-75: 4096、76-100: 16384 |
| Gemini (Google) | `thinkingConfig.thinkingBudget` | 0-33: 1024、34-75: 8192、76-100: 24576 |
| OpenAI | `reasoning_effort` | 0-25: low、26-60: medium、61-100: high |

#### parallel_development（并行执行）

在 Phase 5（开发）中，对没有依赖关系的任务同时执行 LLM 调用：

```yaml
pipeline:
  parallel_development: true    # 默认值: true
```

- `true`：分析依赖关系图，按批次并行执行独立任务
- `false`：保持现有顺序执行方式
- Git 操作（分支创建、提交）为防止冲突始终通过串行队列处理

#### 会议系统

**实时发言预览**：会议中实时在 spinner 上显示各 AI 响应的生成过程，完成后永久输出内容：

```
⠇ 韩码杰 发言中... 这部分可以用 O(n log n) 解决
✓ 韩码杰: 这部分可以用 O(n log n) 解决。使用分治法...
```

**自主跳过 (`[PASS]`)**：角色在相关话题无贡献内容时通过 `[PASS]` 自动跳过。会议记录中会保留跳过记录。

**提前结束 (`[CONCLUDE]`)**：组长判断讨论已充分时，通过 `[CONCLUDE]` 跳过剩余轮次结束会议。

**轮次显示**：会议轮次切换时显示轮次编号。

**Issue 标题自动生成**：会议记录 GitHub Issue 的标题由组长 AI 生成一行摘要。

### 角色配置（默认值）

| 角色 | 职责 | 模型 | 图像模型 | thinking |
|---------|------|------|-----------|----------|
| 林架构 | Tech Lead（组长） | Claude Opus 4.6 | - | 100 |
| 韩码杰 | Ace Programmer | GPT-5.4 | - | - |
| 刘创新 | Creative Programmer | Gemini 3.1 Pro | - | - |
| 郑测安 | QA Engineer | GPT-5.4 | - | 100 |
| 姜策远 | Ace Planner | Gemini 3.1 Pro | - | - |
| 安盾强 | Security Expert | Claude Opus 4.6 | - | - |
| 尹悦然 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 | - |
| 画灵秀 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 | - |

> 所有角色都参与会议。在不相关的话题中通过 `[PASS]` 自主跳过，组长可通过 `[CONCLUDE]` 提前结束会议。

## 使用方法

### 运行完整流水线
```bash
# 全自动模式（默认）— 自动推进所有 Phase
polymeld run "实现实时聊天功能"

# 指定交互模式
polymeld run "聊天功能" --mode full-auto   # 默认
polymeld run "聊天功能" --mode semi-auto   # 每个 Phase 确认
polymeld run "聊天功能" --mode manual      # 手动控制
```

> 项目标题从工作区名称自动派生。

### 仅进行会议
```bash
# 启动会议
polymeld meeting kickoff "实现用户认证功能"

# 技术设计会议（3 轮讨论）
polymeld meeting design "迁移到微服务架构" --rounds 3
```

### 模型连接测试
```bash
polymeld test-models
```

### 交互式 REPL 模式
```bash
# 启动 REPL
polymeld start

# 恢复上一个会话（最近的会话）
polymeld start --resume

# 恢复指定会话
polymeld start --resume <sessionId>

# 指定交互模式
polymeld start --mode full-auto
```

在 REPL 模式下，在提示符中输入自然语言需求即可运行完整流水线。
执行结束后返回提示符，可以下达新的命令。
会话上下文（PipelineState、执行历史）会被保持。

**REPL 功能：**
- **状态栏**：在提示符中实时显示当前会话状态
- **命令菜单**：输入 `/` 时显示可搜索的命令菜单（inquirer）
- **Tab 自动补全**：斜杠命令自动补全
- **多行输入**：通过 Bracketed Paste Mode 支持多行粘贴

**斜杠命令：**

| 命令 | 说明 |
|--------|------|
| `/help` | 可用命令列表 |
| `/status` | 当前会话状态 |
| `/history` | 流水线执行历史 |
| `/context` | PipelineState 状态查看 |
| `/team` | 团队配置查看 |
| `/resume` | 恢复中断的流水线（基于 Phase 检查点） |
| `/save` | 保存会话 |
| `/load [id]` | 恢复会话 |
| `/exit` | 退出 REPL |

### 初始化配置
```bash
# 初始化全局配置（~/.polymeld/ 中创建 config.yaml + credentials.yaml）
polymeld init --global

# 初始化项目配置（.polymeld/config.yaml）
polymeld init
```

### 凭证管理
```bash
# 交互式输入令牌/API 密钥
polymeld auth

# 查看当前凭证状态（已脱敏）
polymeld auth --show
```

## 本地工作区联动

将本地 Git 仓库指定为工作区后，代理可以**读取并参考现有代码进行开发**，并将生成的代码**直接保存到本地文件系统**。

### 工作方式

| 功能 | 设置工作区时 | 未设置时 |
|------|---------------------|----------|
| 代码参考 | 将现有文件结构/内容包含在 LLM 提示中 | 仅参考设计文档 |
| 代码保存 | 直接保存为本地文件 + `git commit` | 通过 GitHub API 提交 |
| 分支管理 | 本地 `git checkout -b` | 通过 GitHub API 创建分支 |
| PR 创建 | 本地 `git push` → GitHub PR | 仅使用 GitHub API |

### 工作区检测优先级

1. 配置文件中的 `project.local_path` 设置
2. 当前目录的 `.git` 自动检测（排除 Polymeld 自身仓库）
3. 未检测到时以 `NoOpWorkspace` 使用 GitHub API 专用模式

> 设置 `local_path` 后，CLI 进程在该路径下运行，因此代理可以直接读写该项目的文件。

### 空 GitHub 仓库自动初始化

当 `GITHUB_REPO` 指定的仓库为空时，会自动：
1. 创建 Initial Commit
2. 使用 `GITHUB_REPO` 的值设置 origin remote

无需手动初始化即可直接使用。

### 开发 Phase 中的行为

关联工作区后，在 Phase 5（开发）中：
- 缓存目录结构树并提供给 LLM
- 按任务基于关键词搜索相关文件，提供代码上下文
- 按任务自动创建 feature 分支（`feature/{issueNumber}-{精简title}`）
- 基于依赖关系并行执行：独立任务的 LLM 调用同时执行（Git 操作通过串行队列）
- 将生成的代码保存为本地文件后执行 `git add` + `git commit`
- Phase 6（评审）/ Phase 7（QA）修改时也在本地重新提交

## 流水线详情

```
Phase 0: 代码库分析（修改模式 + 本地工作区时）
  → 分析现有代码库结构和模式
  → 分析结果在后续 Phase 中作为上下文使用

Phase 1: 启动会议
  → 各角色使用各自的 AI 模型发表意见
  → 不相关的角色通过 [PASS] 自主跳过
  → 组长可通过 [CONCLUDE] 在充分讨论后提前结束
  → Issue 标题由组长 AI 生成一行摘要
  → 会议记录自动注册到 GitHub Issue
  → 启动摘要（kickoffSummary）注入后续代理提示

Phase 2: 技术设计会议
  → 模拟角色间意见冲突/共识
  → 不同模型从不同角度进行讨论
  → [PASS] / [CONCLUDE] 同样适用
  → 设计决策文档注册到 GitHub Issue

Phase 3: 任务分解
  → 组长将任务分解为 1-4 小时的单元
  → 每个任务创建为 GitHub Issue（backlog 标签）

Phase 4: 任务分配
  → 组长将每个任务分配给合适的角色
  → 图像任务优先分配给拥有 image_model 的代理
  → 分配理由记录为 Issue Comment

Phase 5: 开发（基于依赖关系的并行执行）
  → 分析任务间依赖关系，并行执行独立任务
  → LLM 调用并行执行，Git 操作通过串行队列防止冲突
  → 图像任务：使用 image_model 生成图像（保存到 output/images/）
  → 提交到 feature 分支
  → 进度以 Issue Comment 形式更新

Phase 6: 代码评审
  → 组长评审其他模型编写的代码
  → ResponseParser 提取 APPROVED / CHANGES_REQUESTED 判定
  → 需要修改时，组长直接编写修复代码并重新提交
  → 评审结果记录为 Issue Comment

Phase 7: QA
  → QA 验证代码
  → ResponseParser 提取 PASS / FAIL 判定
  → 失败时组长直接修复并重新提交
  → 测试结果以表格形式记录在 Issue Comment 中

Phase 8: PR 创建
  → 自动创建包含所有历史记录（会议记录、评审、QA）链接的 PR
```

> **Phase 检查点**：每个 Phase 完成时保存检查点，中断时可通过 `/resume` 从该 Phase 恢复。

## 内部架构

### 核心组件

| 组件 | 职责 | 说明 |
|---------|------|------|
| **PipelineState** | 单一状态存储 | 以显式字段管理项目/任务/消息/召集记录 |
| **PromptAssembler** | 令牌预算上下文组装 | 按作业类型仅提取所需信息构建 LLM 提示（包含代码库上下文） |
| **ResponseParser** | LLM 响应结构化解析 | JSON 提取 + 关键词回退提取判定（verdict） |
| **LocalWorkspace** | 本地 Git 仓库联动 | 文件浏览/读取/写入 + git 分支/提交/推送自动化 |
| **validateConnections** | 启动时连接验证 | CLI 安装 → 认证 → GitHub 令牌/权限/范围确认并实时显示 |

### PipelineState 字段目录

```
project.requirement     - 原始需求文本
project.title           - 项目标题（从工作区自动派生）
kickoffSummary          - 启动会议摘要（注入后续代理提示）
designDecisions         - 设计决策事项
techStack               - 技术栈
tasks[]                 - 分解的任务列表（包含代码/评审/QA 结果）
completedTasks[]        - 已完成的任务
messages[]              - 代理间全部消息
codebaseAnalysis        - Phase 0 代码库分析结果
completedPhases[]       - 已完成的 Phase 检查点（恢复时使用）
github.kickoffIssue     - GitHub 启动 Issue 编号
github.designIssue      - GitHub 设计 Issue 编号
```

### PromptAssembler — 按 Phase 差异化令牌预算

| Phase | 方法 | 预算 | 原因 |
|-------|--------|------|------|
| 会议 | `forMeeting()` | 8,000 字符 | 之前的发言较多，需要平衡调节 |
| 编码 | `forCoding()` | 12,000 字符 | 代码质量优先（最大预算） |
| 修复 | `forFix()` | 10,000 字符 | 反馈 + 设计上下文 |
| 评审 | `forReview()` | 6,000 字符 | 代码另行传递 |
| QA | `forQA()` | 4,000 字符 | 仅需评审结果 |
| 图像 | `forImageGeneration()` | 6,000 字符 | 图像生成提示 |

### ResponseParser — LLM 响应解析

| 方法 | 用途 | 返回值 |
|--------|------|------|
| `parseTasks()` | Phase 3 任务分解 | 结构化任务数组 |
| `parseReviewVerdict()` | Phase 6 代码评审 | APPROVED / CHANGES_REQUESTED |
| `parseQAVerdict()` | Phase 7 QA | PASS / FAIL |

### 项目结构

```
src/
├── index.js                    # CLI 入口（Commander.js）+ dotenv 加载
├── i18n/
│   ├── index.js                # i18next 初始化 + t() 翻译函数
│   ├── detect-locale.js        # OS 区域设置自动检测（LC_ALL → LANG → Intl）
│   └── locales/
│       ├── en.json             # English
│       ├── ko.json             # 한국어
│       ├── ja.json             # 日本語
│       └── zh-CN.json          # 中文(简体)
├── config/
│   ├── loader.js               # YAML 配置加载器（层级合并）+ CLI/GitHub 连接验证
│   ├── init.js                 # 交互式设置初始化向导（全局/项目）
│   ├── credentials.js          # 凭证管理（~/.polymeld/credentials.yaml）
│   ├── paths.js                # 跨平台路径工具
│   └── interaction.js          # 交互模式管理
├── models/
│   ├── adapter.js              # CLI 抽象化（claude/gemini/codex）+ thinking 映射
│   └── response-parser.js      # LLM 响应结构化解析
├── agents/
│   ├── agent.js                # 单个代理（角色）
│   └── team.js                 # 团队管理器（基于 [PASS] 的自主参与）
├── state/
│   ├── pipeline-state.js       # 单一状态存储（包含 Phase 检查点）
│   └── prompt-assembler.js     # 按 Phase 差异化令牌预算上下文组装器
├── pipeline/
│   └── orchestrator.js         # 9-Phase 流水线（Phase 0~8 + 并行执行 + 检查点）
├── workspace/
│   ├── local-workspace.js      # 本地 Git 仓库（文件浏览/读取/写入 + git CLI）
│   └── noop-workspace.js       # 未设置工作区时的 No-op 客户端
├── repl/
│   ├── repl-shell.js           # REPL 循环（状态栏 + 命令菜单）
│   ├── command-router.js       # 斜杠命令路由 + Tab 自动补全
│   ├── status-bar.js           # 状态栏渲染
│   ├── slash-menu.js           # 内联搜索斜杠菜单（直接 stdin 处理）
│   ├── paste-detect-stream.js  # Bracketed Paste Mode（多行输入）
│   └── commands/               # 斜杠命令处理器
│       ├── help.js
│       ├── status.js
│       ├── history.js
│       ├── context.js
│       ├── team.js
│       ├── resume.js
│       ├── save.js
│       └── load.js
├── session/
│   ├── session.js              # 会话（PipelineState + 工作区 + 执行历史）
│   └── session-store.js        # 会话磁盘存储/恢复
└── github/
    └── client.js               # GitHub API（Issues、PRs、Projects）+ 空仓库自动初始化
test/
├── response-parser.test.js     # ResponseParser 单元测试（包含多语言关键词匹配）
├── pipeline-state.test.js      # PipelineState 单元测试
├── prompt-assembler.test.js    # PromptAssembler 单元测试
├── paste-detect-stream.test.js # Bracketed Paste Mode 测试
├── slash-menu.test.js          # 斜杠菜单内联搜索测试
├── i18n.test.js                # 翻译键同步验证（4 种语言一致）
└── team.test.js                # Team 角色规范化测试
```

## GitHub 中记录的项目

所有过程都以可追溯的方式记录在 GitHub 中：

- **会议记录**：Issue（meeting-notes 标签）
- **任务**：Issue（backlog → todo → in-progress → done）
- **分配记录**：Issue Comment
- **开发日志**：Issue Comment + Commit
- **图像生成结果**：Issue Comment（文件路径 + 文本说明）
- **角色间讨论**：Issue Comment
- **代码评审**：Issue Comment
- **QA 结果**：Issue Comment
- **最终交付物**：Pull Request

每条记录都标注了执行该操作的 AI CLI（例如 `[claude]`、`[gemini]`、`[codex]`）。

## Claude Code 集成

可以在 Claude Code 中调用此 CLI：

```bash
# 在 Claude Code 中
polymeld run "需求说明" --no-interactive
```

或注册到 CLAUDE.md：
```markdown
## Polymeld
当给出项目需求时，运行 Polymeld CLI：
`polymeld run "需求说明" --no-interactive`
```

## 角色自定义

可以在配置文件（`config.yaml`）中添加/修改角色：

```yaml
personas:
  devops:
    name: 최배포
    role: DevOps Engineer
    model: codex
    description: "痴迷于 CI/CD 和基础设施自动化。追求部署流水线的完美。"
    expertise:
      - CI/CD 流水线构建
      - 容器编排
      - 基础设施自动化

  concept_artist:
    name: 이컨셉
    role: Concept Artist
    model: gemini              # 讨论/策划时使用文本模型
    image_model: gemini_image  # 图像生成时使用图像模型
    description: "概念艺术和视觉设计专家"
    expertise:
      - 概念艺术制作
      - 角色/背景设计
```

> 所有角色都参与会议，在不相关的话题中通过 `[PASS]` 自主跳过。无需额外的 on_demand 设置。

## 多语言支持（i18n）

CLI UI、AI 系统提示、GitHub 评论等所有文本均提供 4 种语言版本：

| 语言 | 代码 | 设置方法 |
|------|------|----------|
| 한국어 | `ko` | `--lang ko` 或 OS 区域设置 |
| English | `en` | `--lang en` 或 OS 区域设置 |
| 日本語 | `ja` | `--lang ja` 或 OS 区域设置 |
| 中文(简体) | `zh-CN` | `--lang zh-CN` 或 OS 区域设置 |

**区域设置检测优先级**：`--lang` 标志 → 环境变量（`LC_ALL`、`LC_MESSAGES`、`LANG`） → `Intl` API → `en`（默认值）

AI 响应解析也支持多语言：代码评审判定（`APPROVED`/`승인`/`承認`/`批准`）、QA 判定（`PASS`/`합격`/`合格`/`通过`）等均可跨语言识别。

## 许可证

MIT
