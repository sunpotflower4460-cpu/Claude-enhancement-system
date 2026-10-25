# 検証結果 — 2026-10-25

状態：**ローカル回帰試験PASS、Claude Code V1受け入れUNVERIFIED**。

環境：Linux、Node.js v24.19.0、npm、Git。Claude Codeと実モデル呼び出しなし。`npm ci --ignore-scripts`、`npm test`、`npm audit --omit=dev --json`を実行。正確なテスト名と出力は[evidence/tests.txt](evidence/tests.txt)、依存監査は[evidence/npm-audit.json](evidence/npm-audit.json)。

## 実際に観察した動作

一時Gitリポジトリで、既存.claude/settings.jsonを保全して初期化・再開した。CLIサブプロセスからbootstrap/record/context/verify/doctorを起動した。HTTPサーバーを127.0.0.1の空きポートに起動し、実際にfetchでHTTP 200と期待JSONを確認し、サーバーを終了した。

意図的にthrowするコードは実コマンドで非0となりFAIL、修正後は実行成功となった。完成判定の正例では、独立レビュー・監査・モデルの記録に**テスト専用の模擬記録**を使った。したがって正例のCOMPLETEは判定器のテストであり、実際のClaudeシステム完成の証拠ではない。

## 受け入れマトリクス

「ローカルPASS」は表に記すプログラム部分の実測結果。モデル・クラウド・UIを含む元のシナリオ全体は別欄で判定する。

| ID | ローカルでの実行・結果 | Claudeを含む全体判定 |
| --- | --- | --- |
| T01 | PASS：対象識別、共通/SSH同一remote拒否、対象だけの初期化 | UNVERIFIED：クラウド2repo未実施 |
| T02 | 継続器を独自実装せず/goal手順を用意 | UNVERIFIED |
| T03 | PASS：定義とWorkflowの期待モデル文字列を検査 | UNVERIFIED：実モデルなし |
| T04 | PASS：意図的コードバグの実行失敗と修正後成功、模擬review分岐 | UNVERIFIED：実Haiku/Sonnetなし |
| T05 | PASS：証拠欠落、内容変更、ログ改変でUNVERIFIED | ローカル機械ゲートPASS |
| T06 | PASS：build成功でもvisualコマンド失敗ならFAIL | UNVERIFIED：実ブラウザ表示なし |
| T07 | PASS：元要件との対応欠落・未知参照・重複を拒否 | UNVERIFIED：自然言語要件のOpus監査なし |
| T08 | PASS：模擬review2巡失敗でSonnet根本原因調査へ | UNVERIFIED：実モデルなし |
| T09 | PASS：active二重begin、所有権、状態遷移の拒否 | UNVERIFIED：Claude再開キャッシュなし |
| T10 | PASS：既存設定をバイト単位で保全、再初期化で原要求維持 | UNVERIFIED：Claudeの設定発見なし |
| T11 | PASS：doctorがCLI欠落と未確認機能を報告、模擬BLOCKEDで後続停止 | UNVERIFIED：実モデル利用拒否なし |
| T12 | PASS：3profileを別fixtureで再利用、HTTP実呼出し | UNVERIFIED：実Web/ゲーム開発追試なし |
| T13 | PASS：evidenceだけ更新しても鮮度維持、契約更新で失効 | ローカル機械ゲートPASS |
| T14 | PASS：新規未追跡・削除・mode・symlink変更を検出 | ローカル機械ゲートPASS |
| T15 | PASS：4段階それぞれのnullで後続停止、例外も伝播 | UNVERIFIED：Claude stall/replayなし |
| T16 | PASS：部分編集を保全し、終了ログ付きrecoverで差分指紋を記録 | UNVERIFIED：実Workflow再起動なし |
| T17 | PASS：模擬モデル置換を完成判定から拒否 | UNVERIFIED：ポリシーによる実置換なし |
| T18 | PASS：模擬BLOCKEDとAPI拒否例外で停止 | UNVERIFIED：実読取/実行権限拒否なし |
| T19 | PASS：定義/模擬呼出のtoolsはRead/Grep/Globだけ | UNVERIFIED：実ランタイムで書込拒否probe必要 |
| T20 | PASS：active runと検査中製品/契約変更で完成拒否 | UNVERIFIED：実Workflow稼働状態の照合なし |

追加：timeout時の子プロセス停止（/procで実行中でないことを確認）、Schema不正・要件ID重複・依存循環・原文改変・branch不一致・状態ディレクトリsymlink・コマンドtimeoutも検査した。

## 未解決・次に必要な作業

1. Claude Codeクラウドで/goal、Workflow、共有scriptPath、tools制限、承認条件、モデル実ルーティングを実測。Workflow呼出形式の差があれば公式/workflow-authoringに沿って修正し回帰試験する。
2. 実レビュー/監査/モデルログを取得し、正規化値と元ログを照合する。任意ログ形式の自動解析は未実装。
3. Web・既存プロジェクト・ゲームを実Claudeで開発し、実ブラウザ/プレイ・中断再開・故障注入を追試する。画像や操作成功を今回の結果から推測しない。
4. GitHub ActionsのNode.js v22.23.3でも最終コードの24件がPASS。push用[run 40188835146](https://github.com/sunpotflower4460-cpu/Claude-enhancement-system/actions/runs/40188835146)、PR用[run 40188837751](https://github.com/sunpotflower4460-cpu/Claude-enhancement-system/actions/runs/40188837751)を確認。初回に見つかったtimeout子プロセス残存と、PRのdetached HEADでの識別失敗は修正済み。[CIメタデータ](evidence/github-ci.json)。

上記1〜3のClaude実機確認が完了するまでは「V1完成」「クラウドで一指示から動作済み」とは表示しない。実装要求は維持している。
