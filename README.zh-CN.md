🌐 [한국어](README.ko.md) | [English](README.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**将多个 AI 编码代理编排为虚拟开发团队。**

将 Claude Code、Gemini CLI、Codex CLI 分配给各个角色，自动化完成会议 → 设计 → 开发 → 代码评审 → QA → PR 创建的全流程。

## ✨ 核心特性

- **🤖 多 AI 团队** — 8 个角色（技术负责人、程序员、QA、设计师等）分别由 Claude、Gemini、Codex 驱动
- **🔄 8 阶段流水线** — 代码库分析 → 会议 → 任务分解 → 分配 → 开发 → 代码评审 → QA → PR
- **🛠️ CLI + API 双后端** — 每个模型通过 CLI 或 API SDK 运行 — 有哪个用哪个，或两者兼用
- **⚡ 并行开发** — 分析依赖关系，独立任务同时执行
- **🖼️ 图像生成** — 配置 `image_model` 后通过 Nano Banana 2 自动生成图像
- **📂 本地工作区** — 读取现有代码、直接创建文件、自动管理 git 分支/提交
- **🔁 自动修复循环** — 评审/QA 失败时自动修复 → 重新验证
- **💬 AI 会议** — 实时多模型讨论，通过 `[PASS]`/`[CONCLUDE]` 自主调节
- **📊 Token 用量追踪** — 每个操作后显示后端（CLI/API）、模型名称和 Token 数量
- **🔀 3 级 Rate Limit 回退** — CLI → API key → 备用模型 — rate limit 时自动切换
- **🌐 4 语言 i18n** — 完整支持 English、한국어、日本語、中文
- **📌 GitHub 完整可追溯** — 全过程记录为 Issues、Comments、Commits 和 PR

## 🚀 快速开始

```bash
# 1. 安装 Polymeld
npm install -g polymeld

# 2. 安装 AI CLI（只需安装你要使用的）
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @google/gemini-cli           # Gemini CLI
npm install -g @openai/codex                # Codex CLI

# 3. 在项目文件夹中运行 — 引导向导自动启动
cd ~/projects/my-app
polymeld
# → 选择模型 → 设置 GitHub Token → 完成！
# → GITHUB_REPO 从 git remote 自动检测
```

## 📋 命令

| 命令 | 说明 |
|------|------|
| `polymeld` | 启动 REPL（首次运行时引导向导） |
| `polymeld run "需求"` | 运行完整流水线 |
| `polymeld run "需求" --mode semi-auto` | 每个 Phase 确认 |
| `polymeld meeting kickoff "主题"` | 仅运行启动会议 |
| `polymeld meeting design "主题" --rounds 3` | N 轮设计会议 |
| `polymeld start --resume` | 恢复上一个会话 |
| `polymeld test-models` | 测试模型连接 |
| `polymeld init --global` | 初始化全局配置 |
| `polymeld auth` | 交互式管理凭证 |

**REPL 斜杠命令：** `/help` `/status` `/history` `/context` `/team` `/mode` `/resume` `/save` `/load` `/exit`

## ⚙️ 流水线

```
Phase 0  代码库分析          分析现有代码结构（本地工作区时）
Phase 1  会议                多 AI 讨论 → 设计决策
Phase 2  任务分解            分解为 1-4 小时单元 → GitHub Issues
Phase 3  任务分配            将任务匹配到合适的角色
Phase 4  开发                并行编码 → feature 分支 → 提交
Phase 5  代码评审            组长评审 → 自动修复 → 重新评审 (×3)
Phase 6  QA                  验证 → 自动修复 → 重新验证 (×3)
Phase 7  PR 创建             自动创建包含所有记录链接的 PR
```

> **检查点**：每个 Phase 完成时保存。使用 `/resume` 从任意 Phase 恢复。

## 👥 默认团队

| 角色 | 职责 | 模型 | 图像 |
|------|------|------|------|
| 林架构 | Tech Lead（组长） | Claude Opus 4.6 | — |
| 韩码杰 | Ace Programmer | GPT-5.4 | — |
| 刘创新 | Creative Programmer | Gemini 3.1 Pro | — |
| 姜策远 | Ace Planner | Gemini 3.1 Pro | — |
| 安盾强 | Security Expert | Claude Opus 4.6 | — |
| 尹悦然 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 |
| 画灵秀 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 |
| 郑测安 | QA Engineer | GPT-5.4 | — |

> 所有角色参与会议。通过 `[PASS]`（跳过）和 `[CONCLUDE]`（提前结束）自主调节。

## 🔧 配置

### 后端优先级

每个模型支持自动切换的**双后端**：

| 优先级 | 后端 | 使用条件 |
|--------|------|----------|
| 第 1 | **CLI**（claude / gemini / codex） | 已安装且可用时 |
| 第 2 | **API SDK**（Anthropic / Google GenAI / OpenAI） | CLI rate limit 或未安装 CLI 时 |
| 第 3 | **Fallback 模型** | CLI 和 API 均 rate limit 时 |

> 仅 CLI、仅 API、或两者兼有 — 有什么用什么。设置 `api_model` 可为 API 调用指定不同的模型。

### 凭证

```bash
polymeld auth                  # 交互式设置
polymeld auth --show           # 查看当前状态
```

或使用 `.env` / `~/.polymeld/credentials.yaml`：

```bash
GITHUB_TOKEN=ghp_xxxxx        # 必需
# GITHUB_REPO=owner/repo      # 从 git remote 自动检测

# API 密钥（可选 — 按提供商启用 API 后端）
ANTHROPIC_API_KEY=sk-...       # Claude API
GOOGLE_API_KEY=AIzaSy...       # Gemini API（图片生成必需）
OPENAI_API_KEY=sk-...          # OpenAI API
```

### config.yaml

配置文件按层级合并：`-c` 标志 > `~/.polymeld/config.yaml`（全局）> `.polymeld/config.yaml`（项目）> `.polymeld/config.local.yaml`（本地）。

```yaml
# 模型定义
models:
  claude:
    cli: claude
    model: claude-opus-4-6
    fallback: gemini             # rate limit 时切换
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
    model: gemini-3.1-flash-image-preview  # Nano Banana 2（需要 GOOGLE_API_KEY）

# 角色分配
personas:
  tech_lead:
    name: 林架构
    model: claude
    thinking_budget: 100         # AI 思考深度（0-100）
  designer:
    name: 尹悦然
    model: gemini
    image_model: gemini_image    # 启用图像生成

# 流水线设置
pipeline:
  parallel_development: true     # 并行 LLM 调用
  thinking_budget: 50            # 全局默认值（0-100）
  max_review_retries: 3
  max_qa_retries: 3
```

### 自定义角色

```yaml
personas:
  devops:
    name: 云运维
    role: DevOps Engineer
    model: codex
    description: "CI/CD 和基础设施自动化专家"
    expertise:
      - CI/CD 流水线构建
      - 容器编排
```

## 🌐 多语言支持

| 语言 | 标志 | 自动检测 |
|------|------|----------|
| English | `--lang en` | OS 区域设置 |
| 한국어 | `--lang ko` | OS 区域设置 |
| 日本語 | `--lang ja` | OS 区域设置 |
| 中文(简体) | `--lang zh-CN` | OS 区域设置 |

AI 响应解析也支持多语言 — `APPROVED`/`승인`/`承認`/`批准` 等判定可跨语言识别。

## Claude Code 集成

```bash
polymeld run "需求" --no-interactive
```

注册到 `CLAUDE.md` 即可实现自动调用。

## 许可证

MIT
