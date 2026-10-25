# START — Claude-enhancement-system

**注意：2026-10-25時点、このリポジトリは設計段階です。実行可能な自律開発基盤はまだ実装されていません。** このファイルは将来の単一開始入口としての仕様を示します。

## 意図

開発対象の設計を渡されたClaude Codeが、この共通開発リポジトリを参照してOpus長期設計、Sonnet短期計画、Haiku実装、Sonnet独立レビュー・検証、Opus節目監査を自走する。

## 実装時の起動手順

1. 共通リポジトリと開発対象を特定し、対象を書き込む前に明示する。
2. 共通側の`docs/00-requirements.md`、`docs/01-architecture.md`、`docs/02-execution-protocol.md`、`docs/03-quality-contract.md`を読む。
3. 実装後の`node scripts/doctor.mjs`相当でClaude Codeの環境とモデル/Workflow/ファイル権限を調査する。Claude Code標準の`/doctor`とは区別し、失敗を隠さない。
4. 対象の原案を保存し、Opusが長期設計と受け入れ条件を作成する。
5. Sonnet短期計画→Haiku実装→Sonnet独立レビュー・実機検証をWorkflowで進める。
6. 各合格条件の証拠とコードの一致を検査し、不足があれば修正・再計画に戻る。
7. 節目でOpus監査、全達成時に最終ゲートと結果を提示する。
8. バックグラウンドWorkflowの完了とエージェント結果の欠損0件を確認する。権限の確認が必要ならその場だけユーザー承認を待ち、未承認のまま完了としない。

## 今使う開発者へ

Codexによる本システムの実装を行う場合は、`AGENTS.md`を読み、`docs/05-implementation-plan.md`の**フェーズ0**から開始すること。単にこの`START.md`を読んだだけで「自律開発開始済み」などと答えない。
