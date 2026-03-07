🌐 [한국어](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

# Polymeld

**マルチAIモデルベースの開発チームシミュレーション**

Claude Code、Gemini CLI、Codex CLIを各ペルソナに割り当て、
会議 → 設計 → 開発 → レビュー → QA → PR作成まで自動化します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      Polymeld                               │
│                (Node.js オーケストレーター)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  REPL Shell (Interactive)   ←→   Session (Context 維持)     │
│  ステータスバー、コマンドメニュー、  SessionStore (ディスク保存)│
│  Tab 自動補完、マルチライン入力     Phase チェックポイント/再開│
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  validateConnections: CLI 設置 → 認証 → GitHub 検証 + スコープ│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PipelineState              PromptAssembler                 │
│  (単一状態ストア)            (Phase別差分トークン予算)       │
│                                                             │
│  ResponseParser             ModelAdapter                    │
│  (LLM応答構造化パース)       (CLI抽象化 + thinking マッピング)│
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
│  │ (リーダー)│   │ 박프론트    │  │ (エース)  │              │
│  │ 안보안   │   │ 강기획      │  │ 정테스트  │              │
│  └─────────┘   │ 윤경험*     │  │ 이서버    │              │
│                │ 그림솔*     │  └──────────┘              │
│                └─────────────┘                              │
│  * 画像生成時に Nano Banana 2 を使用                        │
│  会議中 [PASS] で自発的に参加を調整                         │
│                                                             │
├──────────────────────────┬──────────────────────────────────┤
│   LocalWorkspace         │       GitHub Integration         │
│   (ローカル Git レポ連携) │  Issues │ Comments │ Projects   │
│   ファイル探索/読取/書込  │  Branches │ PRs │ Commits      │
│   git branch/commit/push │  空レポ自動初期化                │
└──────────────────────────┴──────────────────────────────────┘
```

## インストール

```bash
npm install -g polymeld
```

## クイックスタート

```bash
# 1. CLIツールのインストール（未インストールの場合）
npm install -g @anthropic-ai/claude-code  # Claude Code
npm install -g @google/gemini-cli          # Gemini CLI
npm install -g @openai/codex               # Codex CLI

# 3. 初期設定（対話型ウィザード）
polymeld init --global      # グローバル設定 + 認証情報の入力
# または引数なしで実行するとオンボーディングウィザードが自動起動します：
polymeld

# 4.（オプション）ローカルワークスペース連携
# 対象プロジェクトのディレクトリで実行すると自動検出：
cd ~/projects/my-app && polymeld start
# または設定ファイルに明示：
#   project:
#     local_path: ~/projects/my-app

# 5. 設定確認（CLI認証 + GitHub連携の自動検証）
polymeld test-models

# 6. 実行！
polymeld run "ユーザー認証機能の実装（メール/パスワード + OAuth）"

# 7. 言語指定（オプション、未指定時はOSロケールを自動検出）
polymeld run "チャット機能" --lang en   # English
polymeld run "チャット機能" --lang ja   # 日本語
polymeld run "チャット機能" --lang zh-CN # 中文(简体)

# 8. テスト
npm test
```

> **初回起動時のオンボーディング**: `polymeld`を引数なしで実行すると、グローバル設定が存在しない場合、オンボーディングウィザード（モデル選択 → 認証情報入力）を案内した後、REPLモードに自動遷移します。

## 設定

### 環境変数（.envファイル）

プロジェクトルートに`.env`ファイルを作成して設定します（`dotenv`で自動ロード）：

```bash
# .env.exampleをコピーして使用
cp .env.example .env
```

```bash
# GitHub Personal Access Token
# - Classic PAT: repo（必須）+ project（オプション、Projectsボード用）スコープ
# - Fine-grained PAT: Issues, Contents, Pull requests 書き込み権限
GITHUB_TOKEN=ghp_xxxxx
GITHUB_REPO=owner/repo            # 対象リポジトリ（owner/repo形式）
```

> **起動時の自動検証**: CLI設置 → CLI認証 → GitHub連携 + トークンスコープを順次確認します。Classic PATの`project`スコープが未設定の場合は警告を表示します。

> 参考: AI CLIツールのAPIキーは各CLIが自己管理しています（各CLIの認証方式に従ってください）。

### 設定ファイルのロード順序

設定は階層的にマージされます（下位レイヤーが上位を上書き）：

| 優先順位 | パス | 用途 |
|---------|------|------|
| 1（最上位） | `-c`フラグ | 指定されたファイルのみ使用 |
| 2 | `~/.polymeld/config.yaml` | グローバル設定（全プロジェクト共通） |
| 3 | `.polymeld/config.yaml` | プロジェクト共有設定（gitコミット対象） |
| 4 | `.polymeld/config.local.yaml` | プロジェクトローカル設定（個人用、.gitignore） |
| 5 | `polymeld.config.yaml` | レガシー互換 |

### 認証情報管理

認証情報は`~/.polymeld/credentials.yaml`に安全に保存されます（ファイル権限`0600`）：

```yaml
# ~/.polymeld/credentials.yaml
GITHUB_TOKEN: ghp_xxxxx
GITHUB_REPO: owner/repo
ANTHROPIC_API_KEY: sk-...
GOOGLE_API_KEY: AIzaSy...
OPENAI_API_KEY: sk-...
```

**ロード優先順位**: `.env`（dotenv） → `~/.polymeld/credentials.yaml` → 環境変数（`process.env`優先）

> `polymeld auth`で対話的に入力するか、`polymeld auth --show`で現在の設定状態を確認できます。

### config.yaml 設定項目

#### プロジェクト設定（ローカルワークスペース）

エージェントが既存コードを参照し、生成したコードをローカルファイルとして直接保存するよう設定します：

```yaml
# ローカルGitレポのパスを指定すると、エージェントが既存コードを参照して開発します。
# 未設定時は現在のディレクトリの.gitを自動検出します。
project:
  local_path: ~/projects/my-app
```

> **自動検出**: `project.local_path`を設定しなくても、対象プロジェクトのディレクトリでPolymeldを実行すると`.git`を自動検出してワークスペースとして使用します。

#### モデル定義

使用するAIモデルとCLIマッピングを定義します：

```yaml
models:
  claude:
    cli: claude
    model: claude-opus-4-6
  gemini:
    cli: gemini
    model: gemini-3.1-pro-preview
  codex:
    cli: codex
    model: gpt-5.4
  gemini_image:
    cli: gemini
    model: gemini-3.1-flash-image    # Nano Banana 2（画像生成特化）
```

#### CLI実行設定

```yaml
cli:
  timeout: 600000          # デフォルトタイムアウト10分（ミリ秒）
  timeouts:
    claude:                # デュアルタイムアウト（idle + max）
      idle: 300000         #   5分: 最後の出力以降無応答時に終了（出力があればリセット）
      max: 1800000         #   30分: 絶対上限（無限ループ防止）
    gemini: 600000         # 単一タイムアウトも対応（10分）
    codex:
      idle: 300000
      max: 1800000
  max_turns:
    claude: 10             # Claudeエージェンティックループ最大ターン数
```

> **デュアルタイムアウト**: `idle`は出力があるたびにリセットされ、活発なプロセスの早期終了を防ぎます。`max`は絶対上限で無限ループを防止します。単一数値もバックワード互換でサポートされます。

#### ペルソナ割り当て

各ペルソナにモデルを割り当てます。全ペルソナが会議に参加しますが、貢献する内容がなければ`[PASS]`で自発的にパスします：

```yaml
personas:
  tech_lead:
    name: 김아키
    model: claude
    thinking_budget: 100      # ペルソナ別オーバーライド（0-100）

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
    model: gemini             # 対話/設計時 Gemini 3.1 Pro
    image_model: gemini_image # 画像生成時 Nano Banana 2
```

#### image_model（画像生成）

`image_model`フィールドを設定すると、該当ペルソナが画像生成タスクを実行できます：
- **対話/設計/レビュー**: 基本`model`を使用（例: Gemini 3.1 Pro）
- **画像生成**: `image_model`を使用（例: Nano Banana 2）
- 画像タスク自動検出: タスクのタイトル/説明にデザイン、モックアップ、アイコン、イラスト等のキーワードが含まれる場合
- `image_model`はオプション — 未設定時はテキスト専用エージェントとして動作

#### thinking_budget（AI思考深度）

AIモデルの推論深度を0-100スケールで制御します：

```yaml
pipeline:
  thinking_budget: 70         # グローバルデフォルト値（0-100）

personas:
  tech_lead:
    thinking_budget: 100      # ペルソナ別オーバーライド
```

CLI別変換：
| CLI | パラメータ | 変換 |
|-----|---------|------|
| Claude | `--effort` | 0-25: low, 26-75: medium, 76-100: high |
| Codex | `-c model_reasoning_effort` | 0-25: low, 26-60: medium, 61-85: high, 86-100: xhigh |
| Gemini | (CLIフラグ未対応) | settings.json `thinkingConfig`でのみ制御 |

#### parallel_development（並列実行）

Phase 5（開発）で依存関係のないタスクのLLM呼び出しを同時に実行します：

```yaml
pipeline:
  parallel_development: true    # デフォルト値: true
```

- `true`: 依存関係グラフを分析して独立タスクをバッチ単位で並列実行
- `false`: 従来の逐次実行方式を維持
- Git操作（ブランチ作成、コミット）は競合防止のため常にシリアルキューで処理

#### 会議システム

**リアルタイム発言プレビュー**: 会議中、各AIの応答が生成される過程をspinnerにリアルタイム表示し、完了後に内容を永続出力します：

```
⠇ 한코딩 発言中... この部分はO(n log n)で解けます
✓ 한코딩: この部分はO(n log n)で解けます。分割統治法で...
```

**自発的パス（`[PASS]`）**: ペルソナが該当トピックに貢献する内容がなければ`[PASS]`で自動スキップされます。議事録にパス記録が残ります。

**早期終了（`[CONCLUDE]`）**: リーダーが十分な議論が行われたと判断すると`[CONCLUDE]`で残りのラウンドをスキップして会議を終了します。

**ラウンド表示**: 会議ラウンドの切り替え時にラウンド番号が表示されます。

**Issueタイトル自動生成**: 議事録GitHub IssueのタイトルをリーダーのAIが一行要約で生成します。

### ペルソナ構成（デフォルト）

| ペルソナ | 役割 | モデル | 画像モデル | thinking |
|---------|------|------|-----------|----------|
| 김아키 | Tech Lead (リーダー) | Claude Opus 4.6 | - | 100 |
| 한코딩 | Ace Programmer | GPT-5.4 | - | - |
| 류창작 | Creative Programmer | Gemini 3.1 Pro | - | - |
| 정테스트 | QA Engineer | GPT-5.4 | - | 100 |
| 이서버 | Backend Developer | GPT-5.4 | - | - |
| 박프론트 | Frontend Engineer | Gemini 3.1 Pro | - | - |
| 강기획 | Ace Planner | Gemini 3.1 Pro | - | - |
| 안보안 | Security Expert | Claude Opus 4.6 | - | - |
| 윤경험 | UX/Visual Designer | Gemini 3.1 Pro | Nano Banana 2 | - |
| 그림솔 | Illustrator | Gemini 3.1 Pro | Nano Banana 2 | - |

> 全ペルソナが会議に参加します。関連のないトピックでは`[PASS]`で自発的にパスし、リーダーは`[CONCLUDE]`で会議を早期終了できます。

## 使い方

### 全パイプライン実行
```bash
# 全自動モード（デフォルト） — 全Phase自動進行
polymeld run "リアルタイムチャット機能の実装"

# インタラクションモード指定
polymeld run "チャット機能" --mode full-auto   # デフォルト
polymeld run "チャット機能" --mode semi-auto   # Phaseごとに確認
polymeld run "チャット機能" --mode manual      # 手動制御
```

> プロジェクトタイトルはワークスペース名から自動生成されます。

### 会議のみ実行
```bash
# キックオフミーティング
polymeld meeting kickoff "ユーザー認証機能の実装"

# 技術設計ミーティング（3ラウンド討論）
polymeld meeting design "マイクロサービスアーキテクチャへの移行" --rounds 3
```

### モデル接続テスト
```bash
polymeld test-models
```

### インタラクティブREPLモード
```bash
# REPL起動
polymeld start

# 前回のセッションを継続（最新セッション）
polymeld start --resume

# 特定セッションを復元
polymeld start --resume <sessionId>

# インタラクションモード指定
polymeld start --mode full-auto
```

REPLモードでは、プロンプトに自然言語で要件を入力すると全パイプラインが実行されます。
実行が完了するとプロンプトに戻り、新しいコマンドを入力できます。
セッションコンテキスト（PipelineState、実行履歴）が維持されます。

**REPL機能:**
- **ステータスバー**: プロンプトに現在のセッション状態をリアルタイム表示
- **コマンドメニュー**: `/`入力時に検索可能なコマンドメニューを表示（inquirer）
- **Tab自動補完**: スラッシュコマンドの自動補完
- **マルチライン入力**: Bracketed Paste Modeによる複数行貼り付け対応

**スラッシュコマンド:**

| コマンド | 説明 |
|--------|------|
| `/help` | 使用可能なコマンド一覧 |
| `/status` | 現在のセッション状態 |
| `/history` | パイプライン実行履歴 |
| `/context` | PipelineState 状態確認 |
| `/team` | チーム構成確認 |
| `/resume` | 中断されたパイプラインの再開（Phase チェックポイント基準） |
| `/save` | セッション保存 |
| `/load [id]` | セッション復元 |
| `/exit` | REPL終了 |

### 設定初期化
```bash
# グローバル設定の初期化（~/.polymeld/にconfig.yaml + credentials.yaml）
polymeld init --global

# プロジェクト設定の初期化（.polymeld/config.yaml）
polymeld init
```

### 認証情報管理
```bash
# 対話的にトークン/APIキーを入力
polymeld auth

# 現在の認証情報の状態を確認（マスキング済み）
polymeld auth --show
```

## ローカルワークスペース連携

ローカルGitリポジトリをワークスペースとして指定すると、エージェントが**既存コードを読み取り参照して開発**し、生成されたコードを**ローカルファイルシステムに直接保存**します。

### 動作方式

| 機能 | ワークスペース設定時 | 未設定時 |
|------|---------------------|----------|
| コード参照 | 既存ファイル構造/内容をLLMプロンプトに含む | 設計ドキュメントのみ参照 |
| コード保存 | ローカルファイルに直接保存 + `git commit` | GitHub APIでコミット |
| ブランチ管理 | ローカル `git checkout -b` | GitHub APIでブランチ作成 |
| PR作成 | ローカル `git push` → GitHub PR | GitHub API専用 |

### ワークスペース検出優先順位

1. 設定ファイルの`project.local_path`設定
2. 現在のディレクトリの`.git`自動検出（Polymeld自体のレポは除外）
3. 未検出時は`NoOpWorkspace`でGitHub API専用モード

> `local_path`設定時、CLIプロセスが該当パスで実行されるため、エージェントがそのプロジェクトのファイルを直接読み書きできます。

### 空のGitHubレポの自動初期化

`GITHUB_REPO`で指定されたレポが空の場合、自動的に：
1. Initial Commitを作成し
2. `GITHUB_REPO`の値でorigin remoteを設定します

手動での初期化は不要で、そのまま使用できます。

### 開発Phaseでの動作

ワークスペースが連携されるとPhase 5（開発）で：
- ディレクトリ構造ツリーをキャッシュしてLLMに提供
- タスクごとにキーワードベースで関連ファイルを検索してコードコンテキストを提供
- タスクごとにfeatureブランチを自動作成（`feature/{issueNumber}-{整形されたtitle}`）
- 依存関係ベースの並列実行：独立タスクのLLM呼び出しを同時実行（Git操作はシリアルキュー）
- 生成されたコードをローカルファイルに保存後`git add` + `git commit`
- Phase 6（レビュー）/Phase 7（QA）修正時もローカルで再コミット

## パイプライン詳細

```
Phase 0: コードベース分析（修正モード + ローカルワークスペース時）
  → 既存コードベースの構造とパターンを分析
  → 分析結果を以降のPhaseでコンテキストとして活用

Phase 1: キックオフミーティング
  → ペルソナがそれぞれのAIモデルで意見を提示
  → 関連のないペルソナは [PASS] で自発的にパス
  → リーダーが [CONCLUDE] で十分な議論後に早期終了可能
  → IssueタイトルはリーダーのAIが一行要約で自動生成
  → 議事録がGitHub Issueに自動登録
  → キックオフ要約（kickoffSummary）が以降のエージェントプロンプトに注入

Phase 2: 技術設計ミーティング
  → ペルソナ間の意見対立/合意シミュレーション
  → 異なるモデルが異なる視点で討論
  → [PASS] / [CONCLUDE] 同様に適用
  → 設計決定ドキュメントがGitHub Issueに登録

Phase 3: タスク分解
  → リーダーが1-4時間単位でタスクを分解
  → 各タスクがGitHub Issueとして作成（backlog ラベル）

Phase 4: 作業分配
  → リーダーが各タスクを適切なペルソナに割り当て
  → 画像タスクはimage_model保有エージェントに優先割り当て
  → 割り当て理由がIssue Commentに記録

Phase 5: 開発（依存関係ベースの並列実行）
  → タスク間の依存関係を分析して独立タスクを並列実行
  → LLM呼び出しは並列、Git操作はシリアルキューで競合防止
  → 画像タスク: image_modelで画像生成（output/images/ に保存）
  → featureブランチにコミット
  → 進捗状況がIssue Commentで更新

Phase 6: コードレビュー
  → リーダーが他のモデルが作成したコードをレビュー
  → ResponseParserがAPPROVED / CHANGES_REQUESTED判定を抽出
  → レビュー → 修正 → 再レビューサイクル（最大3回）
  → レビュー結果がIssue Commentに記録

Phase 7: QA
  → QAがコードを検証
  → ResponseParserがPASS / FAIL判定を抽出
  → QA失敗 → リーダー分析 → 修正 → 再検証（最大3回）
  → テスト結果がIssue Commentに表形式で記録

Phase 8: PR作成
  → 全履歴（議事録、レビュー、QA）がリンクされたPRを自動作成
```

> **Phaseチェックポイント**: 各Phase完了時にチェックポイントが保存され、中断時に`/resume`で該当Phaseから再開できます。

## 内部アーキテクチャ

### コアコンポーネント

| コンポーネント | 役割 | 説明 |
|---------|------|------|
| **PipelineState** | 単一状態ストア | プロジェクト/タスク/メッセージ/招集記録を明示的フィールドで管理 |
| **PromptAssembler** | トークン予算コンテキスト組立 | 作業タイプ別に必要な情報のみ抽出してLLMプロンプトを構成（コードベースコンテキスト含む） |
| **ResponseParser** | LLM応答構造化パース | JSON抽出 + キーワードフォールバックで判定（verdict）を抽出 |
| **LocalWorkspace** | ローカルGitレポ連携 | ファイル探索/読取/書込 + gitブランチ/コミット/プッシュ自動化 |
| **validateConnections** | 起動時の接続検証 | CLI設置 → 認証 → GitHubトークン/権限/スコープ確認をリアルタイム表示 |

### PipelineState フィールドカタログ

```
project.requirement     - 元の要件テキスト
project.title           - プロジェクトタイトル（ワークスペースから自動生成）
kickoffSummary          - キックオフミーティング要約（以降のエージェントプロンプトに注入）
designDecisions         - 設計決定事項
techStack               - 技術スタック
tasks[]                 - 分解されたタスク一覧（コード/レビュー/QA結果含む）
completedTasks[]        - 完了タスク
messages[]              - エージェント間の全メッセージ
codebaseAnalysis        - Phase 0 コードベース分析結果
completedPhases[]       - 完了Phase チェックポイント（再開時に活用）
github.kickoffIssue     - GitHub キックオフ Issue番号
github.designIssue      - GitHub 設計 Issue番号
```

### PromptAssembler — Phase別差分トークン予算

| Phase | メソッド | 予算 | 理由 |
|-------|--------|------|------|
| 会議 | `forMeeting()` | 8,000字 | 過去の発言が多くバランス調整 |
| コーディング | `forCoding()` | 12,000字 | コード品質優先（最大予算） |
| 修正 | `forFix()` | 10,000字 | フィードバック + 設計コンテキスト |
| レビュー | `forReview()` | 6,000字 | コードは別途提供 |
| QA | `forQA()` | 4,000字 | レビュー結果のみ必要 |
| 画像 | `forImageGeneration()` | 6,000字 | 画像生成プロンプト |

### ResponseParser — LLM応答パース

| メソッド | 用途 | 戻り値 |
|--------|------|------|
| `parseTasks()` | Phase 3 タスク分解 | 構造化されたタスク配列 |
| `parseReviewVerdict()` | Phase 6 コードレビュー | APPROVED / CHANGES_REQUESTED |
| `parseQAVerdict()` | Phase 7 QA | PASS / FAIL |

### プロジェクト構造

```
src/
├── index.js                    # CLIエントリポイント（Commander.js）+ dotenvロード
├── i18n/
│   ├── index.js                # i18next初期化 + t()翻訳関数
│   ├── detect-locale.js        # OSロケール自動検出（LC_ALL → LANG → Intl）
│   └── locales/
│       ├── en.json             # English
│       ├── ko.json             # 한국어
│       ├── ja.json             # 日本語
│       └── zh-CN.json          # 中文(简体)
├── config/
│   ├── loader.js               # YAML設定ローダー（階層的マージ）+ CLI/GitHub接続検証
│   ├── init.js                 # 対話型設定初期化ウィザード（グローバル/プロジェクト）
│   ├── credentials.js          # 認証情報管理（~/.polymeld/credentials.yaml）
│   ├── paths.js                # クロスプラットフォームパスユーティリティ
│   └── interaction.js          # インタラクションモード管理
├── models/
│   ├── adapter.js              # CLI抽象化（claude/gemini/codex）+ thinkingマッピング
│   └── response-parser.js      # LLM応答構造化パース
├── agents/
│   ├── agent.js                # 個別エージェント（ペルソナ）
│   └── team.js                 # チーム管理者（[PASS]ベース自律参加）
├── state/
│   ├── pipeline-state.js       # 単一状態ストア（Phaseチェックポイント含む）
│   └── prompt-assembler.js     # Phase別差分トークン予算コンテキスト組立器
├── pipeline/
│   └── orchestrator.js         # 9-Phaseパイプライン（Phase 0~8 + 並列実行 + チェックポイント）
├── workspace/
│   ├── local-workspace.js      # ローカルGitレポ（ファイル探索/読取/書込 + git CLI）
│   └── noop-workspace.js       # ワークスペース未設定時のNo-opクライアント
├── repl/
│   ├── repl-shell.js           # REPLループ（ステータスバー + コマンドメニュー）
│   ├── command-router.js       # スラッシュコマンドルーティング + Tab自動補完
│   ├── status-bar.js           # ステータスバーレンダリング
│   ├── paste-detect-stream.js  # Bracketed Paste Mode（マルチライン入力）
│   └── commands/               # スラッシュコマンドハンドラー
│       ├── help.js
│       ├── status.js
│       ├── history.js
│       ├── context.js
│       ├── team.js
│       ├── resume.js
│       ├── save.js
│       └── load.js
├── session/
│   ├── session.js              # セッション（PipelineState + ワークスペース + 実行履歴）
│   └── session-store.js        # セッションディスク保存/復元
└── github/
    └── client.js               # GitHub API（Issues, PRs, Projects）+ 空レポ自動初期化
test/
├── response-parser.test.js     # ResponseParser単体テスト（多言語キーワードマッチング含む）
├── pipeline-state.test.js      # PipelineState単体テスト
├── prompt-assembler.test.js    # PromptAssembler単体テスト
├── paste-detect-stream.test.js # Bracketed Paste Modeテスト
├── i18n.test.js                # 翻訳キー同期検証（4言語一致）
└── team.test.js                # Teamペルソナ正規化テスト
```

## GitHubに記録される項目

全過程がGitHubにトレーサブルに記録されます：

- **議事録**: Issue (meeting-notes ラベル)
- **タスク**: Issue (backlog → todo → in-progress → done)
- **割り当て記録**: Issue Comment
- **開発ログ**: Issue Comment + Commit
- **画像生成結果**: Issue Comment（ファイルパス + テキスト説明）
- **ペルソナ間議論**: Issue Comment
- **コードレビュー**: Issue Comment
- **QA結果**: Issue Comment
- **最終成果物**: Pull Request

各記録にはどのAI CLIが実行したかのタグが付与されます（例: `[claude]`, `[gemini]`, `[codex]`）。

## Claude Code連携

このCLIはClaude Codeからも呼び出すことができます：

```bash
# Claude Code内で
node /path/to/polymeld/src/index.js run "要件" --no-interactive
```

またはCLAUDE.mdに登録：
```markdown
## Polymeld
プロジェクト要件が与えられたらPolymeld CLIを実行してください：
`node ./polymeld/src/index.js run "要件" --no-interactive`
```

## ペルソナカスタマイズ

設定ファイル（`config.yaml`）でペルソナを追加/修正できます：

```yaml
personas:
  devops:
    name: 최배포
    role: DevOps Engineer
    model: codex
    description: "CI/CDとインフラ自動化に執着。デプロイパイプラインの完璧さを追求。"
    expertise:
      - CI/CDパイプライン構築
      - コンテナオーケストレーション
      - インフラ自動化

  concept_artist:
    name: 이컨셉
    role: Concept Artist
    model: gemini              # 討論/企画時のテキストモデル
    image_model: gemini_image  # 画像生成時の画像モデル
    description: "コンセプトアートとビジュアルデザインの専門家"
    expertise:
      - コンセプトアート制作
      - キャラクター/背景デザイン
```

> 全ペルソナは会議に参加しますが、関連のないトピックでは`[PASS]`で自発的にパスします。別途のon_demand設定は不要です。

## 多言語対応（i18n）

CLI UI、AIシステムプロンプト、GitHubコメントなど全テキストが4言語で提供されます：

| 言語 | コード | 設定方法 |
|------|------|----------|
| 한국어 | `ko` | `--lang ko` またはOSロケール |
| English | `en` | `--lang en` またはOSロケール |
| 日本語 | `ja` | `--lang ja` またはOSロケール |
| 中文(简体) | `zh-CN` | `--lang zh-CN` またはOSロケール |

**ロケール検出優先順位**: `--lang`フラグ → 環境変数（`LC_ALL`, `LC_MESSAGES`, `LANG`） → `Intl` API → `en`（デフォルト）

AI応答パースも多言語対応：コードレビュー判定（`APPROVED`/`승인`/`承認`/`批准`）、QA判定（`PASS`/`합격`/`合格`/`通过`）などを言語に依存せず認識します。

## ライセンス

MIT
