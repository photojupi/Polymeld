🌐 [한국어](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**Multi-AI Model Development Team Simulation**

Assign Claude Code, Gemini CLI, and Codex CLI to individual personas, and automate the entire workflow from meetings to design, development, review, QA, and PR creation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Polymeld                               │
│                  (Node.js Orchestrator)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  REPL Shell (Interactive)   ←→   Session (Context Mgmt)     │
│  Status bar, Command menu,       SessionStore (Disk Save)   │
│  Tab completion, Multi-line      Phase Checkpoint/Resume    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  validateConnections: CLI Install → Auth → GitHub + Scopes  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PipelineState              PromptAssembler                 │
│  (Single State Store)       (Per-Phase Token Budget)        │
│                                                             │
│  ResponseParser             ModelAdapter                    │
│  (LLM Response Parsing)    (CLI Abstraction + Thinking Map) │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Claude   │    │ Gemini   │    │ Codex    │              │
│  │ Code CLI │    │ CLI      │    │ CLI      │              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │                     │
│  ┌────┴────┐   ┌──────┴──────┐  ┌─────┴─────┐             │
│  │ 김아키   │   │ 류창작      │  │ 한코딩    │              │
│  │ (Lead)   │   │ 강기획      │  │ (Ace)     │              │
│  │ 안보안   │   │ 윤경험*     │  │ 정테스트  │              │
│  └─────────┘   │ 그림솔*     │  └──────────┘              │
│                └─────────────┘                              │
│  * Uses Nano Banana 2 for image generation                  │
│  Voluntary [PASS] during meetings for self-regulation       │
│                                                             │
├──────────────────────────┬──────────────────────────────────┤
│   LocalWorkspace         │       GitHub Integration         │
│   (Local Git Repo Link)  │  Issues │ Comments │ Projects   │
│   File browse/read/write │  Branches │ PRs │ Commits      │
│   git branch/commit/push │  Auto-init for empty repos      │
└──────────────────────────┴──────────────────────────────────┘
```

## Installation

```bash
npm install -g polymeld
```

## Quick Start

```bash
# 1. Install CLI tools (if not already installed)
npm install -g @anthropic-ai/claude-code  # Claude Code
npm install -g @google/gemini-cli          # Gemini CLI
npm install -g @openai/codex               # Codex CLI

# 3. Initial setup (interactive wizard)
polymeld init --global      # Global config + credentials setup
# Or run without arguments to start the onboarding wizard automatically:
polymeld

# 4. (Optional) Local workspace integration
# Run from your target project directory for auto-detection:
cd ~/projects/my-app && polymeld start
# Or specify in your config file:
#   project:
#     local_path: ~/projects/my-app

# 5. Verify configuration (CLI auth + GitHub integration auto-validated)
polymeld test-models

# 6. Run!
polymeld run "Implement user authentication (email/password + OAuth)"

# 7. Specify language (optional; auto-detects OS locale if not set)
polymeld run "chat feature" --lang en   # English
polymeld run "chat feature" --lang ja   # 日本語
polymeld run "chat feature" --lang zh-CN # 中文(简体)

```

> **First-run onboarding**: Running `polymeld` without arguments will launch the onboarding wizard (model selection → credential input) if no global config exists, then automatically enter REPL mode.

## Configuration

### Environment Variables (.env file)

Create a `.env` file in the project root to configure settings (auto-loaded via `dotenv`):

```bash
# Copy from .env.example
cp .env.example .env
```

```bash
# GitHub Personal Access Token
# - Classic PAT: repo (required) + project (optional, for Projects board) scopes
# - Fine-grained PAT: Issues, Contents, Pull requests write permissions
GITHUB_TOKEN=ghp_xxxxx
GITHUB_REPO=owner/repo            # Target repository (owner/repo format)
```

> **Auto-validated on startup**: CLI installation, CLI authentication, GitHub integration, and token scopes are checked sequentially. A warning is shown if the Classic PAT is missing the `project` scope.

> Note: API keys for AI CLI tools are managed by each CLI independently (follow each CLI's authentication method).

### Config File Load Order

Configuration is merged hierarchically (lower layers override upper layers):

| Priority | Path | Purpose |
|----------|------|---------|
| 1 (highest) | `-c` flag | Uses only the specified file |
| 2 | `~/.polymeld/config.yaml` | Global settings (shared across all projects) |
| 3 | `.polymeld/config.yaml` | Project shared settings (git-committed) |
| 4 | `.polymeld/config.local.yaml` | Project local settings (personal, .gitignore) |
| 5 | `polymeld.config.yaml` | Legacy compatibility |

### Credentials Management

Credentials are stored securely in `~/.polymeld/credentials.yaml` (file permissions `0600`):

```yaml
# ~/.polymeld/credentials.yaml
GITHUB_TOKEN: ghp_xxxxx
GITHUB_REPO: owner/repo
ANTHROPIC_API_KEY: sk-...
GOOGLE_API_KEY: AIzaSy...
OPENAI_API_KEY: sk-...
```

**Load priority**: `.env` (dotenv) → `~/.polymeld/credentials.yaml` → environment variables (`process.env` takes precedence)

> Use `polymeld auth` to input credentials interactively, or `polymeld auth --show` to check current credential status.

### config.yaml Options

#### Project Settings (Local Workspace)

Configure agents to reference existing code and save generated code directly to local files:

```yaml
# Specify a local Git repo path so agents can reference existing code during development.
# If not set, the .git in the current directory is auto-detected.
project:
  local_path: ~/projects/my-app
```

> **Auto-detection**: Even without setting `project.local_path`, running Polymeld from the target project directory will auto-detect `.git` and use it as the workspace.

#### Model Definitions

Define the AI models and their CLI mappings:

```yaml
models:
  claude:
    cli: claude
    model: claude-opus-4-6
    fallback: gemini               # Model to switch to on rate limit
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
    model: gemini-3.1-flash-image    # Nano Banana 2 (specialized for image generation)
```

#### fallback (Automatic Rate Limit Switching)

Setting the `fallback` field on a model enables automatic switching to an alternate model when a rate limit is hit:

- **CLI → API → fallback** 3-tier priority chain
- Automatically switches to API key backend when CLI usage is exceeded
- Falls back to the `fallback` model if API key also hits rate limit
- Automatically detects rate limit patterns in stderr (`Rate limit reached`, `Resource exhausted`, `usage limit`, etc.)

#### CLI Execution Settings

```yaml
cli:
  timeout: 600000          # Default timeout 10 min (milliseconds)
  timeouts:
    claude:                # Dual timeout (idle + max)
      idle: 300000         #   5 min: terminate if no output since last activity (resets on output)
      max: 1800000         #   30 min: absolute upper limit (prevents infinite loops)
    gemini: 600000         # Single timeout also supported (10 min)
    codex:
      idle: 300000
      max: 1800000
  max_turns:
    claude: 10             # Max agentic loop turns for Claude
```

> **Dual timeout**: `idle` resets whenever output is detected, preventing premature termination of active processes. `max` is an absolute upper limit to prevent infinite loops. Single numeric values are also supported for backward compatibility.

#### Persona Assignment

Assign a model to each persona. All personas participate in meetings, but voluntarily pass with `[PASS]` when they have nothing to contribute:

```yaml
personas:
  tech_lead:
    name: 김아키
    model: claude
    thinking_budget: 100      # Per-persona override (0-100)

  ace_programmer:
    name: 한코딩
    model: codex

  creative_programmer:
    name: 류창작
    model: gemini

  qa:
    name: 정테스트
    model: codex
    thinking_budget: 100

  designer:
    name: 윤경험
    model: gemini             # Gemini 3.1 Pro for conversation/design
    image_model: gemini_image # Nano Banana 2 for image generation
```

#### image_model (Image Generation)

Setting the `image_model` field enables a persona to perform image generation tasks:
- **Conversation/Design/Review**: Uses the default `model` (e.g., Gemini 3.1 Pro)
- **Image Generation**: Uses `image_model` (e.g., Nano Banana 2)
- Auto-detection of image tasks: Triggered by keywords like design, mockup, icon, illustration in the task title/description
- `image_model` is optional -- without it, the agent operates as text-only

#### thinking_budget (AI Reasoning Depth)

Controls the reasoning depth of AI models on a 0-100 scale:

```yaml
pipeline:
  thinking_budget: 70         # Global default (0-100)

personas:
  tech_lead:
    thinking_budget: 100      # Per-persona override
```

Per-CLI mapping:
| CLI | Parameter | Mapping |
|-----|-----------|---------|
| Claude | `--effort` | 0-33: low, 34-75: medium, 76-100: high |
| Codex | `-c model_reasoning_effort` | 0-25: low, 26-60: medium, 61-85: high, 86-100: xhigh |
| Gemini | (No CLI flag support) | Controlled only via settings.json `thinkingConfig` |

API backend mapping:
| API | Parameter | Mapping |
|-----|-----------|---------|
| Claude (Anthropic) | `thinking.budget_tokens` | 0-33: disabled, 34-75: 4096, 76-100: 16384 |
| Gemini (Google) | `thinkingConfig.thinkingBudget` | 0-33: 1024, 34-75: 8192, 76-100: 24576 |
| OpenAI | `reasoning_effort` | 0-25: low, 26-60: medium, 61-100: high |

#### parallel_development (Parallel Execution)

Runs LLM calls concurrently for tasks without dependencies during Phase 5 (Development):

```yaml
pipeline:
  parallel_development: true    # Default: true
```

- `true`: Analyzes the dependency graph and runs independent tasks in parallel batches
- `false`: Maintains the existing sequential execution mode
- Git operations (branch creation, commits) are always serialized via a queue to prevent conflicts

#### Meeting System

**Real-time speech preview**: During meetings, each AI's response is shown in real time via a spinner as it is generated, then permanently displayed upon completion:

```
⠇ 한코딩 speaking... This can be solved in O(n log n)
✓ 한코딩: This can be solved in O(n log n). Using divide and conquer...
```

**Voluntary pass (`[PASS]`)**: When a persona has nothing to contribute on a topic, they automatically skip with `[PASS]`. The pass is recorded in the meeting minutes.

**Early termination (`[CONCLUDE]`)**: When the team lead determines that sufficient discussion has taken place, they can end the meeting early with `[CONCLUDE]`, skipping the remaining rounds.

**Round display**: The round number is displayed at each meeting round transition.

**Auto-generated issue title**: The team lead AI generates a one-line summary as the title for the meeting minutes GitHub Issue.

### Persona Overview (Defaults)

| Persona | Role | Model | Image Model | thinking |
|---------|------|-------|-------------|----------|
| 김아키 | Tech Lead (Team Lead) | Claude Opus 4.6 | - | 100 |
| 한코딩 | Ace Programmer | GPT-5.4 | - | - |
| 류창작 | Creative Programmer | Gemini 3.1 Pro | - | - |
| 정테스트 | QA Engineer | GPT-5.4 | - | 100 |
| 강기획 | Ace Planner | Gemini 3.1 Pro | - | - |
| 안보안 | Security Expert | Claude Opus 4.6 | - | - |
| 윤경험 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 | - |
| 그림솔 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 | - |

> All personas participate in meetings. On unrelated topics, they voluntarily pass with `[PASS]`, and the team lead can end a meeting early with `[CONCLUDE]`.

## Usage

### Full Pipeline Execution
```bash
# Full-auto mode (default) — all phases run automatically
polymeld run "Implement real-time chat feature"

# Specify interaction mode
polymeld run "chat feature" --mode full-auto   # Default
polymeld run "chat feature" --mode semi-auto   # Confirm at each phase
polymeld run "chat feature" --mode manual      # Manual control
```

> The project title is automatically derived from the workspace name.

### Run Meetings Only
```bash
# Kickoff meeting
polymeld meeting kickoff "Implement user authentication"

# Technical design meeting (3-round discussion)
polymeld meeting design "Migrate to microservices architecture" --rounds 3
```

### Test Model Connections
```bash
polymeld test-models
```

### Interactive REPL Mode
```bash
# Start REPL
polymeld start

# Resume previous session (most recent)
polymeld start --resume

# Resume a specific session
polymeld start --resume <sessionId>

# Specify interaction mode
polymeld start --mode full-auto
```

In REPL mode, enter your requirements in natural language at the prompt to run the full pipeline.
After execution completes, you return to the prompt to issue new commands.
Session context (PipelineState, execution history) is preserved across runs.

**REPL Features:**
- **Status bar**: Displays current session state in real time at the prompt
- **Command menu**: Type `/` to show a searchable command menu (inquirer)
- **Tab completion**: Auto-complete for slash commands
- **Multi-line input**: Supports pasting multiple lines via Bracketed Paste Mode

**Slash Commands:**

| Command | Description |
|---------|-------------|
| `/help` | List available commands |
| `/status` | Show current session state |
| `/history` | Show pipeline execution history |
| `/context` | Inspect PipelineState |
| `/team` | Show team composition |
| `/resume` | Resume an interrupted pipeline (from phase checkpoint) |
| `/save` | Save session |
| `/load [id]` | Restore a session |
| `/exit` | Exit REPL |

### Initialize Configuration
```bash
# Initialize global config (~/.polymeld/ with config.yaml + credentials.yaml)
polymeld init --global

# Initialize project config (.polymeld/config.yaml)
polymeld init
```

### Credentials Management
```bash
# Input tokens/API keys interactively
polymeld auth

# Check current credential status (masked)
polymeld auth --show
```

## Local Workspace Integration

When you designate a local Git repository as the workspace, agents **read and reference existing code** for development and **save generated code directly to the local file system**.

### How It Works

| Feature | With Workspace | Without Workspace |
|---------|---------------|-------------------|
| Code reference | Existing file structure/content included in LLM prompts | Only design docs referenced |
| Code saving | Saved directly as local files + `git commit` | Committed via GitHub API |
| Branch management | Local `git checkout -b` | Branches created via GitHub API |
| PR creation | Local `git push` then GitHub PR | GitHub API only |

### Workspace Detection Priority

1. `project.local_path` setting in config file
2. Auto-detection of `.git` in the current directory (excluding Polymeld's own repo)
3. If not detected, falls back to `NoOpWorkspace` (GitHub API only mode)

> When `local_path` is set, the CLI process runs from that path, allowing agents to directly read and write files in that project.

### Auto-Initialization for Empty GitHub Repos

If the repo specified by `GITHUB_REPO` is empty, it will automatically:
1. Create an Initial Commit
2. Set the origin remote using the `GITHUB_REPO` value

No manual initialization required -- it just works out of the box.

### Behavior During Development Phase

When a workspace is linked, Phase 5 (Development) will:
- Cache the directory structure tree and provide it to the LLM
- Search for relevant files per task using keyword-based matching to provide code context
- Auto-create feature branches per task (`feature/{issueNumber}-{sanitized-title}`)
- Dependency-based parallel execution: Run LLM calls for independent tasks concurrently (Git operations serialized via queue)
- Save generated code as local files, then `git add` + `git commit`
- Re-commit locally during Phase 6 (Review) / Phase 7 (QA) fixes

## Pipeline Details

```
Phase 0: Codebase Analysis (modification mode + local workspace)
  → Analyze existing codebase structure and patterns
  → Analysis results used as context in subsequent phases

Phase 1: Kickoff Meeting
  → Personas share opinions using their respective AI models
  → Unrelated personas voluntarily pass with [PASS]
  → Team lead can end meeting early with [CONCLUDE] after sufficient discussion
  → Issue title auto-generated as a one-line summary by the team lead AI
  → Meeting minutes automatically posted as a GitHub Issue
  → Kickoff summary (kickoffSummary) injected into subsequent agent prompts

Phase 2: Technical Design Meeting
  → Simulates disagreements and consensus among personas
  → Different models debate from different perspectives
  → [PASS] / [CONCLUDE] apply the same way
  → Design decision document posted as a GitHub Issue

Phase 3: Task Decomposition
  → Team lead breaks work into 1-4 hour tasks
  → Each task created as a GitHub Issue (backlog label)

Phase 4: Task Assignment
  → Team lead assigns each task to the most suitable persona
  → Image tasks are preferentially assigned to agents with image_model
  → Assignment rationale recorded as an Issue Comment

Phase 5: Development (Dependency-Based Parallel Execution)
  → Analyzes inter-task dependencies and runs independent tasks in parallel
  → LLM calls run in parallel; Git operations serialized via queue to prevent conflicts
  → Image tasks: Generate images using image_model (saved to output/images/)
  → Committed to feature branches
  → Progress updated via Issue Comments

Phase 6: Code Review
  → Team lead reviews code written by other models
  → ResponseParser extracts APPROVED / CHANGES_REQUESTED verdict
  → If changes needed, team lead directly writes fix code and re-commits
  → Review results recorded as Issue Comments

Phase 7: QA
  → QA engineer verifies the code
  → ResponseParser extracts PASS / FAIL verdict
  → On failure, team lead directly fixes and re-commits
  → Test results recorded as a table in Issue Comments

Phase 8: PR Creation
  → Auto-creates a PR linking all artifacts (meeting minutes, reviews, QA results)
```

> **Phase Checkpoints**: A checkpoint is saved upon each phase completion. If interrupted, use `/resume` to restart from that phase.

## Internal Architecture

### Core Components

| Component | Role | Description |
|-----------|------|-------------|
| **PipelineState** | Single State Store | Manages project/task/message/convocation records as explicit fields |
| **PromptAssembler** | Token Budget Context Assembly | Extracts only the necessary information per task type for LLM prompts (including codebase context) |
| **ResponseParser** | LLM Response Structured Parsing | JSON extraction + keyword fallback for verdict extraction |
| **LocalWorkspace** | Local Git Repo Integration | File browse/read/write + git branch/commit/push automation |
| **validateConnections** | Startup Connection Validation | Real-time display of CLI install → auth → GitHub token/permissions/scopes checks |

### PipelineState Field Catalog

```
project.requirement     - Original requirement text
project.title           - Project title (auto-derived from workspace)
kickoffSummary          - Kickoff meeting summary (injected into subsequent agent prompts)
designDecisions         - Design decisions
techStack               - Technology stack
tasks[]                 - Decomposed task list (includes code/review/QA results)
completedTasks[]        - Completed tasks
messages[]              - All inter-agent messages
codebaseAnalysis        - Phase 0 codebase analysis results
completedPhases[]       - Completed phase checkpoints (used for resumption)
github.kickoffIssue     - GitHub kickoff Issue number
github.designIssue      - GitHub design Issue number
```

### PromptAssembler -- Per-Phase Token Budget

| Phase | Method | Budget | Rationale |
|-------|--------|--------|-----------|
| Meeting | `forMeeting()` | 8,000 chars | Balance needed due to extensive prior remarks |
| Coding | `forCoding()` | 12,000 chars | Code quality first (maximum budget) |
| Fix | `forFix()` | 10,000 chars | Feedback + design context |
| Review | `forReview()` | 6,000 chars | Code delivered separately |
| QA | `forQA()` | 4,000 chars | Only review results needed |
| Image | `forImageGeneration()` | 6,000 chars | Image generation prompt |

### ResponseParser -- LLM Response Parsing

| Method | Purpose | Returns |
|--------|---------|---------|
| `parseTasks()` | Phase 3 task decomposition | Structured task array |
| `parseReviewVerdict()` | Phase 6 code review | APPROVED / CHANGES_REQUESTED |
| `parseQAVerdict()` | Phase 7 QA | PASS / FAIL |

### Project Structure

```
src/
├── index.js                    # CLI entry point (Commander.js) + dotenv loading
├── i18n/
│   ├── index.js                # i18next initialization + t() translation function
│   ├── detect-locale.js        # OS locale auto-detection (LC_ALL → LANG → Intl)
│   └── locales/
│       ├── en.json             # English
│       ├── ko.json             # 한국어
│       ├── ja.json             # 日本語
│       └── zh-CN.json          # 中文(简体)
├── config/
│   ├── loader.js               # YAML config loader (hierarchical merge) + CLI/GitHub validation
│   ├── init.js                 # Interactive setup wizard (global/project)
│   ├── credentials.js          # Credentials management (~/.polymeld/credentials.yaml)
│   ├── paths.js                # Cross-platform path utilities
│   └── interaction.js          # Interaction mode management
├── models/
│   ├── adapter.js              # CLI abstraction (claude/gemini/codex) + thinking mapping
│   └── response-parser.js      # LLM response structured parsing
├── agents/
│   ├── agent.js                # Individual agent (persona)
│   └── team.js                 # Team manager ([PASS]-based autonomous participation)
├── state/
│   ├── pipeline-state.js       # Single state store (with phase checkpoints)
│   └── prompt-assembler.js     # Per-phase token budget context assembler
├── pipeline/
│   └── orchestrator.js         # 9-Phase pipeline (Phase 0~8 + parallel execution + checkpoints)
├── workspace/
│   ├── local-workspace.js      # Local Git repo (file browse/read/write + git CLI)
│   └── noop-workspace.js       # No-op client when workspace is not configured
├── repl/
│   ├── repl-shell.js           # REPL loop (status bar + command menu)
│   ├── command-router.js       # Slash command routing + tab completion
│   ├── status-bar.js           # Status bar rendering
│   ├── slash-menu.js           # Inline searchable slash menu (direct stdin handling)
│   ├── paste-detect-stream.js  # Bracketed Paste Mode (multi-line input)
│   └── commands/               # Slash command handlers
│       ├── help.js
│       ├── status.js
│       ├── history.js
│       ├── context.js
│       ├── team.js
│       ├── resume.js
│       ├── save.js
│       └── load.js
├── session/
│   ├── session.js              # Session (PipelineState + workspace + execution history)
│   └── session-store.js        # Session disk save/restore
└── github/
    └── client.js               # GitHub API (Issues, PRs, Projects) + empty repo auto-init
test/
├── response-parser.test.js     # ResponseParser unit tests (incl. multilingual keyword matching)
├── pipeline-state.test.js      # PipelineState unit tests
├── prompt-assembler.test.js    # PromptAssembler unit tests
├── paste-detect-stream.test.js # Bracketed Paste Mode tests
├── slash-menu.test.js          # Slash menu inline search tests
├── i18n.test.js                # Translation key sync validation (4-language parity)
└── team.test.js                # Team persona normalization tests
```

## What Gets Recorded on GitHub

Every step is recorded on GitHub for full traceability:

- **Meeting minutes**: Issue (meeting-notes label)
- **Tasks**: Issue (backlog → todo → in-progress → done)
- **Assignment records**: Issue Comment
- **Development logs**: Issue Comment + Commit
- **Image generation results**: Issue Comment (file path + text description)
- **Inter-persona discussions**: Issue Comment
- **Code reviews**: Issue Comment
- **QA results**: Issue Comment
- **Final deliverables**: Pull Request

Each record is tagged with the AI CLI that performed it (e.g., `[claude]`, `[gemini]`, `[codex]`).

## Claude Code Integration

This CLI can also be invoked from within Claude Code:

```bash
# From inside Claude Code
polymeld run "requirements" --no-interactive
```

Or register it in CLAUDE.md:
```markdown
## Polymeld
When given project requirements, run the Polymeld CLI:
`polymeld run "requirements" --no-interactive`
```

## Persona Customization

You can add or modify personas in your `config.yaml`:

```yaml
personas:
  devops:
    name: 최배포
    role: DevOps Engineer
    model: codex
    description: "Obsessed with CI/CD and infrastructure automation. Strives for deployment pipeline perfection."
    expertise:
      - CI/CD pipeline construction
      - Container orchestration
      - Infrastructure automation

  concept_artist:
    name: 이컨셉
    role: Concept Artist
    model: gemini              # Text model for discussion/planning
    image_model: gemini_image  # Image model for image generation
    description: "Specialist in concept art and visual design"
    expertise:
      - Concept art creation
      - Character/environment design
```

> All personas participate in meetings, but voluntarily pass with `[PASS]` on unrelated topics. No separate on_demand configuration is needed.

## Multilingual Support (i18n)

All text -- CLI UI, AI system prompts, GitHub comments, and more -- is available in 4 languages:

| Language | Code | How to Set |
|----------|------|------------|
| 한국어 | `ko` | `--lang ko` or OS locale |
| English | `en` | `--lang en` or OS locale |
| 日本語 | `ja` | `--lang ja` or OS locale |
| 中文(简体) | `zh-CN` | `--lang zh-CN` or OS locale |

**Locale detection priority**: `--lang` flag → environment variables (`LC_ALL`, `LC_MESSAGES`, `LANG`) → `Intl` API → `en` (default)

AI response parsing is also multilingual: Code review verdicts (`APPROVED`/`승인`/`承認`/`批准`), QA verdicts (`PASS`/`합격`/`合格`/`通过`), and others are recognized regardless of language.

## License

MIT
