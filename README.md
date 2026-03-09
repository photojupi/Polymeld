🌐 [한국어](README.ko.md) | [English](README.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**Orchestrate multiple AI coding agents as a virtual dev team.**

Assign Claude Code, Gemini CLI, and Codex CLI to individual personas — automate the entire workflow from meetings to design, development, code review, QA, and PR creation.

## ✨ Features

- **🤖 Multi-AI Team** — 8 personas (Tech Lead, Programmer, QA, Designer, etc.) powered by Claude, Gemini, and Codex
- **🔄 8-Phase Pipeline** — Codebase analysis → Meeting → Task breakdown → Assignment → Development → Code review → QA → PR
- **🛠️ CLI + API Dual Backend** — Each model works via CLI or API SDK — use whichever is available, or both
- **⚡ Parallel Development** — Dependency-aware concurrent LLM execution for independent tasks
- **🖼️ Image Generation** — Personas with `image_model` auto-generate images via Nano Banana 2
- **📂 Local Workspace** — Reads existing code, writes files directly, manages git branches/commits
- **🔁 Auto-Fix Loop** — Failed reviews/QA trigger automatic fix → re-review cycles
- **💬 AI Meetings** — Real-time multi-model discussions with `[PASS]`/`[CONCLUDE]` self-regulation
- **📊 Token Usage Tracking** — See backend (CLI/API), model name, and token count after every action
- **🔀 3-Tier Rate Limit Fallback** — CLI → API key → fallback model — automatic switching on rate limit
- **🌐 4-Language i18n** — Full support for English, 한국어, 日本語, 中文
- **📌 Full GitHub Traceability** — Every step recorded as Issues, Comments, Commits, and PRs

## 🚀 Quick Start

```bash
# 1. Install Polymeld
npm install -g polymeld

# 2. Install AI CLIs (only the ones you need)
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @google/gemini-cli           # Gemini CLI
npm install -g @openai/codex                # Codex CLI

# 3. Run from your project folder — onboarding wizard starts automatically
cd ~/projects/my-app
polymeld
# → Model selection → GitHub token setup → Done!
# → GITHUB_REPO is auto-detected from git remote
```

## 📋 Commands

| Command | Description |
|---------|-------------|
| `polymeld` | Start REPL (onboarding wizard on first run) |
| `polymeld run "requirement"` | Run full pipeline |
| `polymeld run "req" --mode semi-auto` | Confirm at each phase |
| `polymeld meeting "topic"` | Run meeting only |
| `polymeld start --resume` | Resume previous session |
| `polymeld test-models` | Test model connections |
| `polymeld init --global` | Initialize global config |
| `polymeld auth` | Manage credentials interactively |

**REPL Slash Commands:** `/help` `/status` `/history` `/context` `/team` `/mode` `/resume` `/save` `/load` `/exit`

## ⚙️ Pipeline

```
Phase 0  Codebase Analysis     Analyze existing code structure (if local workspace)
Phase 1  Planning Meeting      Multi-AI discussion → design decisions
Phase 2  Task Breakdown        Split into 1-4 hour tasks → GitHub Issues
Phase 3  Assignment            Match tasks to best-fit personas
Phase 4  Development           Parallel coding → feature branches → commits
Phase 5  Code Review           Lead reviews → auto-fix → re-review (×3)
Phase 6  QA                    Verify → auto-fix → re-verify (×3)
Phase 7  PR Creation           Auto-create PR linking all artifacts
```

> **Checkpoints**: Each phase saves a checkpoint. Use `/resume` to restart from any phase.

## 📌 GitHub Issues & Kanban Board

Polymeld uses **GitHub Issues** and **GitHub Projects V2** Kanban boards to automatically track the entire pipeline.

### Auto-Created Issues

| Phase | Issue Created | Labels |
|-------|--------------|--------|
| Phase 1 | 📝 **Planning Issue** — Meeting notes & decisions | `meeting-notes`, `planning`, `polymeld` |
| Phase 2 | 🔧 **Task Issue** — One per decomposed task | `backlog`, `polymeld`, `{{category}}` |

### 6-Column Kanban

Issues automatically move across the Kanban board as the pipeline progresses:

```
Backlog → Todo → In Progress → In Review → QA → Done
```

| Column | Transition Point | Label Change |
|--------|-----------------|--------------|
| **Backlog** | Phase 2: After task breakdown | `backlog` |
| **Todo** | Phase 3: Assigned to persona | `todo`, `assigned:{{agent}}` |
| **In Progress** | Phase 4: Development starts | `in-progress` |
| **In Review** | Phase 5: Code review in progress | `in-review` |
| **QA** | Phase 6: QA in progress | `qa` |
| **Done** | Phase 6: QA passed → Issue auto-closed | `done` |

### Auto-Comments

Comments are automatically added to issues at each phase transition for full traceability:

- 🧑‍💼 **Assignment** — Assignee, reasoning
- 🚀 **Dev start/complete** — Agent name, model, code preview
- 🔍 **Code review** — Review result (with attempt count)
- 🧪 **QA result** — Verification result, fix history

### PR ↔ Issue Linking

The PR created in Phase 7 references all completed Task Issues with `Closes #N`, so merging the PR automatically closes related issues.

> The pipeline runs without a GitHub token too — only GitHub features are disabled.

## 👥 Default Team

| Persona | Role | Model | Image |
|---------|------|-------|-------|
| Archie Stone | Tech Lead (Team Lead) | Claude Opus 4.6 | — |
| Cody Sharp | Ace Programmer | GPT-5.4 | — |
| Nova Cruz | Creative Programmer | Gemini 3.1 Pro | — |
| Max Planner | Ace Planner | Gemini 3.1 Pro | — |
| Sam Shield | Security Expert | Claude Opus 4.6 | — |
| Eve Fielding | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 |
| Iris Bloom | Illustrator | Gemini 3.1 Pro | Nano Banana 2 |
| Tess Hunter | QA Engineer | GPT-5.4 | — |

> All personas join meetings. They self-regulate via `[PASS]` (skip) and `[CONCLUDE]` (end early).

## 🔧 Configuration

### Backend Priority

Each model supports **two backends** that switch automatically:

| Priority | Backend | When Used |
|----------|---------|----------|
| 1st | **CLI** (claude / gemini / codex) | Installed and available |
| 2nd | **API SDK** (Anthropic / Google GenAI / OpenAI) | CLI rate-limited, or CLI not installed |
| 3rd | **Fallback model** | Both CLI and API rate-limited |

> CLI only, API only, or both — Polymeld works with whatever you have. Set `api_model` to use a different model for API calls.

### Credentials

```bash
polymeld auth                  # Interactive setup
polymeld auth --show           # Check current status
```

Or use `.env` / `~/.polymeld/credentials.yaml`:

```bash
GITHUB_TOKEN=ghp_xxxxx        # Required
# GITHUB_REPO=owner/repo      # Auto-detected from git remote

# API keys (optional — enables API backend per provider)
ANTHROPIC_API_KEY=sk-...       # Claude API
GOOGLE_API_KEY=AIzaSy...       # Gemini API (required for image generation)
OPENAI_API_KEY=sk-...          # OpenAI API
```

### config.yaml

Config files are merged hierarchically: `-c` flag > `~/.polymeld/config.yaml` (global) > `.polymeld/config.yaml` (project) > `.polymeld/config.local.yaml` (local).

```yaml
# Model definitions
models:
  claude:
    cli: claude
    model: claude-opus-4-6
    fallback: gemini             # Switch on rate limit
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
    model: gemini-3.1-flash-image-preview  # Nano Banana 2 (requires GOOGLE_API_KEY)

# Persona assignment
personas:
  tech_lead:
    name: Archie Stone
    model: claude
    thinking_budget: 50          # AI reasoning depth (0-100)
  designer:
    name: Eve Fielding
    model: gemini
    image_model: gemini_image    # Enable image generation

# Pipeline settings
pipeline:
  parallel_development: true     # Concurrent LLM calls
  thinking_budget: 25            # Global default (0-100)
  max_review_retries: 3
  max_qa_retries: 3
```

### Custom Personas

```yaml
personas:
  devops:
    name: Alex Deploy
    role: DevOps Engineer
    model: codex
    description: "CI/CD and infrastructure automation specialist"
    expertise:
      - CI/CD pipelines
      - Container orchestration
```

## 🌐 Multilingual Support

| Language | Flag | Auto-detect |
|----------|------|-------------|
| English | `--lang en` | OS locale |
| 한국어 | `--lang ko` | OS locale |
| 日本語 | `--lang ja` | OS locale |
| 中文(简体) | `--lang zh-CN` | OS locale |

AI response parsing is also multilingual — verdicts like `APPROVED`/`승인`/`承認`/`批准` are recognized across all languages.

## Claude Code Integration

```bash
polymeld run "requirements" --no-interactive
```

Or register in `CLAUDE.md` for automatic invocation.

## 🧠 Agent Communication Architecture

Agents never talk to each other directly. All communication flows through **PipelineState** (shared state) and **PromptAssembler** (context mediator).

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     PipelineState                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ messages  │ │  tasks   │ │  design  │ │ codebase  │  │
│  │   []      │ │   []     │ │ Decisions│ │ Analysis  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │ read
              ┌──────┴──────┐
              │   Prompt    │  Selects relevant context
              │  Assembler  │  within token budget
              └──────┬──────┘
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐
     │Tech Lead│ │Developer│ │   QA    │
     │ (Claude)│ │(Gemini) │ │(Codex)  │
     └────┬────┘ └────┬────┘ └────┬────┘
          │ write      │ write     │ write
          └────────────┴───────────┘
                       │
              back to PipelineState
```

### Communication Patterns

| Pattern | Flow | Example |
|---------|------|---------|
| **Meeting Speech** | Agent → `messages[]` → next Agent | Round-robin discussion, each agent sees prior speeches |
| **Design → Code** | `designDecisions` → Developer | Meeting output becomes coding context |
| **Code → Review** | `task.code` → Tech Lead | Written code passed to reviewer |
| **Review → Fix** | `task.review` → Developer | Review feedback triggers fix cycle |
| **QA → Fix** | `task.qa` → Tech Lead | QA failure triggers lead's direct fix |

### Message Flow Example

```
Phase 1 — Meeting
  Archie speaks → message saved → Nova reads it → speaks → ...
  Final output: designDecisions, techStack

Phase 4 — Development
  PromptAssembler.forCoding()
    → designDecisions (30%)
    → codebaseAnalysis (50%)      ← token budget allocation
    → techStack (remaining)
  Developer writes code → task.code + task.filePaths

Phase 5–6 — Review & QA Fix Cycle
  Lead.reviewCode(task.code)
    → verdict: "approved" | "changes_requested"
    → if changes_requested → Lead.writeCode(review + code)
  QA.runQA(task.filePaths)
    → verdict: "pass" | "fail"
    → if fail → Lead.writeCode(qa + code) → re-QA (×3 max)
```

> Each agent only sees what PromptAssembler provides — not the full state. This keeps prompts focused and within model context limits.

## License

MIT
