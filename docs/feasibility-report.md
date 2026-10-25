# 実現可能性調査 — 2026-10-25

## 実測環境

Linux managed cloud、Node.js v24.19.0、Git、GitHub CLI。`command -v claude`は出力なし。Claude Code用の認証・アカウント・ブラウザセッションは本作業に提供されていない。外部のClaude Codeクラウドをこの環境から操作したという主張はしない。

`node scripts/doctor.mjs`の実出力は[evidence/doctor.json](evidence/doctor.json)。終了コード2（UNVERIFIED）、cliはBLOCKED、/goal・Workflow・クラウド2repo・実モデルはUNVERIFIED。

## 公式資料の再確認

2026-10-25にHTTPS GETで以下を取得（成功）。OSSのコード転用は行っていない。

- https://code.claude.com/docs/en/workflows.md
- https://code.claude.com/docs/en/agent-sdk/typescript.md

Workflowはmetaリテラルを先頭に置く。bodyはtop-level awaitとreturnを用い、agent()、args、log等を使う。Date.now/Math.randomは禁止なのでrun/task IDは親から渡す。nullは捨てずに中断する。WorkflowのscriptPathとargs、resumeFromRunIdはSDK資料のWorkflowInputに記載されている。

モデル指定はリクエストにすぎず、ポリシーによる置換があり得る。実モデルはtask詳細/ログによる確認が必要。今回の環境ではモデル自体の存在・利用資格・実ルーティングを検証できない。

## 実装判断と設計差分

| 判断 | 理由 | 影響する試験 |
| --- | --- | --- |
| Node.js標準機能＋Ajvのみ | OS常駐サーバー/DB不要でCLIとSchemaを検査可能にする | T01/T05/T07/T10/T13/T14 |
| contract.jsonを別ファイルとし、原要求・バックログ構造・共通検証器を契約指紋へ含める | 状態の変更で証拠が自己失効せず、判定条件変更で確実に失効する | T05/T07/T13/T20 |
| Git tracked＋非ignore未追跡、モード・symlink・削除をハッシュ | HEADだけでは未コミットの製品変更を検出できない | T14/T20 |
| writer所有権は永続状態、CLI操作は排他ファイル | エージェント間でプロセスが変わっても二重起動を防止する | T09/T16 |
| レビュー・監査は読取専用、実コマンドは別verifier | Bashや委任経由の編集をレビュアーから除く | T19 |
| 単一のdevelop-sprintにreview/fixを内包 | review-and-fix.jsを別途重複実装しない | T04/T08/T15 |
| profilesを必須kind検査で強制 | buildだけでUI/ゲーム検査済みとしない | T06/T12 |
| Workflow権限制限probeを起動前提にする | 公開ページだけではagentのtoolsオプションの実適用を証明できず、未確認のままread-onlyとは言えない | T18/T19 |
| V1受け入れを保留し独立実装を継続 | P0不可でも作業を止めず、クラウド成功を捏造しない | T01/T02/T03 |

## 現時点での制限

同梱Workflowの`model`/`tools`/`schema`呼び出しは模擬環境で検査した。実ランタイムの`/workflow-authoring`でtools制限の正確な指定を照合し、書込試行が拒否されるまでread-only保証はUNVERIFIED。STARTはこのprobeを必須とする。動的workflowのファイル存在やNodeテスト成功を、標準Claudeランタイムで動作した証拠にはしない。

自動のモデルログ解析は提供していない。親が実際のtaskログから正規化した値を記録し、ゲートはモデル一致・元ログの存在/ハッシュを確認する。このログの信頼性は親セッションに依存する。

クラウドでの承認回数・新規agent再読込・共有scriptPath許可・/goal継続・モデル置換・ゲーム/ブラウザ体験は未実測。これらは要求から削除せず、受け入れに残す。
