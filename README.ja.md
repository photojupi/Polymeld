🌐 [한국어](README.ko.md) | [English](README.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**複数のAIコーディングエージェントを仮想開発チームとしてオーケストレーション。**

Claude Code、Gemini CLI、Codex CLIを各ペルソナに割り当て、会議 → 設計 → 開発 → コードレビュー → QA → PR作成まで全行程を自動化します。

## ✨ 主な機能

- **🤖 マルチAIチーム** — 8人のペルソナ（テックリード、プログラマー、QA、デザイナーなど）をClaude、Gemini、Codexに割り当て
- **🔄 8段階パイプライン** — コードベース分析 → 会議 → タスク分解 → 割り当て → 開発 → コードレビュー → QA → PR
- **🛠️ CLI + APIデュアルバックエンド** — 各モデルがCLIまたはAPI SDKで動作 — 利用可能な方を使用、両方も可
- **⚡ 並列開発** — 依存関係を分析して独立タスクを同時実行
- **🖼️ 画像生成** — `image_model`設定でNano Banana 2による画像自動生成
- **📂 ローカルワークスペース** — 既存コードを読み取り、ファイルを直接生成、gitブランチ/コミット自動管理
- **🔁 自動修正ループ** — レビュー/QA失敗時に自動修正 → 再検証サイクル
- **💬 AI会議** — リアルタイムマルチモデル討論、`[PASS]`/`[CONCLUDE]`で自律調整
- **📊 トークン使用量トラッキング** — 各アクションごとにバックエンド（CLI/API）、モデル名、トークン数を表示
- **🔀 3段階Rate Limitフォールバック** — CLI → API key → fallbackモデル — rate limit時に自動切替
- **🌐 4言語i18n** — English、한국어、日本語、中文を完全サポート
- **📌 GitHub完全トレーサビリティ** — 全過程がIssues、Comments、Commits、PRとして記録

## 🚀 クイックスタート

```bash
# 1. Polymeldのインストール
npm install -g polymeld

# 2. AI CLIのインストール（使用するモデルのみ）
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @google/gemini-cli           # Gemini CLI
npm install -g @openai/codex                # Codex CLI

# 3. プロジェクトフォルダで実行 — オンボーディングウィザードが自動起動
cd ~/projects/my-app
polymeld
# → モデル選択 → GitHubトークン設定 → 完了！
# → GITHUB_REPOはgit remoteから自動検出
```

## 📋 コマンド

| コマンド | 説明 |
|----------|------|
| `polymeld` | REPL起動（初回実行時はオンボーディングウィザード） |
| `polymeld run "要件"` | 全パイプライン実行 |
| `polymeld run "要件" --mode semi-auto` | Phaseごとに確認 |
| `polymeld meeting "トピック"` | ミーティングのみ実行 |
| `polymeld start --resume` | 前回のセッションを再開 |
| `polymeld test-models` | モデル接続テスト |
| `polymeld init --global` | グローバル設定の初期化 |
| `polymeld auth` | 認証情報の対話型管理 |

**REPLスラッシュコマンド:** `/help` `/status` `/history` `/context` `/team` `/mode` `/resume` `/save` `/load` `/exit`

## ⚙️ パイプライン

```
Phase 0  コードベース分析     既存コード構造を分析（ローカルワークスペース時）
Phase 1  ミーティング         マルチAI討論 → 設計決定
Phase 2  タスク分解           1-4時間単位で分解 → GitHub Issues
Phase 3  作業割り当て         タスクを適切なペルソナに割り当て
Phase 4  開発                 並列コーディング → featureブランチ → コミット
Phase 5  コードレビュー       リーダーレビュー → 自動修正 → 再レビュー (×3)
Phase 6  QA                   検証 → 自動修正 → 再検証 (×3)
Phase 7  PR作成               全履歴がリンクされたPRを自動作成
```

> **チェックポイント**: 各Phase完了時に保存。`/resume`で該当Phaseから再開可能。

## 📌 GitHub Issue & カンバンボード

Polymeldは**GitHub Issues**と**GitHub Projects V2**のカンバンボードを活用して、パイプライン全工程を自動追跡します。

### Issue自動作成

| Phase | 作成されるIssue | ラベル |
|-------|----------------|--------|
| Phase 1 | 📝 **Planning Issue** — 会議結果の記録 | `meeting-notes`, `planning`, `polymeld` |
| Phase 2 | 🔧 **Task Issue** — 分解された各タスクごとに1つ | `backlog`, `polymeld`, `{{category}}` |

### カンバン6段階カラム

パイプラインの進行に応じて、Issueがカンバンボードのカラムを自動移動します：

```
Backlog → Todo → In Progress → In Review → QA → Done
```

| カラム | 遷移タイミング | ラベル変更 |
|--------|--------------|-----------|
| **Backlog** | Phase 2: タスク分解後 | `backlog` |
| **Todo** | Phase 3: ペルソナに割り当て | `todo`, `assigned:{{agent}}` |
| **In Progress** | Phase 4: 開発開始 | `in-progress` |
| **In Review** | Phase 5: コードレビュー進行中 | `in-review` |
| **QA** | Phase 6: QA進行中 | `qa` |
| **Done** | Phase 6: QA通過 → Issue自動クローズ | `done` |

### 自動コメント

各Phase遷移時にIssueへコメントが自動追加され、全履歴を追跡できます：

- 🧑‍💼 **作業割り当て** — 担当者、割り当て理由
- 🚀 **開発開始/完了** — エージェント名、モデル、コードプレビュー
- 🔍 **コードレビュー** — レビュー結果（試行回数を含む）
- 🧪 **QA結果** — 検証結果、フィードバックに基づく修正履歴

### PRとIssueの連携

Phase 7で作成されるPRは、完了した全Task Issueを`Closes #N`で参照し、PRマージ時に関連Issueが自動クローズされます。

> GitHubトークンなしでもパイプライン実行は可能です。GitHub機能のみ無効化されます。

## 👥 デフォルトチーム

| ペルソナ | 役割 | モデル | 画像 |
|----------|------|--------|------|
| 設楽 匠 | Tech Lead（リーダー） | Claude Opus 4.6 | — |
| 源 鋭太 | Ace Programmer | GPT-5.4 | — |
| 新堂 創 | Creative Programmer | Gemini 3.1 Pro | — |
| 計良 望 | Ace Planner | Gemini 3.1 Pro | — |
| 守山 盾 | Security Expert | Claude Opus 4.6 | — |
| 美濃 花 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 |
| 彩川 いろは | Illustrator | Gemini 3.1 Pro | Nano Banana 2 |
| 検見 守 | QA Engineer | GPT-5.4 | — |

> 全ペルソナが会議に参加。`[PASS]`（スキップ）と`[CONCLUDE]`（早期終了）で自律調整。

## 🔧 設定

### バックエンドの優先順位

各モデルは自動切替される**2つのバックエンド**をサポートします：

| 優先順位 | バックエンド | 使用条件 |
|---------|------------|----------|
| 1番目 | **CLI**（claude / gemini / codex） | インストール済みで利用可能な時 |
| 2番目 | **API SDK**（Anthropic / Google GenAI / OpenAI） | CLI rate limit時、またはCLI未インストール時 |
| 3番目 | **Fallbackモデル** | CLIとAPI両方がrate limitの時 |

> CLIのみ、APIのみ、または両方 — 利用可能なもので動作します。`api_model`でAPI呼び出しに別のモデルを指定できます。

### 認証情報

```bash
polymeld auth                  # 対話型設定
polymeld auth --show           # 現在の状態を確認
```

または`.env` / `~/.polymeld/credentials.yaml`を使用：

```bash
GITHUB_TOKEN=ghp_xxxxx        # 必須
# GITHUB_REPO=owner/repo      # git remoteから自動検出

# APIキー（オプション — プロバイダー別にAPIバックエンドを有効化）
ANTHROPIC_API_KEY=sk-...       # Claude API
GOOGLE_API_KEY=AIzaSy...       # Gemini API（画像生成に必須）
OPENAI_API_KEY=sk-...          # OpenAI API
```

### config.yaml

設定ファイルは階層的にマージされます：`-c`フラグ > `~/.polymeld/config.yaml`（グローバル）> `.polymeld/config.yaml`（プロジェクト）> `.polymeld/config.local.yaml`（ローカル）。

```yaml
# モデル定義
models:
  claude:
    cli: claude
    model: claude-opus-4-6
    fallback: gemini             # rate limit時に切替
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
    model: gemini-3.1-flash-image-preview  # Nano Banana 2（GOOGLE_API_KEY必須）

# ペルソナ割り当て
personas:
  tech_lead:
    name: 設楽 匠
    model: claude
    thinking_budget: 100         # AI思考深度（0-100）
  designer:
    name: 美濃 花
    model: gemini
    image_model: gemini_image    # 画像生成を有効化

# パイプライン設定
pipeline:
  parallel_development: true     # 並列LLM呼び出し
  thinking_budget: 50            # グローバルデフォルト値（0-100）
  max_review_retries: 3
  max_qa_retries: 3
```

### カスタムペルソナ

```yaml
personas:
  devops:
    name: 運用 太郎
    role: DevOps Engineer
    model: codex
    description: "CI/CDとインフラ自動化のスペシャリスト"
    expertise:
      - CI/CDパイプライン構築
      - コンテナオーケストレーション
```

## 🌐 多言語対応

| 言語 | フラグ | 自動検出 |
|------|--------|----------|
| English | `--lang en` | OSロケール |
| 한국어 | `--lang ko` | OSロケール |
| 日本語 | `--lang ja` | OSロケール |
| 中文(简体) | `--lang zh-CN` | OSロケール |

AI応答パースも多言語対応 — `APPROVED`/`승인`/`承認`/`批准`等の判定を言語に依存せず認識します。

## Claude Code連携

```bash
polymeld run "要件" --no-interactive
```

`CLAUDE.md`に登録すれば自動呼び出しも可能です。

## ライセンス

MIT
