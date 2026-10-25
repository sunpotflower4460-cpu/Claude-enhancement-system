# Claude-enhancement-system

Claude Codeの標準機能を活用し、**開発対象リポジトリ + この共通開発リポジトリ**を選んで、初回指示から設計・実装・独立レビュー・修正・実機検証・再計画を自律的に進めるための、再利用可能な軽量開発基盤。

## 目標

- Opus 5.5：長期設計・節目の監査
- Sonnet 5.5：短期計画・レビュー・実機検証・進行管理
- Haiku 5.5：小さく分割した実装・修正（難航時はSonnetに引き上げ可能）
- Claude Code `/goal`：完成条件が未達の間の継続
- Dynamic Workflows：工程と再試行の順序を管理
- 検証コントラクト：証拠のない完成宣言を防ぐ

使用する本体はClaude Code。別の開発統合プロジェクトや他のコーディングエージェントへの依存は設けない。

## 現在の状態

**v0.1 実装：ローカル検証基盤とClaude向けWorkflow/役割定義を追加。V1全体の受け入れはUNVERIFIED。**

Node.js 22以上で `npm ci --ignore-scripts && npm test`。今回の実測環境はNode.js 24.19.0。
対象識別・冪等初期化・要件/状態スキーマ・実コマンド証拠・指紋・完成ゲート・再開履歴を実装した。
独立レビューと監査、モデル置換検出、null拒否、Sonnet昇格を組み込んだWorkflowを同梱する。

Claude Code本体がこの環境に無いため、クラウド2リポジトリ、/goal、Workflowの実ツール制限と5.5モデルルーティングは未実証。
ローカルのテスト成功をクラウド受け入れ合格とは扱わない。

開始は [START.md](START.md)、コマンドと再開は [利用手順](docs/06-usage.md)、
実証済みの範囲と未検証項目は [検証結果](docs/validation-results.md) を参照。

## 設計書を読む順序

1. [要求と対象範囲](docs/00-requirements.md)
2. [構成と環境別起動](docs/01-architecture.md)
3. [自走実行プロトコル](docs/02-execution-protocol.md)
4. [品質・証拠・完了判定](docs/03-quality-contract.md)
5. [OSSと公式資料](docs/04-research-sources.md)
6. [実装順序・受け入れテスト](docs/05-implementation-plan.md)
7. [ユーザー向け利用手順](docs/06-usage.md)
8. [設計自己レビュー・残る検証事項](docs/07-self-review.md)

## 境界

- **このリポジトリ**：エージェント定義、共通Skills、ワークフロー、初期設定、検証ロジック。
- **開発対象リポジトリ**：元の設計、長期計画、バックログ、進捗、検証証拠、成果物。
- 共通基盤の利用によって別プロジェクトの設計・運用に干渉しない。
- 初回操作の最小化は目標。権限承認、利用制限、環境の制約による一時停止は起こり得る。

実装の引き継ぎルールは [AGENTS.md](AGENTS.md) に記載。
